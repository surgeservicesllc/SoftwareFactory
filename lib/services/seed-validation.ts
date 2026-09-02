import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The seed's own audit: counts, relationship integrity, required-field
 * coverage, enum spread and orphan detection, table by table, with an
 * explicit PASS/FAIL per row.
 *
 * This is deliberately a READ-ONLY pass over the real rows through the
 * caller's RLS-scoped client. It proves what is actually in the database
 * rather than what the generator believes it wrote — a seed that reports
 * on its own intentions proves nothing.
 */

/** The floor the goal sets for every table the product writes. */
export const SEED_RECORD_FLOOR = 250;

export type TableReport = {
  table: string;
  records: number;
  /** Optional columns found populated on at least one row. */
  populatedOptionalFields: string[];
  /** Optional columns that came back empty on every row. */
  emptyOptionalFields: string[];
  /** Distinct values seen in the table's status/enum column, if it has one. */
  enumColumn: string | null;
  enumValues: string[];
  /** Rows whose required parent is missing — always expected to be zero. */
  orphans: number;
  relationships: string[];
  meetsFloor: boolean;
  pass: boolean;
  notes: string[];
};

export type SeedReport = {
  organizationId: string;
  generatedAt: string;
  floor: number;
  tables: TableReport[];
  totals: { tables: number; records: number; passing: number; failing: number };
  pass: boolean;
};

type Spec = {
  table: string;
  /** Columns that must hold a value on every row for the table to be useful. */
  optional: string[];
  enumColumn?: string;
  /** Parent table + the column pointing at it, checked for orphans. */
  parents: { column: string; table: string }[];
  /** Tables that legitimately hold fewer rows than the floor, and why. */
  floorExempt?: string;
};

