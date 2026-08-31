-- ---------------------------------------------------------------------------
-- Increment 23 — the copy the auditor asks for (ADR-216).
--
-- The competitor board carried "service report delivered as a document" as a
-- GAP, blocked on object storage. That was WRONG, and the repository itself
-- says so: `20260820000300` hit exactly this wall for the Job Seeker and
-- solved it. Hosted Supabase's storage.objects is owned by
-- supabase_storage_admin, so this repository's psql apply path cannot create
-- policies on it, and the web tier deliberately holds no service-role key
-- that could bypass them. Rather than smuggle a privileged key into the
-- browser-facing server or ship a bucket nobody can write to, that increment
-- put the bytes in a BYTEA column under the same RLS discipline as every
-- other table.
--
-- So the blocker was never storage. It was that nobody had looked.
--
-- WHAT A FILED DOCUMENT IS FOR: an auditor asks what the report SAID on the
-- day, not what the database would render from today's rows. A service
-- report assembled live from current data is a different document every time
-- a note is corrected. This freezes the bytes at the moment of filing.
--
-- WHICH IS WHY IT IS APPEND-ONLY. `select, insert`, nothing else. A filed
-- copy that can be edited is not evidence, and correcting one means filing
-- another that supersedes it — the same shape as the compliance log.
--
-- WHAT THIS STILL DOES NOT DO: send it. Email and SMS remain the gated row
-- they have always been. Printing already works from the browser (ADR-214).
-- So this row moves from GAP to PARTIAL, not to HAVE, and the reason changes
-- from "needs object storage" to "needs a sender".
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.crm_service_document_kind as enum (
    'service_report', 'inspection_report', 'logbook_extract'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.crm_service_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,

  kind public.crm_service_document_kind not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),

  -- What the document is about. At least one, so a filed copy is always
  -- traceable to the thing it reports on.
  work_order_id uuid,
  inspection_id uuid,
  property_id uuid,

  -- The document, frozen. TEXT rather than bytea, deliberately: the content
  -- types this column accepts are both text, so bytea would have bought
  -- nothing and cost a real incompatibility — PostgREST wants a `\x` hex
  -- string for a bytea and the local PGlite harness wants bytes, so the
  -- seed path and the product path would have disagreed about the same
  -- column. `job_seeker_uploads` is bytea because it holds PDFs and DOCX;
  -- this holds HTML it can print (ADR-214), and claiming a content type
  -- this product cannot produce would be a lie in a column.
  content_type text not null check (content_type in ('text/html', 'text/plain')),
  byte_size integer not null check (byte_size between 1 and 1048576),
  body text not null,

  filed_at timestamptz not null default now(),
  filed_by uuid not null references auth.users(id) on delete restrict,

  -- A correction files a new copy naming the one it replaces; the original
  -- stays, because an auditor may have been handed it.
  supersedes_id uuid,

  constraint crm_service_documents_account_same_org
    foreign key (organization_id, account_id)
    references public.crm_accounts (organization_id, id) on delete cascade,
  constraint crm_service_documents_work_order_same_org
    foreign key (organization_id, work_order_id)
    references public.crm_work_orders (organization_id, id) on delete set null,
  constraint crm_service_documents_inspection_same_org
    foreign key (organization_id, inspection_id)
    references public.crm_wdo_inspections (organization_id, id) on delete set null,
  constraint crm_service_documents_property_same_org
    foreign key (organization_id, property_id)
    references public.crm_properties (organization_id, id) on delete set null,

  -- The size is checked twice and the two must agree, so a truncated upload
  -- cannot claim to be whole. octet_length on text counts BYTES, not
  -- characters, which is what a size means.
  constraint crm_service_documents_size_is_true
    check (octet_length(body) = byte_size),

  -- A filed copy always says what it is about.
  constraint crm_service_documents_names_a_subject
    check (num_nonnulls(work_order_id, inspection_id, property_id) >= 1),

  constraint crm_service_documents_title_no_secret
    check (not public.text_has_likely_secret(title))
);

create unique index if not exists crm_service_documents_org_id_key
  on public.crm_service_documents (organization_id, id);
create index if not exists crm_service_documents_account_idx
  on public.crm_service_documents (organization_id, account_id, filed_at desc);
create index if not exists crm_service_documents_work_order_idx
  on public.crm_service_documents (organization_id, work_order_id)
  where work_order_id is not null;

-- The self-reference arrives after the index it needs: a table-level foreign
-- key pointing at its own table wants that unique constraint to exist
-- already, and inside CREATE TABLE it does not yet.
do $$ begin
  alter table public.crm_service_documents
    add constraint crm_service_documents_supersedes_same_org
    foreign key (organization_id, supersedes_id)
    references public.crm_service_documents (organization_id, id)
    on delete set null (supersedes_id);
exception when duplicate_object then null; end $$;

-- A document cannot supersede itself, which a self-reference would let it do
-- while reading as a correction of something.
do $$ begin
  alter table public.crm_service_documents
    add constraint crm_service_documents_supersedes_another
    check (supersedes_id is distinct from id);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- The index a customer or an auditor reads: what has been filed, newest
-- first, WITHOUT the bytes. Listing a hundred documents should not move a
-- hundred megabytes, and the body is fetched one at a time by id.
--
-- SECURITY INVOKER, like every other reader here.
-- ---------------------------------------------------------------------------

create or replace function public.crm_service_documents_filed(
  p_account uuid,
  p_limit integer default 100
)
returns table (
  document_id uuid,
  document_kind public.crm_service_document_kind,
  document_title text,
  document_bytes integer,
  document_filed_at timestamptz,
  document_supersedes uuid,
  document_superseded boolean
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select d.id, d.kind, d.title, d.byte_size, d.filed_at, d.supersedes_id,
         exists (
           select 1 from public.crm_service_documents later
            where later.organization_id = d.organization_id
              and later.supersedes_id = d.id
         )
    from public.crm_service_documents d
   where d.account_id = p_account
   order by d.filed_at desc
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

revoke all on function public.crm_service_documents_filed(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.crm_service_documents_filed(uuid, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- RLS. REVOKE first: hosted default privileges grant ALL on every new table.
--
-- No update and no delete, for anybody. A filed copy that can be changed is
-- not evidence; a correction is another filing that names this one.
-- ---------------------------------------------------------------------------

do $$
begin
  execute 'alter table public.crm_service_documents enable row level security';
  execute 'alter table public.crm_service_documents force row level security';
  execute 'revoke all on table public.crm_service_documents
             from public, anon, authenticated, service_role';

  execute 'drop policy if exists crm_service_documents_select_member on public.crm_service_documents';
  execute 'create policy crm_service_documents_select_member on public.crm_service_documents
             for select to authenticated
             using (public.is_organization_member(organization_id))';

  execute 'drop policy if exists crm_service_documents_insert_member on public.crm_service_documents';
  execute 'create policy crm_service_documents_insert_member on public.crm_service_documents
             for insert to authenticated
             with check (public.is_organization_member(organization_id))';

  execute 'grant select, insert on table public.crm_service_documents to authenticated';
end;
$$;
