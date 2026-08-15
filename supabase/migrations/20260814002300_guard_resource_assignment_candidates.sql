-- Guard the one jsonb column that accepts structured evidence without a
-- sensitive-key check.
--
-- `resource_assignments` already refuses credential-shaped text in the scalar
-- columns that name a worker: `agent_id`, `provider`, and `model` each carry a
-- `not public.text_has_likely_secret(...)` check. The `candidates` array holds
-- the same three identifiers for every candidate considered, plus named
-- rejections and notes, and carried no such guard. Every other jsonb column in
-- the schema that accepts structured evidence is guarded — `deployment_validations.checks`
-- through `deployment_validations_no_sensitive_data`, and the operations and
-- activity tables through their reject-sensitive-data triggers.
--
-- So this is an inconsistency rather than a discovered leak. Nothing writes a
-- secret into `candidates` today: it is produced by the routing layer from
-- server-computed scoring, not from user or model input. The reason to close it
-- anyway is that the column is browser-readable through the table's member
-- SELECT policy, and "notes" is the kind of field a later change quietly widens
-- — a provider error string or a config echo landing there would put credential
-- material in front of every member of the organization.
--
-- Existing rows are validated by adding the constraint without NOT VALID: the
-- table is unhosted and empty everywhere it exists, so there is no backfill risk,
-- and a constraint that silently tolerates existing violations would defeat the
-- point.

alter table public.resource_assignments
  add constraint resource_assignments_candidates_not_sensitive
  check (not public.jsonb_has_sensitive_keys(candidates));

comment on constraint resource_assignments_candidates_not_sensitive
  on public.resource_assignments is
  'Candidate evidence is browser-readable through the member SELECT policy. Rejects credential-shaped keys so a widened notes field cannot put secret material in front of an organization.';