const SPECS: Spec[] = [
  {
    table: "crm_branches",
    optional: ["manager_id", "address", "phone", "email", "time_zone", "opened_on", "closed_on", "notes"],
    parents: [],
  },
  {
    table: "crm_employees",
    optional: [
      "branch_id", "reports_to_id", "last_name", "email", "phone", "title",
      "hire_date", "end_date", "commission_bps", "monthly_quota_cents", "notes",
    ],
    enumColumn: "role",
    parents: [{ column: "branch_id", table: "crm_branches" }],
  },
  {
    table: "crm_territories",
    optional: ["rep_id", "city", "region", "notes"],
    parents: [
      { column: "branch_id", table: "crm_branches" },
      { column: "rep_id", table: "crm_employees" },
    ],
  },
  {
    table: "crm_commissions",
    optional: ["opportunity_id", "contract_id", "invoice_id", "approved_at", "paid_at", "note"],
    enumColumn: "status",
    parents: [{ column: "employee_id", table: "crm_employees" }],
  },
  {
    table: "crm_form_templates",
    optional: ["description"],
    enumColumn: "kind",
    parents: [],
  },
  {
    table: "crm_form_fields",
    optional: ["help_text", "options"],
    enumColumn: "field_type",
    parents: [{ column: "template_id", table: "crm_form_templates" }],
  },
  {
    table: "crm_form_instances",
    optional: [
      "account_id", "property_id", "work_order_id", "technician_id",
      "started_at", "completed_at", "signed_by_name", "signed_at",
      "signature_path", "notes",
    ],
    enumColumn: "status",
    parents: [
      { column: "template_id", table: "crm_form_templates" },
      { column: "account_id", table: "crm_accounts" },
      { column: "technician_id", table: "crm_technicians" },
    ],
  },
  {
    table: "crm_form_answers",
    /*
     * Every answer fills exactly one of these — the schema insists on it —
     * so the audit asks that each shape appears somewhere in the corpus,
     * which is what proves every question type is exercised.
     */
    optional: ["value_text", "value_number", "value_boolean", "value_date", "value_options"],
    parents: [
      { column: "instance_id", table: "crm_form_instances" },
      { column: "field_id", table: "crm_form_fields" },
    ],
  },
  {
    table: "crm_timesheets",
    /*
     * `ended_at` is optional because an open shift genuinely has none, and
     * the corpus carries both — a running shift is a real state the
     * timesheet page has to render.
     */
    optional: ["work_order_id", "ended_at", "notes"],
    parents: [{ column: "technician_id", table: "crm_technicians" }],
  },
  {
    table: "crm_equipment",
    optional: [
      "make", "model", "serial_number", "branch_id", "assigned_technician_id",
      "meter_reading", "meter_unit", "meter_read_at", "service_interval_days",
      "last_serviced_on", "purchased_on", "notes",
    ],
    /*
     * `retired_on` is deliberately absent: the corpus keeps every asset on
     * the roster, because a retired one is the state the fleet report
     * excludes and seeding a shelf of them would flatter the counts.
     */
    enumColumn: "kind",
    parents: [],
  },
  {
    table: "crm_equipment_events",
    optional: ["technician_id", "meter_reading", "cost_cents", "vendor", "note"],
    enumColumn: "kind",
    parents: [{ column: "equipment_id", table: "crm_equipment" }],
  },
  {
    table: "crm_billing_runs",
    /*
     * A note is the only optional column. The counts are never null —
     * a run that did nothing reports zeros, which is a measurement.
     */
    optional: ["note"],
    parents: [],
  },
  {
    table: "crm_dunning_notices",
    optional: ["outcome"],
    enumColumn: "action",
    parents: [
      { column: "invoice_id", table: "crm_invoices" },
      { column: "account_id", table: "crm_accounts" },
    ],
  },
  {
    table: "crm_portal_users",
    /*
     * `user_id`, `activated_at` and `last_seen_at` are deliberately NOT
     * listed. A login is a real auth user accepting an invitation, which
     * the seeder cannot perform on somebody's behalf — so those columns
     * are empty in the corpus, and claiming them as covered would be the
     * report lying about what it seeded.
     */
    optional: ["contact_id"],
    enumColumn: "role",
    parents: [{ column: "account_id", table: "crm_accounts" }],
  },
  {
    table: "crm_portal_requests",
    optional: [
      "property_id",
      "portal_user_id",
      "detail",
      "preferred_date",
      "response",
      "work_order_id",
      "resolved_at",
    ],
    enumColumn: "status",
    parents: [{ column: "account_id", table: "crm_accounts" }],
  },
  {
    table: "crm_documents",
    optional: ["account_id", "property_id", "work_order_id", "content_type", "byte_size", "notes"],
    enumColumn: "kind",
    parents: [
      { column: "account_id", table: "crm_accounts" },
      { column: "property_id", table: "crm_properties" },
      { column: "work_order_id", table: "crm_work_orders" },
    ],
  },
  {
    table: "crm_canvass_routes",
    optional: ["territory_id", "rep_id", "started_at", "ended_at", "notes"],
    enumColumn: "status",
    parents: [
      { column: "territory_id", table: "crm_territories" },
      { column: "rep_id", table: "crm_employees" },
    ],
  },
  {
    table: "crm_knocks",
    optional: ["account_id", "follow_up_on", "note"],
    enumColumn: "disposition",
    parents: [
      { column: "canvass_route_id", table: "crm_canvass_routes" },
      { column: "account_id", table: "crm_accounts" },
    ],
  },
  {
    table: "crm_marketing_lists",
    optional: ["description", "criteria"],
    parents: [],
  },
  {
    table: "crm_list_members",
    optional: ["source", "unsubscribed_at", "unsubscribe_reason"],
    parents: [
      { column: "list_id", table: "crm_marketing_lists" },
      { column: "account_id", table: "crm_accounts" },
    ],
  },
  {
    table: "crm_campaigns",
    optional: ["list_id", "subject", "body", "budget_cents", "scheduled_at", "sent_at"],
    enumColumn: "status",
    parents: [{ column: "list_id", table: "crm_marketing_lists" }],
  },
  {
    table: "crm_messages",
    optional: ["destination", "sent_at", "delivered_at", "opened_at", "clicked_at", "failure_reason"],
    enumColumn: "status",
    parents: [
      { column: "campaign_id", table: "crm_campaigns" },
      { column: "account_id", table: "crm_accounts" },
    ],
  },
  {
    table: "crm_automations",
    /*
     * `last_run_at` is deliberately absent from this list. Nothing executes
     * an automation yet, and the schema CHECKs that a run count and a
     * last-run moment agree — so seeding one would be claiming a rule had
     * fired. An empty column that is honestly empty is not a coverage gap,
     * and auditing it as one would push the seed into lying.
     */
    optional: ["template"],
    enumColumn: "action",
    parents: [],
  },
  {
    table: "crm_attributions",
    optional: ["opportunity_id", "campaign_id", "knock_id", "medium", "note"],
    enumColumn: "position",
    parents: [
      { column: "account_id", table: "crm_accounts" },
      { column: "opportunity_id", table: "crm_opportunities" },
      { column: "campaign_id", table: "crm_campaigns" },
    ],
  },
  {
    table: "crm_accounts",
    optional: [
      "email", "phone", "source", "billing_address", "notes",
      "branch_id", "territory_id", "owner_employee_id",
    ],
    enumColumn: "status",
    parents: [
      { column: "branch_id", table: "crm_branches" },
      { column: "territory_id", table: "crm_territories" },
      { column: "owner_employee_id", table: "crm_employees" },
    ],
  },
  {
    table: "crm_contacts",
    optional: ["last_name", "role", "email", "phone"],
    parents: [{ column: "account_id", table: "crm_accounts" }],
  },
  {
    table: "crm_properties",
    optional: ["property_type", "access_notes"],
    parents: [{ column: "account_id", table: "crm_accounts" }],
  },
  {
    table: "crm_opportunities",
    optional: [
      "value_cents", "expected_close_date", "notes", "lost_reason", "closed_at",
      "owner_employee_id",
    ],
    enumColumn: "stage",
    parents: [
      { column: "account_id", table: "crm_accounts" },
      { column: "owner_employee_id", table: "crm_employees" },
    ],
  },
  {
    table: "crm_timeline_events",
    optional: ["detail", "actor_user_id"],
    enumColumn: "kind",
    parents: [{ column: "account_id", table: "crm_accounts" }],
  },
  {
    table: "crm_technicians",
    optional: ["hourly_cost_cents", "last_name", "email", "phone", "license_number", "branch_id", "reports_to_id", "hire_date"],
    parents: [
      { column: "branch_id", table: "crm_branches" },
      { column: "reports_to_id", table: "crm_employees" },
    ],
  },
  {
    table: "crm_service_plans",
    optional: ["technician_id", "value_cents", "notes"],
    enumColumn: "recurrence",
    parents: [
      { column: "account_id", table: "crm_accounts" },
      { column: "property_id", table: "crm_properties" },
    ],
  },
  {
    table: "crm_work_orders",
    optional: ["technician_id", "plan_id", "instructions", "completion_notes", "completed_at"],
    enumColumn: "status",
    parents: [
      { column: "account_id", table: "crm_accounts" },
      { column: "property_id", table: "crm_properties" },
    ],
  },
  {
    table: "crm_devices",
    optional: ["location_note", "activity_threshold", "removed_at"],
    enumColumn: "device_type",
    parents: [
      { column: "account_id", table: "crm_accounts" },
      { column: "property_id", table: "crm_properties" },
    ],
  },
  {
    table: "crm_device_events",
    optional: ["condition", "activity_count", "pest_observed", "location_note", "note", "work_order_id"],
    enumColumn: "event",
    parents: [{ column: "device_id", table: "crm_devices" }],
  },
  {
    table: "crm_pest_sightings",
    optional: [
      "location_note",
      "note",
      "corrective_action",
      "corrected_at",
      // Increment 15: set on the sightings the customer filed themselves.
      "reported_by_portal_user_id",
    ],
    enumColumn: "severity",
    parents: [
      { column: "account_id", table: "crm_accounts" },
      { column: "property_id", table: "crm_properties" },
    ],
  },
  {
    table: "crm_wdo_inspections",
    optional: [
      "work_order_id",
      "obstructions",
      "inaccessible_areas",
      "recommendation",
      "issued_at",
      "supersedes_id",
    ],
    enumColumn: "status",
    parents: [
      { column: "account_id", table: "crm_accounts" },
      { column: "property_id", table: "crm_properties" },
      { column: "inspector_technician_id", table: "crm_technicians" },
    ],
  },
  {
    table: "crm_wdo_findings",
    optional: ["organism", "position_x", "position_y", "note", "treatment_note"],
    enumColumn: "kind",
    parents: [{ column: "inspection_id", table: "crm_wdo_inspections" }],
  },
  {
    table: "crm_products",
    optional: ["epa_registration_number", "active_ingredient", "signal_word", "sds_url", "label_url", "default_unit"],
    enumColumn: "default_unit",
    parents: [],
  },
  {
    table: "crm_product_lots",
    optional: ["expires_on", "unit_cost_cents"],
    enumColumn: "unit",
    parents: [{ column: "product_id", table: "crm_products" }],
  },
  {
    table: "crm_applications",
    optional: [
      "work_order_id", "lot_id", "device_id", "applicator_license", "target_pest",
      "application_rate", "treated_area", "location_note", "note", "supersedes_id",
    ],
    enumColumn: "method",
    parents: [
      { column: "account_id", table: "crm_accounts" },
      { column: "property_id", table: "crm_properties" },
      { column: "product_id", table: "crm_products" },
      { column: "technician_id", table: "crm_technicians" },
    ],
  },
  {
    table: "crm_compliance_rules",
    optional: ["notes"],
    parents: [],
  },
  {
    table: "crm_estimates",
    optional: ["property_id", "opportunity_id", "valid_until", "terms", "notes", "sent_at", "decided_at"],
    enumColumn: "status",
    parents: [{ column: "account_id", table: "crm_accounts" }],
  },
  {
    table: "crm_estimate_lines",
    optional: [],
    parents: [{ column: "estimate_id", table: "crm_estimates" }],
  },
  {
    table: "crm_contracts",
    optional: ["estimate_id", "plan_id", "ends_on", "terms", "notes", "signed_at", "signed_by_name", "ended_at"],
    enumColumn: "status",
    parents: [{ column: "account_id", table: "crm_accounts" }],
  },
  {
    table: "crm_invoices",
    optional: ["contract_id", "work_order_id", "issued_on", "due_on", "memo", "voided_at", "void_reason"],
    enumColumn: "status",
    parents: [{ column: "account_id", table: "crm_accounts" }],
  },
  {
    table: "crm_invoice_lines",
    optional: [],
    parents: [{ column: "invoice_id", table: "crm_invoices" }],
  },
  {
    table: "crm_payments",
    optional: ["reference", "note"],
    enumColumn: "method",
    parents: [
      { column: "account_id", table: "crm_accounts" },
      { column: "invoice_id", table: "crm_invoices" },
    ],
  },
  {
    table: "crm_refunds",
    optional: [],
    parents: [{ column: "payment_id", table: "crm_payments" }],
  },
  {
    table: "crm_plan_steps",
    optional: ["day_of_month", "week_of_month", "weekday", "service_type"],
    enumColumn: "anchor",
    parents: [{ column: "plan_id", table: "crm_service_plans" }],
  },
  {
    table: "crm_stock_movements",
    optional: [
      "from_branch_id", "from_equipment_id", "to_branch_id", "to_equipment_id",
      "application_id", "note",
    ],
    enumColumn: "kind",
    parents: [{ column: "lot_id", table: "crm_product_lots" }],
  },
  {
    table: "crm_field_submissions",
    optional: ["result_id"],
    enumColumn: "kind",
    parents: [],
  },
  {
    table: "crm_property_units",
    optional: ["unit_type", "occupant_name", "access_notes"],
    parents: [{ column: "property_id", table: "crm_properties" }],
  },
  {
    table: "crm_service_documents",
    optional: ["work_order_id", "inspection_id", "property_id", "supersedes_id"],
    enumColumn: "kind",
    parents: [{ column: "account_id", table: "crm_accounts" }],
  },
  {
    table: "crm_contact_preferences",
    optional: ["do_not_contact_at", "do_not_contact_reason"],
    enumColumn: "channel",
    parents: [{ column: "account_id", table: "crm_accounts" }],
  },
  {
    // `dispatched_at` and `provider_reference` are absent from this list on
    // purpose. They are populated only by a real dispatch through a
    // connected provider, and a seeded value in either would be the one
    // falsehood ADR-217 exists to make impossible.
    table: "crm_notices",
    optional: [
      "work_order_id", "invoice_id", "subject_line",
      "suppressed_at", "suppression_reason", "failure_reason", "cancelled_at",
    ],
    enumColumn: "state",
    parents: [{ column: "account_id", table: "crm_accounts" }],
  },

  {
    table: "crm_payment_instruments",
    optional: ["expires_month", "expires_year", "holder_name", "removed_at", "removed_reason"],
    enumColumn: "kind",
    parents: [{ column: "account_id", table: "crm_accounts" }],
  },
  {
    table: "crm_payment_mandates",
    optional: [],
    enumColumn: "channel",
    parents: [
      { column: "account_id", table: "crm_accounts" },
      { column: "instrument_id", table: "crm_payment_instruments" },
    ],
  },
  {
    table: "crm_autopay_enrollments",
    optional: ["revoked_at", "revoke_reason"],
    parents: [
      { column: "account_id", table: "crm_accounts" },
      { column: "instrument_id", table: "crm_payment_instruments" },
      { column: "mandate_id", table: "crm_payment_mandates" },
    ],
  },
  {
    table: "crm_routes",
    optional: ["name", "note", "released_at", "completed_at"],
    enumColumn: "status",
    parents: [
      { column: "technician_id", table: "crm_technicians" },
      { column: "branch_id", table: "crm_branches" },
    ],
  },
  {
    table: "crm_route_stops",
    optional: ["planned_arrival", "note"],
    parents: [
      { column: "route_id", table: "crm_routes" },
      { column: "work_order_id", table: "crm_work_orders" },
    ],
  },
  {
    table: "crm_imports",
    optional: [],
    parents: [],
    floorExempt:
      "An import is an event, and the seed records exactly one — itself "
      + "(ADR-230). Two hundred and fifty import events would be a fiction "
      + "about how the book arrived.",
  },
  {
    table: "crm_portal_messages",
    optional: ["request_id", "read_at"],
    parents: [{ column: "account_id", table: "crm_accounts" }],
    floorExempt:
      "A thread exists only where a customer holds a portal seat, and only the "
      + "staff side can be seeded: the customer's messages are written through "
      + "their own login (ADR-233), which the seeder cannot hold.",
  },
  {
    table: "crm_sla_policies",
    optional: [],
    parents: [],
    floorExempt:
      "At most six rows per workspace, one per request kind; the defaults live "
      + "in the schema and the seed overrides one (ADR-233).",
  },
  {
    table: "crm_scoring_rules",
    optional: ["note"],
    enumColumn: "model",
    parents: [],
    floorExempt:
      "A workspace overrides a handful of its 27 default rules at most (ADR-229); "
      + "the defaults live in the database, not in rows, so 250 overrides would be "
      + "a workspace that had rewritten every rule nine times.",
  },
  {
    table: "crm_tasks",
    optional: [
      "account_id", "opportunity_id", "assignee_employee_id", "detail", "suggestion_key",
      "reason", "done_at", "cancelled_at",
    ],
    enumColumn: "status",
    parents: [
      { column: "account_id", table: "crm_accounts" },
      { column: "opportunity_id", table: "crm_opportunities" },
      { column: "assignee_employee_id", table: "crm_employees" },
    ],
  },
  {
    // `settled_at` and `processor_reference` are absent on purpose, exactly
    // as ADR-217's dispatch columns are: only a real settlement through a
    // connected processor writes them, and a seeded value in either would
    // be a claim that money moved.
    table: "crm_charge_attempts",
    optional: ["failure_reason", "cancelled_at"],
    enumColumn: "state",
    parents: [
      { column: "enrollment_id", table: "crm_autopay_enrollments" },
      { column: "invoice_id", table: "crm_invoices" },
    ],
  },
];

