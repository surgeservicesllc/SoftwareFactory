-- ---------------------------------------------------------------------------
-- The secret detectors did not know about a Stripe RESTRICTED key (ADR-208).
--
-- All three implementations of the rule — this function,
-- `lib/security/sensitive-data.ts` and `lib/worker/redact.ts` — matched
-- `sk_(live|test)_` and none of them matched `rk_`.
--
-- That is a disagreement inside the system rather than a missing pattern.
-- `lib/billing` ACCEPTS an `rk_live_` key as a valid STRIPE_SECRET_KEY, and
-- has a test asserting exactly that. So the code that consumes the key
-- called it a credential while the layer deciding whether it may be stored
-- in a column, committed to a file, or written to a log did not.
--
-- Restricted keys are what a careful operator uses INSTEAD of a secret
-- key, which makes this the shape most likely to be pasted by somebody
-- following good advice.
--
-- `pk_` stays out on purpose: a publishable key is meant to be public and
-- ships in browser bundles. Flagging it would teach people the warning is
-- noise, and a warning nobody believes protects nothing. There is a test
-- pinning that exclusion so the next "tidy" to `[sprk]k_` has to argue
-- with it.
--
-- THIS FILE IS THE LIVE DEFINITION WITH ONE CHARACTER CLASS CHANGED.
-- The function is ~130 lines: past the leading regex it also walks
-- assignment lines and JSON literals, with a placeholder vocabulary that
-- keeps `PASSWORD=${DATABASE_PASSWORD}` from tripping it. A first attempt
-- at this fix rebuilt the function from the regex alone and silently
-- dropped all of that; a test caught it. If you change this again, copy
-- the whole current body and edit inside it.
--
-- Immutable and used in CHECK constraints, so this governs new writes
-- only; existing rows are not revalidated.
-- ---------------------------------------------------------------------------

create or replace function public.text_has_likely_secret(input_text text)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  assignment_line text;
  assignment_match text[];
  credential_match text[];
  assignment_key text;
  assigned_value text;
