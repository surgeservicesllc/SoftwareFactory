-- Postflight for hosted apply scope `secret-guard-restricted-keys`.
--
-- The function backs CHECK constraints across the whole schema, so this
-- verifies behaviour rather than text: the shapes it must catch, and the
-- one it must deliberately let through.

do $$
declare
  v_sample text;
begin
  -- Newly covered.
  foreach v_sample in array array[
    'rk_live_abcdefghijklmnop1234',
    'rk_test_abcdefghijklmnop1234'
  ] loop
    if not public.text_has_likely_secret(v_sample) then
      raise exception 'a Stripe restricted key is still storable';
    end if;
  end loop;

  -- Everything the function already caught must still be caught. A widened
  -- regex that dropped a branch would pass the check above and be worse
  -- than the gap it closed.
  foreach v_sample in array array[
    'sk_live_abcdefghijklmnop1234',
    'sk_test_abcdefghijklmnop1234',
    'sk-abcdefghijklmnopqrstuvwxyz01',
    'ghp_abcdefghijklmnopqrstuvwxyz0123',
    'github_pat_abcdefghijklmnopqrstuvwxyz0123',
    'sb_secret_abcdefghijklmnopqrstuvwxyz',
    'vercel_abcdefghijklmnopqrstuvwxyz',
    'AKIAIOSFODNN7EXAMPLE',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N'
  ] loop
    if not public.text_has_likely_secret(v_sample) then
      raise exception 'the widened pattern lost a shape it used to catch: %', v_sample;
    end if;
  end loop;

  -- The assignment and JSON walkers past the leading regex. A rewrite that
  -- rebuilt the function from the regex alone would drop these silently,
  -- which is exactly what happened on the first attempt at this change.
  if not public.text_has_likely_secret('DATABASE_PASSWORD=opaque-password') then
    raise exception 'the assignment walker is gone';
  end if;
  if not public.text_has_likely_secret('{"apiKey":"opaque-value-here"}') then
    raise exception 'the JSON literal walker is gone';
  end if;

  -- And the placeholder vocabulary that keeps it usable.
  foreach v_sample in array array[
    'DATABASE_PASSWORD=${DATABASE_PASSWORD}',
    'DATABASE_PASSWORD=<set-in-secret-manager>',
    'AWS_SECRET_ACCESS_KEY=change-me'
  ] loop
    if public.text_has_likely_secret(v_sample) then
      raise exception 'a placeholder is being flagged as a secret: %', v_sample;
    end if;
  end loop;

  -- Publishable keys are meant to be public. Flagging one teaches people
  -- the warning is noise.
  if public.text_has_likely_secret('pk_live_abcdefghijklmnop1234') then
    raise exception 'a Stripe publishable key is being flagged as a secret';
  end if;

  if public.text_has_likely_secret('a sentence about tokens') then
    raise exception 'ordinary prose is being flagged';
  end if;
end
$$;