/**
 * The tables this report audits, by name. Exported so a census test can
 * compare it against the schema the migrations actually create.
 */
export const SEED_SPEC_TABLES: readonly string[] = SPECS.map((spec) => spec.table);

/**
 * CRM tables the seed deliberately does NOT populate, each with the reason.
 *
 * This map exists because the roster above is hand-written, and a
 * hand-written roster silently stops covering the schema the moment
 * somebody adds a table. "48/48 tables passing" then reads as complete
 * when it is not — the worst kind of green. `seed-report-covers-every-table`
 * requires every crm_ table to be in one list or the other, so a new table
 * forces a decision rather than slipping past.
 *
 * A reason here is a claim about the table's nature, not an excuse for
 * skipping work: each says why 250 rows of it would be fiction.
 */
export const DELIBERATELY_UNSEEDED: Readonly<Record<string, string>> = {
  crm_portal_surveys:
    "A rating is the customer's own word, written only through their portal "
    + "login (ADR-233). Staff hold no INSERT on the table, so the seeder — "
    + "which writes as a member — cannot fabricate one, and should not.",
  crm_followup_dismissals:
    "A dismissal is one person's decision about one computed suggestion "
    + "(ADR-228). Seeding it would fabricate judgement nobody exercised, "
    + "and would hide real suggestions from the demo book for thirty days.",
  crm_service_integrations:
    "A registry of at most one row per provider per workspace (ADR-207). "
    + "Eight providers cannot honestly become 250 rows, and the rows it does "
    + "hold are seeded as disabled so nothing reads as connected.",
};