begin
  if input_text is null then
    return false;
  end if;

  if input_text ~ '(?i)(-----BEGIN[[:space:]][A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|[sr]k_(live|test)_[A-Za-z0-9]{16,}|sb_secret_[A-Za-z0-9_-]{20,}|vercel_[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|bearer[[:space:]]+[A-Za-z0-9._~+/-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})' then
    return true;
  end if;

  foreach assignment_line in array pg_catalog.regexp_split_to_array(input_text, E'\\r?\\n')
  loop
    assignment_match := pg_catalog.regexp_match(
      assignment_line,
      $assignment$^[[:space:]]*(?:(?:export[[:space:]]+)?(?:const|let|var)[[:space:]]+|export[[:space:]]+)?["']?([A-Z][A-Z0-9_]*)["']?[[:space:]]*[:=][[:space:]]*(.*)[[:space:]]*$assignment$,
      'i'
    );
    if assignment_match is null then
      continue;
    end if;

    assignment_key := pg_catalog.upper(
      pg_catalog.regexp_replace(assignment_match[1], '[^A-Z0-9]', '', 'gi')
    );
    if assignment_key not in (
      'ACCESSTOKEN',
      'APIKEY',
      'AUTHORIZATION',
      'BEARER',
      'CLIENTSECRET',
      'CREDENTIAL',
      'CREDENTIALS',
      'PASSWORD',
      'PASSWD',
      'PRIVATEKEY',
      'PRIVATEKEYBASE64',
      'REFRESHTOKEN',
      'SERVICEROLEKEY',
      'SIGNINGSECRET',
      'WEBHOOKSECRET'
    ) and assignment_key !~ '(PASSWORD|APIKEY|PRIVATEKEY|PRIVATEKEYBASE64|CREDENTIAL|SERVICEROLEKEY|SECRETACCESSKEY|SECRETKEY|SECRET|TOKEN)$'
      and assignment_key !~ '(URL|DSN)$' then
      continue;
    end if;

    assigned_value := pg_catalog.btrim(assignment_match[2], E' \t,;');
    assigned_value := pg_catalog.btrim(
      pg_catalog.regexp_replace(assigned_value, '[[:space:]]+#.*$', '')
    );
    if pg_catalog.char_length(assigned_value) >= 2
      and pg_catalog.left(assigned_value, 1) = pg_catalog.right(assigned_value, 1)
      and pg_catalog.left(assigned_value, 1) in ('"', '''') then
      assigned_value := pg_catalog.btrim(
        pg_catalog.substr(assigned_value, 2, pg_catalog.char_length(assigned_value) - 2)
      );
    end if;

    if assigned_value = '' then
      continue;
    end if;
    if assigned_value ~* '^(<[^<>[:cntrl:]]+>|\$\{[A-Z_][A-Z0-9_]*\}|\$[A-Z_][A-Z0-9_]*|\$\{\{[^{}[:cntrl:]]+\}\}|\{\{[^{}[:cntrl:]]+\}\}|\[[[:space:]]*(REDACTED|PLACEHOLDER|REPLACE[-_ ]?ME|CHANGE[-_ ]?ME|TODO|TBD|NOT[-_ ]?SET|UNSET)[[:space:]]*\]|(YOUR|EXAMPLE|PLACEHOLDER|REPLACE[-_ ]?ME|CHANGE[-_ ]?ME|TODO|TBD|REDACTED|NOT[-_ ]?SET|UNSET)([-_ ][A-Z0-9]+)*|X{3,}|(process[.]env[.]|env[.])[A-Z_][A-Z0-9_]*)$' then
      continue;
    end if;

    if assignment_key ~ '(URL|DSN)$'
      and assignment_key not in (
        'ACCESSTOKEN', 'APIKEY', 'AUTHORIZATION', 'BEARER', 'CLIENTSECRET',
        'CREDENTIAL', 'CREDENTIALS', 'PASSWORD', 'PASSWD', 'PRIVATEKEY',
        'PRIVATEKEYBASE64', 'REFRESHTOKEN', 'SERVICEROLEKEY', 'SIGNINGSECRET',
        'WEBHOOKSECRET'
      )
      and assignment_key !~ '(PASSWORD|APIKEY|PRIVATEKEY|PRIVATEKEYBASE64|CREDENTIAL|SERVICEROLEKEY|SECRETACCESSKEY|SECRETKEY|SECRET|TOKEN)$' then
      credential_match := pg_catalog.regexp_match(
        assigned_value,
        '^[A-Z][A-Z0-9+.-]*://[^/:[:space:]@]+:([^@[:space:]]+)@[^[:space:]/]+',
        'i'
      );
      if credential_match is null
        or credential_match[1] ~* '^(<[^<>[:cntrl:]]+>|\$\{[A-Z_][A-Z0-9_]*\}|\$[A-Z_][A-Z0-9_]*|\$\{\{[^{}[:cntrl:]]+\}\}|\{\{[^{}[:cntrl:]]+\}\}|(YOUR|EXAMPLE|PLACEHOLDER|REPLACE[-_ ]?ME|CHANGE[-_ ]?ME|TODO|TBD|REDACTED|NOT[-_ ]?SET|UNSET)([-_ ][A-Z0-9]+)*|X{3,})$' then
        continue;
      end if;
    end if;

    return true;
  end loop;

  -- Compact JSON/object literals can contain several assignments on one line,
  -- so inspect every quoted key/value pair instead of only the first line key.
  for assignment_match in
    select json_match
    from pg_catalog.regexp_matches(
      input_text,
      $json$["']([A-Z][A-Z0-9_]*)["'][[:space:]]*:[[:space:]]*(["'])([^"'[:cntrl:]]*)\2$json$,
      'gi'
    ) as json_match
  loop
    assignment_key := pg_catalog.upper(
      pg_catalog.regexp_replace(assignment_match[1], '[^A-Z0-9]', '', 'gi')
    );
    assigned_value := pg_catalog.btrim(assignment_match[3]);
    if assigned_value = ''
      or assigned_value ~* '^(<[^<>[:cntrl:]]+>|\$\{[A-Z_][A-Z0-9_]*\}|\$[A-Z_][A-Z0-9_]*|\$\{\{[^{}[:cntrl:]]+\}\}|\{\{[^{}[:cntrl:]]+\}\}|(YOUR|EXAMPLE|PLACEHOLDER|REPLACE[-_ ]?ME|CHANGE[-_ ]?ME|TODO|TBD|REDACTED|NOT[-_ ]?SET|UNSET)([-_ ][A-Z0-9]+)*|X{3,})$' then
      continue;
    end if;
    if assignment_key in (
      'ACCESSTOKEN', 'APIKEY', 'AUTHORIZATION', 'BEARER', 'CLIENTSECRET',
      'CREDENTIAL', 'CREDENTIALS', 'PASSWORD', 'PASSWD', 'PRIVATEKEY',
      'PRIVATEKEYBASE64', 'REFRESHTOKEN', 'SERVICEROLEKEY', 'SIGNINGSECRET',
      'WEBHOOKSECRET'
    ) or assignment_key ~ '(PASSWORD|APIKEY|PRIVATEKEY|PRIVATEKEYBASE64|CREDENTIAL|SERVICEROLEKEY|SECRETACCESSKEY|SECRETKEY|SECRET|TOKEN)$' then
      return true;
    end if;
    if assignment_key ~ '(URL|DSN)$' then
      credential_match := pg_catalog.regexp_match(
        assigned_value,
        '^[A-Z][A-Z0-9+.-]*://[^/:[:space:]@]+:([^@[:space:]]+)@[^[:space:]/]+',
        'i'
      );
      if credential_match is not null
        and credential_match[1] !~* '^(<[^<>[:cntrl:]]+>|\$\{[A-Z_][A-Z0-9_]*\}|\$[A-Z_][A-Z0-9_]*|X{3,})$' then
        return true;
      end if;
    end if;
  end loop;

  return false;
end;
$function$;

comment on function public.text_has_likely_secret(text) is
  'True when the text looks like a credential. Private key blocks, GitHub (classic and fine-grained), OpenAI, Stripe secret AND restricted keys, Supabase, Vercel, AWS, bearer tokens, JWTs, and credential-shaped assignments. Stripe publishable keys are deliberately excluded: they are meant to be public.';
