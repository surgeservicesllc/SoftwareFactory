-- The vault accepts credentials as large as providers actually mint them.
--
-- A Claude subscription token seals to a few hundred characters; a Codex
-- credential is the CLI's whole auth file — token set included — and seals
-- past the vault's 8192-character cap, so the very last step of a
-- fully-approved sign-in was refused by the schema ("Completing the sign-in
-- failed", live 2026-08-16 18:44Z). The cap exists to refuse obviously
-- wrong writes, not real credentials; it moves to 65536 with the shape
-- checks intact.
--
-- Idempotent: this file is on the surgical apply path and may be replayed.

do $$
declare
  v_name text;
begin
  -- The original cap rode in as an unnamed inline check; find whatever name
  -- it got, drop it, and add the named replacement exactly once.
  for v_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.provider_credentials'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%char_length(sealed_envelope)%'
  loop
    execute pg_catalog.format(
      'alter table public.provider_credentials drop constraint %I', v_name
    );
  end loop;

  alter table public.provider_credentials add constraint provider_credentials_envelope_shape check (
    char_length(sealed_envelope) between 24 and 65536
    and sealed_envelope ~ '^v[0-9]+\.'
  );
end
$$;