const SAMPLE = 1000;

async function countRows(
  client: SupabaseClient,
  table: string,
  organizationId: string,
): Promise<number | { error: string }> {
  const result = await client
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  if (result.error) return { error: result.error.message };
  return result.count ?? 0;
}

/**
 * Build the report. Optional-field and enum coverage are measured over a
 * bounded sample; counts and orphan checks are exact.
 */
export async function buildSeedReport(
  client: SupabaseClient,
  organizationId: string,
): Promise<SeedReport> {
  const tables: TableReport[] = [];

  for (const spec of SPECS) {
    const notes: string[] = [];
    const records = await countRows(client, spec.table, organizationId);
    if (typeof records !== "number") {
      tables.push({
        table: spec.table,
        records: 0,
        populatedOptionalFields: [],
        emptyOptionalFields: spec.optional,
        enumColumn: spec.enumColumn ?? null,
        enumValues: [],
        orphans: 0,
        relationships: [],
        meetsFloor: false,
        pass: false,
        notes: [`Unreadable: ${records.error}`],
      });
      continue;
    }

    const columns = [
      "id",
      ...spec.optional,
      ...(spec.enumColumn ? [spec.enumColumn] : []),
      ...spec.parents.map((parent) => parent.column),
    ];
    /*
     * Order by the uuid primary key rather than taking the first page.
     * Insert order clusters by kind — a timeline's first thousand rows are
     * all trigger-written status changes — and judging optional-field
     * coverage on that slice would fail a table that is perfectly
     * populated further in. Random uuids spread the sample across the
     * whole book.
     */
    const sampled = await client
      .from(spec.table)
      .select([...new Set(columns)].join(", "))
      .eq("organization_id", organizationId)
      .order("id", { ascending: true })
      .limit(SAMPLE);
    if (sampled.error) {
      tables.push({
        table: spec.table,
        records,
        populatedOptionalFields: [],
        emptyOptionalFields: spec.optional,
        enumColumn: spec.enumColumn ?? null,
        enumValues: [],
        orphans: 0,
        relationships: [],
        meetsFloor: records >= SEED_RECORD_FLOOR,
        pass: false,
        notes: [`Unreadable sample: ${sampled.error.message}`],
      });
      continue;
    }
    const rows = (sampled.data ?? []) as unknown as Record<string, unknown>[];

    const populated = spec.optional.filter((column) =>
      rows.some((row) => row[column] !== null && row[column] !== undefined && row[column] !== ""),
    );
    const empty = spec.optional.filter((column) => !populated.includes(column));

    const enumValues = spec.enumColumn
      ? [...new Set(rows.map((row) => String(row[spec.enumColumn as string])))].filter(
          (value) => value !== "null" && value !== "undefined",
        ).sort()
      : [];

    /*
     * Orphans: every non-null reference must resolve to a row this
     * organization can see. The database's foreign keys already guarantee
     * this — checking anyway is how the report proves it rather than
     * assuming it, and it catches a parent deleted out from under a child.
     */
    let orphans = 0;
    const relationships: string[] = [];
    for (const parent of spec.parents) {
      const references = [
        ...new Set(
          rows
            .map((row) => row[parent.column])
            .filter((value): value is string => typeof value === "string"),
        ),
      ];
      if (references.length === 0) {
        relationships.push(`${parent.column} → ${parent.table}: no references sampled`);
        continue;
      }
      const found = await client
        .from(parent.table)
        .select("id")
        .eq("organization_id", organizationId)
        .in("id", references.slice(0, 500));
      if (found.error) {
        notes.push(`${parent.column}: ${found.error.message}`);
        continue;
      }
      const present = new Set(((found.data ?? []) as { id: string }[]).map((row) => row.id));
      const missing = references.slice(0, 500).filter((id) => !present.has(id));
      orphans += missing.length;
      relationships.push(
        `${parent.column} → ${parent.table}: ${references.length} referenced, ${missing.length} orphaned`,
      );
    }

    const meetsFloor = spec.floorExempt !== undefined || records >= SEED_RECORD_FLOOR;
    if (spec.floorExempt) notes.push(spec.floorExempt);
    if (empty.length > 0) notes.push(`Optional columns empty in the sample: ${empty.join(", ")}`);
    if (spec.enumColumn && enumValues.length < 2) {
      notes.push(`Only ${enumValues.length} distinct ${spec.enumColumn} value(s) — coverage is thin`);
    }

    const pass =
      meetsFloor
      && orphans === 0
      && empty.length === 0
      && (!spec.enumColumn || enumValues.length >= 2);

    tables.push({
      table: spec.table,
      records,
      populatedOptionalFields: populated,
      emptyOptionalFields: empty,
      enumColumn: spec.enumColumn ?? null,
      enumValues,
      orphans,
      relationships,
      meetsFloor,
      pass,
      notes,
    });
  }

  const passing = tables.filter((table) => table.pass).length;
  return {
    organizationId,
    generatedAt: new Date().toISOString(),
    floor: SEED_RECORD_FLOOR,
    tables,
    totals: {
      tables: tables.length,
      records: tables.reduce((sum, table) => sum + table.records, 0),
      passing,
      failing: tables.length - passing,
    },
    pass: passing === tables.length,
  };
}

/** The report as a plain-text table, for a terminal or a CI log. */
export function formatSeedReport(report: SeedReport): string {
  const lines = [
    `Seed report — organization ${report.organizationId}`,
    `Generated ${report.generatedAt}; floor ${report.floor} records per table`,
    "",
    "TABLE                     RECORDS  OPTIONAL FIELDS  ENUM VALUES  ORPHANS  RESULT",
  ];
  for (const table of report.tables) {
    const optional =
      table.populatedOptionalFields.length + table.emptyOptionalFields.length === 0
        ? "—"
        : `${table.populatedOptionalFields.length}/${table.populatedOptionalFields.length + table.emptyOptionalFields.length}`;
    lines.push(
      [
        table.table.padEnd(24),
        String(table.records).padStart(8),
        optional.padStart(16),
        String(table.enumValues.length || "—").padStart(12),
        String(table.orphans).padStart(8),
        (table.pass ? "  PASS" : "  FAIL"),
      ].join(""),
    );
    for (const note of table.notes) lines.push(`    · ${note}`);
  }
  lines.push(
    "",
    `${report.totals.passing}/${report.totals.tables} tables passing, ${report.totals.records} records total — ${report.pass ? "PASS" : "FAIL"}`,
  );
  return lines.join("\n");
}
