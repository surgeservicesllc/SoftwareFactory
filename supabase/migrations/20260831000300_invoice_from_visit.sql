-- ---------------------------------------------------------------------------
-- Increment 20 — the invoice says what was actually done (ADR-212).
--
-- An invoice could already NAME a work order. Its lines were still typed by
-- hand, which means the document a customer receives and the record of the
-- visit are two independent stories that agree only as long as somebody
-- keeps them agreeing. PestPac and FieldRoutes both pull the service and
-- the chemical usage onto the invoice, and this closes that row.
--
-- WHAT A GENERATED INVOICE MUST NEVER DO:
--
--   * bill a visit that has not happened,
--   * bill the same visit twice, on this invoice or another one,
--   * restate a document the customer already has, or
--   * invent a price for a chemical that was included in the service.
--
-- Each of those is a constraint below rather than a convention.
--
-- CHEMICAL LINES ARE PRICED AT ZERO ON PURPOSE. In a pest program the
-- material is part of the service, and the customer is entitled to see
-- what was applied at their site — product, EPA number, amount, target.
-- A zero line says "included, and here is what it was". Inventing a
-- per-ounce price to make the arithmetic look busier would be a number
-- nobody agreed to.
--
-- ONLY CURRENT APPLICATIONS ARE BILLED. The compliance log is
-- append-only, and a correction supersedes an original rather than
-- editing it (increment 6). An invoice built from every row would restate
-- a mistake the log has already corrected, so superseded rows are
-- excluded.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.crm_invoice_line_source as enum
    ('manual', 'work_order', 'application');
exception when duplicate_object then null; end $$;

-- Where a line came from. Everything already in the book was typed by a
-- person, which is exactly what the default says.
alter table public.crm_invoice_lines
  add column if not exists source public.crm_invoice_line_source not null default 'manual';
alter table public.crm_invoice_lines
  add column if not exists source_id uuid;

do $$ begin
  alter table public.crm_invoice_lines
    add constraint crm_invoice_lines_source_id_iff_generated
    check ((source = 'manual') = (source_id is null));
exception when duplicate_object then null; end $$;

-- The double-billing guard. One visit produces generated lines on ONE
-- invoice; a second attempt somewhere else collides here rather than
-- quietly charging twice. Partial, so hand-typed lines are unaffected.
create unique index if not exists crm_invoice_lines_one_visit_per_book
  on public.crm_invoice_lines (organization_id, source_id)
  where source = 'work_order';

create index if not exists crm_invoice_lines_source_idx
  on public.crm_invoice_lines (organization_id, invoice_id, source);

-- ---------------------------------------------------------------------------
-- Building the lines.
--
-- SECURITY INVOKER: it writes into the caller's own book through RLS, like
-- every other writer in this schema. A definer would let a member bill an
-- account they cannot read.
--
-- GENERATION HAPPENS ONCE PER INVOICE, and a second attempt is refused.
--
-- That is not a simplification, it is the schema's existing boundary:
-- `crm_invoice_lines` carries `select, insert` and no delete, because a
-- line is part of a financial record rather than a draft somebody keeps
-- editing. A "regenerate" that quietly removed lines would have needed a
-- delete grant this book has deliberately never given, and would have made
-- the same document mean two different things on two different days.
--
-- The way to change a built invoice is the way this schema already
-- provides: void it and raise another. That leaves both documents, which
-- is what an audit of a customer's account needs.
-- ---------------------------------------------------------------------------

create or replace function public.crm_invoice_lines_from_visit(
  p_invoice uuid,
  p_work_order uuid
)
-- Every output column is prefixed, because an unprefixed one would SHADOW
-- the table column of the same name everywhere in this body: plpgsql
-- resolves a bare `source` to the OUT parameter, and the delete below
-- would compare a null against a literal and remove nothing. The failure
-- is silent in the worst way — regeneration would append a second copy of
-- every generated line instead of replacing the first.
returns table (
  line_position integer,
  line_description text,
  line_quantity numeric,
  line_unit_price_cents bigint,
  line_amount_cents bigint,
  line_source public.crm_invoice_line_source
)
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_org uuid;
  v_invoice_account uuid;
  v_status public.crm_invoice_status;
  v_voided timestamptz;
  v_order record;
  v_next integer;
  v_price bigint;
  v_subtotal bigint;
  v_tax bigint;
