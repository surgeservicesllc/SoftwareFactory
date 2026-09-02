/**
 * The whole book, table by table, under the caller's own RLS (ADR-230).
 *
 * "Data held hostage" is the complaint; the answer is a list of every
 * table this product writes about a workspace and a download for each,
 * read through the same policies the pages use. The list is explicit —
 * an allowlist, not a catalogue query — so the export can never reach a
 * table that is not the customer's.
 */

export const CRM_EXPORT_TABLES = [
  "crm_accounts",
  "crm_contacts",
  "crm_properties",
  "crm_property_units",
  "crm_timeline_events",
  "crm_opportunities",
  "crm_technicians",
  "crm_service_plans",
  "crm_plan_steps",
  "crm_work_orders",
  "crm_routes",
  "crm_route_stops",
  "crm_devices",
  "crm_device_events",
  "crm_pest_sightings",
  "crm_products",
  "crm_product_lots",
  "crm_applications",
  "crm_compliance_rules",
  "crm_stock_movements",
  "crm_estimates",
  "crm_estimate_lines",
  "crm_contracts",
  "crm_invoices",
  "crm_invoice_lines",
  "crm_payments",
  "crm_refunds",
  "crm_billing_runs",
  "crm_dunning_notices",
  "crm_payment_instruments",
  "crm_payment_mandates",
  "crm_autopay_enrollments",
  "crm_charge_attempts",
  "crm_branches",
  "crm_employees",
  "crm_territories",
  "crm_commissions",
  "crm_canvass_routes",
  "crm_knocks",
  "crm_documents",
  "crm_service_documents",
  "crm_marketing_lists",
  "crm_list_members",
  "crm_campaigns",
  "crm_messages",
  "crm_automations",
  "crm_attributions",
  "crm_notices",
  "crm_contact_preferences",
  "crm_form_templates",
  "crm_form_fields",
  "crm_form_instances",
  "crm_form_answers",
  "crm_timesheets",
  "crm_equipment",
  "crm_equipment_events",
  "crm_wdo_inspections",
  "crm_wdo_findings",
  "crm_portal_users",
  "crm_portal_requests",
  "crm_field_submissions",
  "crm_service_integrations",
  "crm_tasks",
  "crm_followup_dismissals",
  "crm_scoring_rules",
  "crm_imports",
] as const;

export type CrmExportTable = (typeof CRM_EXPORT_TABLES)[number];

const TABLE_SET = new Set<string>(CRM_EXPORT_TABLES);
export function isExportTable(value: string): value is CrmExportTable {
  return TABLE_SET.has(value);
}

/** Rows per read; the route pages by id until the table is exhausted. */
export const EXPORT_PAGE = 2000;
/** A ceiling per table so one download cannot run forever. */
export const EXPORT_ROW_CEILING = 100_000;