begin
  select i.organization_id, i.account_id, i.status, i.voided_at, i.tax_cents
    into v_org, v_invoice_account, v_status, v_voided, v_tax
    from public.crm_invoices i
   where i.id = p_invoice;

  if v_org is null then
    raise exception 'no such invoice in this workspace' using errcode = 'no_data_found';
  end if;

  -- An issued invoice is a document somebody already has. Rebuilding its
  -- lines would change what they were sent without telling anybody, so the
  -- answer is a refusal and a credit note, not a silent restatement.
  if v_status <> 'draft' or v_voided is not null then
    raise exception 'invoice % is % and can no longer be rebuilt from a visit',
      p_invoice, coalesce(nullif(v_voided::text, ''), v_status::text)
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  select w.id, w.account_id, w.property_id, w.status, w.service_type,
         w.completed_at, w.plan_id
    into v_order
    from public.crm_work_orders w
   where w.organization_id = v_org and w.id = p_work_order;

  if v_order.id is null then
    raise exception 'no such work order in this workspace' using errcode = 'no_data_found';
  end if;

  -- A visit that has not happened cannot be billed. completed_at is
  -- maintained by trigger and CHECKed against the status, so this reads
  -- one fact rather than two that could disagree.
  if v_order.status <> 'completed' then
    raise exception 'work order % is % — a visit is billed after it happens, not before',
      p_work_order, v_order.status using errcode = 'object_not_in_prerequisite_state';
  end if;

  if v_order.account_id <> v_invoice_account then
    raise exception 'that visit belongs to a different account than this invoice'
      using errcode = 'check_violation';
  end if;

  -- Once only. Lines are insert-only here, so a second build would append
  -- a second copy of the visit rather than replace the first — the invoice
  -- would silently double.
  if exists (
    select 1 from public.crm_invoice_lines l
     where l.organization_id = v_org and l.invoice_id = p_invoice and l.source <> 'manual'
  ) then
    raise exception 'invoice % was already built from a visit; void it and raise another rather than rebuilding it',
      p_invoice using errcode = 'object_not_in_prerequisite_state';
  end if;

  -- And once across the book. The partial unique index is the real
  -- guarantee; this reads it first so the refusal names the invoice that
  -- already has the visit instead of surfacing a constraint name.
  if exists (
    select 1 from public.crm_invoice_lines l
     where l.organization_id = v_org and l.source = 'work_order' and l.source_id = p_work_order
  ) then
    raise exception 'that visit is already billed on invoice %',
      (select i.number from public.crm_invoices i
        join public.crm_invoice_lines l on l.invoice_id = i.id
       where l.organization_id = v_org and l.source = 'work_order'
         and l.source_id = p_work_order limit 1)
      using errcode = 'unique_violation';
  end if;

  select coalesce(max(l.position), 0) + 1 into v_next
    from public.crm_invoice_lines l
   where l.organization_id = v_org and l.invoice_id = p_invoice;

  -- The service itself, at the plan's agreed value where there is one.
  -- Where there is not, the line is zero and visible rather than guessed:
  -- an operator prices a one-off visit, and a number this function made up
  -- would be indistinguishable from one they chose.
  select p.value_cents into v_price
    from public.crm_service_plans p
   where p.organization_id = v_org and p.id = v_order.plan_id;

  insert into public.crm_invoice_lines
    (organization_id, invoice_id, position, description, quantity,
     unit_price_cents, amount_cents, source, source_id)
  values (
    v_org, p_invoice, v_next,
    -- UTC explicitly: a service date that moved with whichever session
    -- rendered it would put two different days on two copies of one invoice.
    v_order.service_type || ' — '
      || to_char(v_order.completed_at at time zone 'UTC', 'FMDD Mon YYYY'),
    1, coalesce(v_price, 0), coalesce(v_price, 0), 'work_order', p_work_order
  );
  v_next := v_next + 1;

  -- One line per current application: what was used, how much, under which
  -- registration, against what. Priced at zero because the material is part
  -- of the service.
  insert into public.crm_invoice_lines
    (organization_id, invoice_id, position, description, quantity,
     unit_price_cents, amount_cents, source, source_id)
  select
    v_org, p_invoice, v_next + (row_number() over (order by a.applied_at, a.id))::int - 1,
    left(
      pr.name
      -- trim_scale, NOT trim(trailing '0'): the latter turns 100.000 into
      -- "1" on a customer's invoice, because it strips the integer's zeros
      -- along with the scale's.
      || ' — ' || trim_scale(a.quantity)::text || ' ' || a.unit::text
      || coalesce(' for ' || a.target_pest, '')
      || coalesce(' (EPA ' || pr.epa_registration_number || ')', ''),
      300
    ),
    -- ONE application, not the amount applied. `crm_invoice_lines.quantity`
    -- is numeric(12,2) and this is a regulated figure recorded at three
    -- decimals: 0.005 oz of bait would round to 0.00 and trip the line's
    -- own `quantity > 0` check, and 0.125 would silently become 0.13 on a
    -- document the customer keeps. The exact amount is in the description,
    -- at the scale it was recorded.
    1, 0, 0, 'application', a.id
  from public.crm_applications a
  join public.crm_products pr
    on pr.organization_id = a.organization_id and pr.id = a.product_id
  where a.organization_id = v_org
    and a.work_order_id = p_work_order
    -- A correction supersedes an original; only the current record is
    -- billed, or the invoice would restate a mistake the log has fixed.
    and not exists (
      select 1 from public.crm_applications later
       where later.organization_id = a.organization_id
         and later.supersedes_id = a.id
    );

  -- The invoice and its lines can never disagree, because this is the same
  -- statement that wrote them.
  select coalesce(sum(l.amount_cents), 0) into v_subtotal
    from public.crm_invoice_lines l
   where l.organization_id = v_org and l.invoice_id = p_invoice;

  update public.crm_invoices i
     set subtotal_cents = v_subtotal,
         total_cents = v_subtotal + v_tax,
         work_order_id = coalesce(i.work_order_id, p_work_order),
         updated_at = now()
   where i.organization_id = v_org and i.id = p_invoice;

  return query
    select l.position, l.description, l.quantity, l.unit_price_cents,
           l.amount_cents, l.source
      from public.crm_invoice_lines l
     where l.organization_id = v_org and l.invoice_id = p_invoice
     order by l.position;
end;
$$;

revoke all on function public.crm_invoice_lines_from_visit(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.crm_invoice_lines_from_visit(uuid, uuid)
  to authenticated;
