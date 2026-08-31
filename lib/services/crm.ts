/**
 * The Services CRM's shared vocabulary and views (ADR-185).
 *
 * One definition of what an account, contact, property and timeline event
 * look like on the wire, shared by every route and test. The database rows
 * are snake_case and the product speaks camelCase; the mapping lives here
 * once so a renamed column cannot drift half the surfaces.
 */

export const CRM_ACCOUNT_KINDS = ["residential", "commercial"] as const;
export type CrmAccountKind = (typeof CRM_ACCOUNT_KINDS)[number];

export const CRM_ACCOUNT_STATUSES = ["lead", "prospect", "customer", "inactive"] as const;
export type CrmAccountStatus = (typeof CRM_ACCOUNT_STATUSES)[number];

/**
 * The kinds a member may record by hand. `status_change`, `service` and
 * `payment` are deliberately absent: those are system-written history
 * (a trigger today; field-service and billing machinery in later
 * increments), and a route that accepted them would let anyone type a
 * payment into the audit trail.
 */
export const CRM_MANUAL_TIMELINE_KINDS = ["note", "call", "email", "sms", "task"] as const;
export type CrmManualTimelineKind = (typeof CRM_MANUAL_TIMELINE_KINDS)[number];

export const CRM_OPPORTUNITY_STAGES = [
  "new",
  "contacted",
  "inspection",
  "proposal",
  "negotiation",
  "won",
  "lost",
] as const;
export type CrmOpportunityStage = (typeof CRM_OPPORTUNITY_STAGES)[number];

/**
 * The stages a deal can be created in. Won and lost are moves, not starting
 * points: a pipeline entry that begins closed never went through the
 * pipeline, and conversion reporting would be counting fiction.
 */
export const CRM_OPEN_OPPORTUNITY_STAGES = [
  "new",
  "contacted",
  "inspection",
  "proposal",
  "negotiation",
] as const;

export const CRM_WORK_ORDER_STATUSES = [
  "scheduled",
  "dispatched",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type CrmWorkOrderStatus = (typeof CRM_WORK_ORDER_STATUSES)[number];

export const CRM_SERVICE_RECURRENCES = [
  "weekly",
  "biweekly",
  "monthly",
  "bimonthly",
  "quarterly",
  "semiannual",
  "annual",
] as const;
export type CrmServiceRecurrence = (typeof CRM_SERVICE_RECURRENCES)[number];

/**
 * The next due date after one visit is generated, in plan-date terms
 * (YYYY-MM-DD, no timezone). Month arithmetic clamps to the target month's
 * last day — a plan due January 31st recurs at the end of February, never
 * on March 2nd/3rd via rollover.
 */
export function advanceServiceDate(date: string, recurrence: CrmServiceRecurrence): string {
  const [year, month, day] = date.split("-").map(Number);
  const addDays = recurrence === "weekly" ? 7 : recurrence === "biweekly" ? 14 : 0;
  if (addDays > 0) {
    const advanced = new Date(Date.UTC(year, month - 1, day + addDays));
    return advanced.toISOString().slice(0, 10);
  }
  const addMonths =
    recurrence === "monthly" ? 1
    : recurrence === "bimonthly" ? 2
    : recurrence === "quarterly" ? 3
    : recurrence === "semiannual" ? 6
    : 12;
  const targetMonthIndex = month - 1 + addMonths;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const advanced = new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
  return advanced.toISOString().slice(0, 10);
}

export const CRM_DEVICE_TYPES = [
  "bait_station",
  "snap_trap",
  "multi_catch",
  "insect_light_trap",
  "pheromone_trap",
  "other",
] as const;
export type CrmDeviceType = (typeof CRM_DEVICE_TYPES)[number];

export const CRM_DEVICE_STATUSES = ["active", "removed"] as const;
export type CrmDeviceStatus = (typeof CRM_DEVICE_STATUSES)[number];

export const CRM_DEVICE_EVENT_KINDS = ["install", "service", "move", "remove"] as const;
export type CrmDeviceEventKind = (typeof CRM_DEVICE_EVENT_KINDS)[number];

export const CRM_DEVICE_CONDITIONS = ["ok", "needs_service", "damaged", "missing"] as const;
export type CrmDeviceCondition = (typeof CRM_DEVICE_CONDITIONS)[number];

export const CRM_SIGHTING_SEVERITIES = ["low", "moderate", "high"] as const;
export type CrmSightingSeverity = (typeof CRM_SIGHTING_SEVERITIES)[number];

/** The barcode grammar the schema CHECKs: scanable, no whitespace, 4-64. */
export const CRM_BARCODE_PATTERN = /^[A-Za-z0-9._\-]{4,64}$/;

export const CRM_APPLICATION_METHODS = [
  "bait",
  "crack_and_crevice",
  "spot",
  "perimeter",
  "broadcast",
  "void",
  "dust",
  "fumigation",
  "other",
] as const;
export type CrmApplicationMethod = (typeof CRM_APPLICATION_METHODS)[number];

export const CRM_MEASURE_UNITS = ["oz", "fl_oz", "lb", "g", "kg", "ml", "l", "gal", "each"] as const;
export type CrmMeasureUnit = (typeof CRM_MEASURE_UNITS)[number];

export const CRM_SIGNAL_WORDS = ["CAUTION", "WARNING", "DANGER"] as const;

/** The EPA registration grammar the schema CHECKs. */
export const CRM_EPA_PATTERN = /^[0-9]{2,7}-[0-9]{1,7}(-[0-9]{1,7})?$/;
/** A jurisdiction code: "US-OR", "CA-ON", "US". Never a fixed list. */
export const CRM_JURISDICTION_PATTERN = /^[A-Z]{2}(-[A-Z0-9]{1,10})?$/;

export const CRM_ACCOUNT_COLUMNS =
  "id, name, kind, status, email, phone, source, billing_address, notes, created_at, updated_at";
export const CRM_CONTACT_COLUMNS =
  "id, account_id, first_name, last_name, role, email, phone, is_primary, created_at";
export const CRM_PROPERTY_COLUMNS =
  "id, account_id, label, address, property_type, access_notes, created_at";
export const CRM_TIMELINE_COLUMNS =
  "id, account_id, kind, summary, detail, occurred_at, recorded_at, actor_user_id";
export const CRM_OPPORTUNITY_COLUMNS =
  "id, account_id, name, stage, value_cents, expected_close_date, notes, lost_reason, closed_at, owner_employee_id, created_at, updated_at";
export const CRM_TECHNICIAN_COLUMNS =
  "id, first_name, last_name, email, phone, license_number, active, branch_id, reports_to_id, hire_date, license_expires_on, license_state, created_at, updated_at";
export const CRM_SERVICE_PLAN_COLUMNS =
  "id, account_id, property_id, service_type, recurrence, next_due, technician_id, value_cents, active, notes, created_at, updated_at";
export const CRM_WORK_ORDER_COLUMNS =
  "id, account_id, property_id, technician_id, plan_id, status, service_type, scheduled_start, scheduled_end, instructions, completion_notes, completed_at, created_at, updated_at";
export const CRM_PRODUCT_COLUMNS =
  "id, name, epa_registration_number, active_ingredient, signal_word, sds_url, label_url, restricted_use, default_unit, active, created_at, updated_at";
export const CRM_LOT_COLUMNS =
  "id, product_id, lot_number, unit, quantity_received, quantity_remaining, received_on, expires_on, created_at, updated_at";
export const CRM_APPLICATION_COLUMNS =
  "id, account_id, property_id, work_order_id, product_id, lot_id, device_id, technician_id, applicator_license, method, target_pest, quantity, unit, application_rate, treated_area, location_note, note, applied_at, recorded_at, supersedes_id";
export const CRM_COMPLIANCE_RULE_COLUMNS =
  "id, jurisdiction, label, retention_years, requires_applicator_license, requires_target_pest, requires_application_rate, requires_treated_area, notes, active, created_at, updated_at";
export const CRM_DEVICE_COLUMNS =
  "id, account_id, property_id, label, device_type, barcode, status, location_note, activity_threshold, installed_at, removed_at, created_at, updated_at";
export const CRM_DEVICE_EVENT_COLUMNS =
  "id, device_id, event, condition, activity_count, pest_observed, location_note, note, work_order_id, recorded_at, actor_user_id";
export const CRM_SIGHTING_COLUMNS =
  "id, account_id, property_id, pest, severity, location_note, note, sighted_at, corrective_action, corrected_at, reported_by_portal_user_id, created_at, updated_at";

export type CrmAccountRow = {
  id: string;
  name: string;
  kind: string;
  status: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  billing_address: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmContactRow = {
  id: string;
  account_id: string;
  first_name: string;
  last_name: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  created_at: string;
};

export type CrmPropertyRow = {
  id: string;
  account_id: string;
  label: string;
  address: string;
  property_type: string | null;
  access_notes: string | null;
  created_at: string;
};

export type CrmOpportunityRow = {
  id: string;
  account_id: string;
  name: string;
  stage: string;
  value_cents: number | null;
  expected_close_date: string | null;
  notes: string | null;
  lost_reason: string | null;
  closed_at: string | null;
  // Increment 7: the rep working the deal, which the leaderboard reads.
  owner_employee_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmTechnicianRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  license_number: string | null;
  active: boolean;
  // Increment 7: a technician's place in the company.
  branch_id: string | null;
  reports_to_id: string | null;
  hire_date: string | null;
  // Increment 9: when the applicator licence lapses, and where it is held.
  license_expires_on: string | null;
  license_state: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmServicePlanRow = {
  id: string;
  account_id: string;
  property_id: string;
  service_type: string;
  recurrence: string;
  next_due: string;
  technician_id: string | null;
  value_cents: number | null;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmWorkOrderRow = {
  id: string;
  account_id: string;
  property_id: string;
  technician_id: string | null;
  plan_id: string | null;
  status: string;
  service_type: string;
  scheduled_start: string;
  scheduled_end: string;
  instructions: string | null;
  completion_notes: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmDeviceRow = {
  id: string;
  account_id: string;
  property_id: string;
  label: string;
  device_type: string;
  barcode: string;
  status: string;
  location_note: string | null;
  activity_threshold: number | null;
  installed_at: string;
  removed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmDeviceEventRow = {
  id: string;
  device_id: string;
  event: string;
  condition: string | null;
  activity_count: number | null;
  pest_observed: string | null;
  location_note: string | null;
  note: string | null;
  work_order_id: string | null;
  recorded_at: string;
  actor_user_id: string | null;
};

export type CrmSightingRow = {
  id: string;
  account_id: string;
  property_id: string;
  pest: string;
  severity: string;
  location_note: string | null;
  note: string | null;
  sighted_at: string;
  corrective_action: string | null;
  corrected_at: string | null;
  /* Increment 15: null for everything staff wrote, set when the customer
   * reported it through the portal. */
  reported_by_portal_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmProductRow = {
  id: string;
  name: string;
  epa_registration_number: string | null;
  active_ingredient: string | null;
  signal_word: string | null;
  sds_url: string | null;
  label_url: string | null;
  restricted_use: boolean;
  default_unit: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type CrmLotRow = {
  id: string;
  product_id: string;
  lot_number: string;
  unit: string;
  quantity_received: string | number;
  quantity_remaining: string | number;
  received_on: string;
  expires_on: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmApplicationRow = {
  id: string;
  account_id: string;
  property_id: string;
  work_order_id: string | null;
  product_id: string;
  lot_id: string | null;
  device_id: string | null;
  technician_id: string;
  applicator_license: string | null;
  method: string;
  target_pest: string | null;
  quantity: string | number;
  unit: string;
  application_rate: string | null;
  treated_area: string | null;
  location_note: string | null;
  note: string | null;
  applied_at: string;
  recorded_at: string;
  supersedes_id: string | null;
};

export type CrmComplianceRuleRow = {
  id: string;
  jurisdiction: string;
  label: string;
  retention_years: number;
  requires_applicator_license: boolean;
  requires_target_pest: boolean;
  requires_application_rate: boolean;
  requires_treated_area: boolean;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type CrmTimelineRow = {
  id: string;
  account_id: string;
  kind: string;
  summary: string;
  detail: string | null;
  occurred_at: string;
  recorded_at: string;
  actor_user_id: string | null;
};

/**
 * Duplicate-detection normalization, mirroring the generated columns in
 * 20260830000700_crm_pipeline_search.sql expression for expression. The
 * database computes the stored side; these compute the probe side; if the
 * two ever disagree, duplicate detection silently goes blind — which is why
 * the chain suite asserts the stored values these produce.
 */
export function normalizeAccountName(name: string): string | null {
  const normal = name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return normal === "" ? null : normal;
}

export function normalizeAccountEmail(email: string | null | undefined): string | null {
  const normal = (email ?? "").trim().toLowerCase();
  return normal === "" ? null : normal;
}

export function normalizeAccountPhone(phone: string | null | undefined): string | null {
  const normal = (phone ?? "").replace(/[^0-9]/g, "");
  return normal === "" ? null : normal;
}

export function toAccountView(row: CrmAccountRow) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    email: row.email,
    phone: row.phone,
    source: row.source,
    billingAddress: row.billing_address,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toContactView(row: CrmContactRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    firstName: row.first_name,
    lastName: row.last_name,
    role: row.role,
    email: row.email,
    phone: row.phone,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
  };
}

export function toPropertyView(row: CrmPropertyRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    label: row.label,
    address: row.address,
    propertyType: row.property_type,
    accessNotes: row.access_notes,
    createdAt: row.created_at,
  };
}

export function toOpportunityView(row: CrmOpportunityRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    stage: row.stage,
    valueCents: row.value_cents,
    expectedCloseDate: row.expected_close_date,
    notes: row.notes,
    lostReason: row.lost_reason,
    closedAt: row.closed_at,
    ownerEmployeeId: row.owner_employee_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toTechnicianView(row: CrmTechnicianRow) {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    licenseNumber: row.license_number,
    active: row.active,
    branchId: row.branch_id,
    reportsToId: row.reports_to_id,
    hireDate: row.hire_date,
    licenseExpiresOn: row.license_expires_on,
    licenseState: row.license_state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toServicePlanView(row: CrmServicePlanRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    propertyId: row.property_id,
    serviceType: row.service_type,
    recurrence: row.recurrence,
    nextDue: row.next_due,
    technicianId: row.technician_id,
    valueCents: row.value_cents,
    active: row.active,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toWorkOrderView(row: CrmWorkOrderRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    propertyId: row.property_id,
    technicianId: row.technician_id,
    planId: row.plan_id,
    status: row.status,
    serviceType: row.service_type,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    instructions: row.instructions,
    completionNotes: row.completion_notes,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toDeviceView(row: CrmDeviceRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    propertyId: row.property_id,
    label: row.label,
    deviceType: row.device_type,
    barcode: row.barcode,
    status: row.status,
    locationNote: row.location_note,
    activityThreshold: row.activity_threshold,
    installedAt: row.installed_at,
    removedAt: row.removed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toDeviceEventView(row: CrmDeviceEventRow) {
  return {
    id: row.id,
    deviceId: row.device_id,
    event: row.event,
    condition: row.condition,
    activityCount: row.activity_count,
    pestObserved: row.pest_observed,
    locationNote: row.location_note,
    note: row.note,
    workOrderId: row.work_order_id,
    recordedAt: row.recorded_at,
    recordedBySystem: row.actor_user_id === null,
  };
}

export function toSightingView(row: CrmSightingRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    propertyId: row.property_id,
    pest: row.pest,
    severity: row.severity,
    locationNote: row.location_note,
    note: row.note,
    sightedAt: row.sighted_at,
    correctiveAction: row.corrective_action,
    correctedAt: row.corrected_at,
    /* Who is asking. A sighting the customer filed and one a technician
     * observed are the same kind of fact, but a branch triaging the
     * morning list needs to know which is in front of them — the customer
     * is waiting on a call back. */
    reportedByCustomer: row.reported_by_portal_user_id !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** numeric(14,3) arrives as a string over the wire; the product speaks numbers. */
function decimal(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

export function toProductView(row: CrmProductRow) {
  return {
    id: row.id,
    name: row.name,
    epaRegistrationNumber: row.epa_registration_number,
    activeIngredient: row.active_ingredient,
    signalWord: row.signal_word,
    sdsUrl: row.sds_url,
    labelUrl: row.label_url,
    restrictedUse: row.restricted_use,
    defaultUnit: row.default_unit,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toLotView(row: CrmLotRow) {
  return {
    id: row.id,
    productId: row.product_id,
    lotNumber: row.lot_number,
    unit: row.unit,
    quantityReceived: decimal(row.quantity_received),
    quantityRemaining: decimal(row.quantity_remaining),
    receivedOn: row.received_on,
    expiresOn: row.expires_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toApplicationView(row: CrmApplicationRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    propertyId: row.property_id,
    workOrderId: row.work_order_id,
    productId: row.product_id,
    lotId: row.lot_id,
    deviceId: row.device_id,
    technicianId: row.technician_id,
    applicatorLicense: row.applicator_license,
    method: row.method,
    targetPest: row.target_pest,
    quantity: decimal(row.quantity),
    unit: row.unit,
    applicationRate: row.application_rate,
    treatedArea: row.treated_area,
    locationNote: row.location_note,
    note: row.note,
    appliedAt: row.applied_at,
    recordedAt: row.recorded_at,
    supersedesId: row.supersedes_id,
  };
}

export function toComplianceRuleView(row: CrmComplianceRuleRow) {
  return {
    id: row.id,
    jurisdiction: row.jurisdiction,
    label: row.label,
    retentionYears: row.retention_years,
    requiresApplicatorLicense: row.requires_applicator_license,
    requiresTargetPest: row.requires_target_pest,
    requiresApplicationRate: row.requires_application_rate,
    requiresTreatedArea: row.requires_treated_area,
    notes: row.notes,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toTimelineView(row: CrmTimelineRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    kind: row.kind,
    summary: row.summary,
    detail: row.detail,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    // Whether a person or the system recorded it — the id itself stays
    // server-side; a name join can come when the page needs one.
    recordedBySystem: row.actor_user_id === null,
  };
}

/* -------------------------------------------------------------------------
 * Billing: estimates, contracts, invoices, payments and refunds. The money
 * half of the chain. Every amount here is integer cents — the schema has no
 * floating-point money, and neither does this vocabulary.
 * ---------------------------------------------------------------------- */

export const CRM_ESTIMATE_STATUSES = ["draft", "sent", "accepted", "declined", "expired"] as const;
export type CrmEstimateStatus = (typeof CRM_ESTIMATE_STATUSES)[number];
/** The statuses that mean an estimate has been answered; these carry a decided_at. */
export const CRM_DECIDED_ESTIMATE_STATUSES = ["accepted", "declined", "expired"] as const;

export const CRM_CONTRACT_STATUSES = ["active", "ended", "cancelled"] as const;
export type CrmContractStatus = (typeof CRM_CONTRACT_STATUSES)[number];
/** The statuses that close a contract; these carry an ended_at. */
export const CRM_CLOSED_CONTRACT_STATUSES = ["ended", "cancelled"] as const;

export const CRM_INVOICE_STATUSES = ["draft", "open", "paid", "void", "uncollectible"] as const;
export type CrmInvoiceStatus = (typeof CRM_INVOICE_STATUSES)[number];
/**
 * `paid` is missing on purpose: the ledger decides it. A caller may raise,
 * void or write off an invoice; only a payment can mark one paid.
 */
export const CRM_SETTABLE_INVOICE_STATUSES = ["draft", "open", "void", "uncollectible"] as const;

export const CRM_PAYMENT_METHODS = ["card", "ach", "check", "cash", "other"] as const;
export type CrmPaymentMethod = (typeof CRM_PAYMENT_METHODS)[number];

export const CRM_ESTIMATE_COLUMNS =
  "id, account_id, property_id, opportunity_id, number, status, subtotal_cents, tax_cents, total_cents, valid_until, terms, notes, sent_at, decided_at, created_at, updated_at";
export const CRM_ESTIMATE_LINE_COLUMNS =
  "id, estimate_id, position, description, quantity, unit_price_cents, amount_cents, created_at";
export const CRM_CONTRACT_COLUMNS =
  "id, account_id, estimate_id, plan_id, number, status, value_cents, starts_on, ends_on, auto_renew, terms, notes, signed_at, signed_by_name, ended_at, created_at, updated_at";
export const CRM_INVOICE_COLUMNS =
  "id, account_id, contract_id, work_order_id, number, status, subtotal_cents, tax_cents, total_cents, paid_cents, issued_on, due_on, memo, voided_at, void_reason, created_at, updated_at";
export const CRM_INVOICE_LINE_COLUMNS =
  "id, invoice_id, position, description, quantity, unit_price_cents, amount_cents, created_at";
export const CRM_PAYMENT_COLUMNS =
  "id, account_id, invoice_id, amount_cents, method, reference, received_at, recorded_at, note";
export const CRM_REFUND_COLUMNS =
  "id, payment_id, amount_cents, reason, refunded_at, recorded_at";

export type CrmEstimateRow = {
  id: string;
  account_id: string;
  property_id: string | null;
  opportunity_id: string | null;
  number: string;
  status: CrmEstimateStatus;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  valid_until: string | null;
  terms: string | null;
  notes: string | null;
  sent_at: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmLineRow = {
  id: string;
  position: number;
  description: string;
  quantity: number | string;
  unit_price_cents: number;
  amount_cents: number;
  created_at: string;
};

export type CrmEstimateLineRow = CrmLineRow & { estimate_id: string };
export type CrmInvoiceLineRow = CrmLineRow & { invoice_id: string };

export type CrmContractRow = {
  id: string;
  account_id: string;
  estimate_id: string | null;
  plan_id: string | null;
  number: string;
  status: CrmContractStatus;
  value_cents: number;
  starts_on: string;
  ends_on: string | null;
  auto_renew: boolean;
  terms: string | null;
  notes: string | null;
  signed_at: string | null;
  signed_by_name: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmInvoiceRow = {
  id: string;
  account_id: string;
  contract_id: string | null;
  work_order_id: string | null;
  number: string;
  status: CrmInvoiceStatus;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  paid_cents: number;
  issued_on: string | null;
  due_on: string | null;
  memo: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmPaymentRow = {
  id: string;
  account_id: string;
  invoice_id: string;
  amount_cents: number;
  method: CrmPaymentMethod;
  reference: string | null;
  received_at: string;
  recorded_at: string;
  note: string | null;
};

export type CrmRefundRow = {
  id: string;
  payment_id: string;
  amount_cents: number;
  reason: string;
  refunded_at: string;
  recorded_at: string;
};

export function toEstimateView(row: CrmEstimateRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    propertyId: row.property_id,
    opportunityId: row.opportunity_id,
    number: row.number,
    status: row.status,
    subtotalCents: row.subtotal_cents,
    taxCents: row.tax_cents,
    totalCents: row.total_cents,
    validUntil: row.valid_until,
    terms: row.terms,
    notes: row.notes,
    sentAt: row.sent_at,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toLineView(row: CrmLineRow) {
  return {
    id: row.id,
    position: row.position,
    description: row.description,
    quantity: decimal(row.quantity),
    unitPriceCents: row.unit_price_cents,
    amountCents: row.amount_cents,
    createdAt: row.created_at,
  };
}

export function toContractView(row: CrmContractRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    estimateId: row.estimate_id,
    planId: row.plan_id,
    number: row.number,
    status: row.status,
    valueCents: row.value_cents,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    autoRenew: row.auto_renew,
    terms: row.terms,
    notes: row.notes,
    signedAt: row.signed_at,
    signedByName: row.signed_by_name,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toInvoiceView(row: CrmInvoiceRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    contractId: row.contract_id,
    workOrderId: row.work_order_id,
    number: row.number,
    status: row.status,
    subtotalCents: row.subtotal_cents,
    taxCents: row.tax_cents,
    totalCents: row.total_cents,
    paidCents: row.paid_cents,
    // Derived, never stored: what the ledger says is still owed.
    balanceCents: Math.max(0, row.total_cents - row.paid_cents),
    issuedOn: row.issued_on,
    dueOn: row.due_on,
    memo: row.memo,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toPaymentView(row: CrmPaymentRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    invoiceId: row.invoice_id,
    amountCents: row.amount_cents,
    method: row.method,
    reference: row.reference,
    receivedAt: row.received_at,
    recordedAt: row.recorded_at,
    note: row.note,
  };
}

export function toRefundView(row: CrmRefundRow) {
  return {
    id: row.id,
    paymentId: row.payment_id,
    amountCents: row.amount_cents,
    reason: row.reason,
    refundedAt: row.refunded_at,
    recordedAt: row.recorded_at,
  };
}

/**
 * An invoice is overdue when the ledger still shows a balance and the due
 * date has passed. Void and uncollectible invoices are settled matters —
 * they are not chased — and a draft has not been issued yet.
 */
export function isInvoiceOverdue(
  invoice: ReturnType<typeof toInvoiceView>,
  today = new Date().toISOString().slice(0, 10),
): boolean {
  if (invoice.status !== "open") return false;
  if (invoice.balanceCents <= 0) return false;
  return invoice.dueOn !== null && invoice.dueOn < today;
}

/* -------------------------------------------------------------------------
 * The company: branches, the org chart, territories and commissions. Until
 * increment 7 every row belonged to an organization and to nobody in
 * particular; these are the columns a branch manager reports on.
 * ---------------------------------------------------------------------- */

export const CRM_EMPLOYEE_ROLES = [
  "owner",
  "branch_manager",
  "sales_manager",
  "sales_rep",
  "csr",
  "dispatcher",
  "admin",
] as const;
export type CrmEmployeeRole = (typeof CRM_EMPLOYEE_ROLES)[number];

/** The roles a deal or an account can be owned by — who carries a quota. */
export const CRM_SELLING_ROLES = ["owner", "branch_manager", "sales_manager", "sales_rep"] as const;

export const CRM_COMMISSION_STATUSES = ["accrued", "approved", "paid", "void"] as const;
export type CrmCommissionStatus = (typeof CRM_COMMISSION_STATUSES)[number];

/** The short identity a branch, territory or employee is known by. */
export const CRM_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,11}$/;
export const CRM_EMPLOYEE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,15}$/;
/** A US-style region code; the schema CHECKs the same two letters. */
export const CRM_REGION_PATTERN = /^[A-Z]{2}$/;
export const CRM_POSTAL_PATTERN = /^[A-Z0-9][A-Z0-9 -]{0,10}$/;
/** An IANA zone name, matching the schema's CHECK. */
export const CRM_TIME_ZONE_PATTERN =
  /^[A-Za-z][A-Za-z_+-]{1,30}(\/[A-Za-z][A-Za-z_+-]{1,30}){0,2}$/;

export const CRM_BRANCH_COLUMNS =
  "id, manager_id, code, name, address, phone, email, time_zone, opened_on, closed_on, active, notes, created_at, updated_at";
export const CRM_EMPLOYEE_COLUMNS =
  "id, branch_id, reports_to_id, user_id, employee_code, first_name, last_name, email, phone, role, title, hire_date, end_date, commission_bps, monthly_quota_cents, active, notes, created_at, updated_at";
export const CRM_TERRITORY_COLUMNS =
  "id, branch_id, rep_id, name, code, city, region, postal_codes, active, notes, created_at, updated_at";
export const CRM_COMMISSION_COLUMNS =
  "id, employee_id, opportunity_id, contract_id, invoice_id, basis_cents, rate_bps, amount_cents, status, earned_on, approved_at, paid_at, note, created_at, updated_at";

export type CrmBranchRow = {
  id: string;
  manager_id: string | null;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  time_zone: string | null;
  opened_on: string | null;
  closed_on: string | null;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmEmployeeRow = {
  id: string;
  branch_id: string | null;
  reports_to_id: string | null;
  user_id: string | null;
  employee_code: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  role: CrmEmployeeRole;
  title: string | null;
  hire_date: string | null;
  end_date: string | null;
  commission_bps: number | null;
  monthly_quota_cents: number | null;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmTerritoryRow = {
  id: string;
  branch_id: string;
  rep_id: string | null;
  name: string;
  code: string;
  city: string | null;
  region: string | null;
  postal_codes: string[] | null;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmCommissionRow = {
  id: string;
  employee_id: string;
  opportunity_id: string | null;
  contract_id: string | null;
  invoice_id: string | null;
  basis_cents: number;
  rate_bps: number;
  amount_cents: number;
  status: CrmCommissionStatus;
  earned_on: string;
  approved_at: string | null;
  paid_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export function toBranchView(row: CrmBranchRow) {
  return {
    id: row.id,
    managerId: row.manager_id,
    code: row.code,
    name: row.name,
    address: row.address,
    phone: row.phone,
    email: row.email,
    timeZone: row.time_zone,
    openedOn: row.opened_on,
    closedOn: row.closed_on,
    active: row.active,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toEmployeeView(row: CrmEmployeeRow) {
  return {
    id: row.id,
    branchId: row.branch_id,
    reportsToId: row.reports_to_id,
    // The login link is reported as a fact, never as an identity: a staff
    // record is a person in the business, not an account.
    hasLogin: row.user_id !== null,
    employeeCode: row.employee_code,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    title: row.title,
    hireDate: row.hire_date,
    endDate: row.end_date,
    commissionBps: row.commission_bps,
    monthlyQuotaCents: row.monthly_quota_cents,
    active: row.active,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toTerritoryView(row: CrmTerritoryRow) {
  return {
    id: row.id,
    branchId: row.branch_id,
    repId: row.rep_id,
    name: row.name,
    code: row.code,
    city: row.city,
    region: row.region,
    postalCodes: row.postal_codes ?? [],
    active: row.active,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toCommissionView(row: CrmCommissionRow) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    opportunityId: row.opportunity_id,
    contractId: row.contract_id,
    invoiceId: row.invoice_id,
    basisCents: row.basis_cents,
    rateBps: row.rate_bps,
    amountCents: row.amount_cents,
    status: row.status,
    earnedOn: row.earned_on,
    approvedAt: row.approved_at,
    paidAt: row.paid_at,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** A person's display name, with the surname optional as the schema allows. */
export function employeeName(row: { firstName: string; lastName: string | null }): string {
  return `${row.firstName} ${row.lastName ?? ""}`.trim();
}

/* -------------------------------------------------------------------------
 * Documents, canvassing and the marketing hub. Three rules run through this
 * vocabulary: a document is a reference and never bytes, a knock and a
 * message are facts rather than drafts, and consent is a record with a
 * moment attached.
 * ---------------------------------------------------------------------- */

export const CRM_DOCUMENT_KINDS = [
  "contract", "estimate", "photo", "inspection_report", "service_report",
  "permit", "license", "invoice", "other",
] as const;
export type CrmDocumentKind = (typeof CRM_DOCUMENT_KINDS)[number];

export const CRM_CANVASS_STATUSES = ["planned", "walking", "complete", "cancelled"] as const;
export type CrmCanvassStatus = (typeof CRM_CANVASS_STATUSES)[number];

export const CRM_KNOCK_DISPOSITIONS = [
  "no_answer", "not_home", "not_interested", "callback", "appointment_set",
  "sold", "do_not_knock",
] as const;
export type CrmKnockDisposition = (typeof CRM_KNOCK_DISPOSITIONS)[number];
/** The dispositions that leave something to come back to. */
export const CRM_PENDING_DISPOSITIONS = ["callback", "appointment_set"] as const;

export const CRM_CHANNELS = ["email", "sms", "postcard"] as const;
export type CrmChannel = (typeof CRM_CHANNELS)[number];

export const CRM_CAMPAIGN_STATUSES = ["draft", "scheduled", "sending", "sent", "cancelled"] as const;
export type CrmCampaignStatus = (typeof CRM_CAMPAIGN_STATUSES)[number];

export const CRM_MESSAGE_STATUSES = [
  "queued", "sent", "delivered", "opened", "clicked", "bounced", "failed", "unsubscribed",
] as const;
export type CrmMessageStatus = (typeof CRM_MESSAGE_STATUSES)[number];
/** The statuses that carry a failure reason, and only those. */
export const CRM_FAILED_MESSAGE_STATUSES = ["bounced", "failed"] as const;

export const CRM_AUTOMATION_TRIGGERS = [
  "lead_created", "service_completed", "invoice_overdue", "contract_renewing",
  "sighting_recorded", "estimate_sent",
] as const;
export type CrmAutomationTrigger = (typeof CRM_AUTOMATION_TRIGGERS)[number];

export const CRM_AUTOMATION_ACTIONS = [
  "send_email", "send_sms", "create_task", "notify_manager", "schedule_followup",
] as const;
export type CrmAutomationAction = (typeof CRM_AUTOMATION_ACTIONS)[number];
/** The actions that carry the text they would send. */
export const CRM_SENDING_ACTIONS = ["send_email", "send_sms"] as const;

export const CRM_TOUCH_POSITIONS = ["first", "assist", "last"] as const;
export type CrmTouchPosition = (typeof CRM_TOUCH_POSITIONS)[number];

/**
 * A private storage path, matching the schema's CHECK. Deliberately refuses
 * anything containing a scheme: a public URL stored as a document reference
 * would be an access-control hole wearing a column name.
 */
export const CRM_STORAGE_PATH_PATTERN = /^[a-z0-9][a-z0-9._/-]*$/;
export function isStoragePath(value: string): boolean {
  // Shape, length and the absence of a scheme, checked apart exactly as the
  // schema checks them — PostgreSQL will not compile a repetition count
  // above 255, so the length cannot live inside the pattern.
  return (
    CRM_STORAGE_PATH_PATTERN.test(value)
    && value.length >= 3
    && value.length <= 301
    && !value.includes("://")
  );
}
export const CRM_CONTENT_TYPE_PATTERN = /^[a-z]+\/[a-zA-Z0-9.+-]{1,80}$/;

export const CRM_DOCUMENT_COLUMNS =
  "id, account_id, property_id, work_order_id, title, kind, storage_path, content_type, byte_size, notes, uploaded_at, created_at, updated_at";
export const CRM_CANVASS_ROUTE_COLUMNS =
  "id, territory_id, rep_id, name, status, walked_on, started_at, ended_at, notes, created_at, updated_at";
export const CRM_KNOCK_COLUMNS =
  "id, canvass_route_id, account_id, address, disposition, knocked_at, follow_up_on, note";
export const CRM_MARKETING_LIST_COLUMNS =
  "id, name, description, is_dynamic, criteria, active, created_at, updated_at";
export const CRM_LIST_MEMBER_COLUMNS =
  "id, list_id, account_id, source, added_at, unsubscribed_at, unsubscribe_reason";
export const CRM_CAMPAIGN_COLUMNS =
  "id, list_id, name, channel, status, subject, body, budget_cents, scheduled_at, sent_at, created_at, updated_at";
export const CRM_MESSAGE_COLUMNS =
  "id, campaign_id, account_id, channel, status, destination, queued_at, sent_at, delivered_at, opened_at, clicked_at, failure_reason";
export const CRM_AUTOMATION_COLUMNS =
  "id, name, trigger_on, action, delay_hours, template, active, last_run_at, run_count, created_at, updated_at";
export const CRM_ATTRIBUTION_COLUMNS =
  "id, account_id, opportunity_id, campaign_id, knock_id, source, medium, position, touched_at, note";

export type CrmDocumentRow = {
  id: string;
  account_id: string | null;
  property_id: string | null;
  work_order_id: string | null;
  title: string;
  kind: CrmDocumentKind;
  storage_path: string;
  content_type: string | null;
  byte_size: number | null;
  notes: string | null;
  uploaded_at: string;
  created_at: string;
  updated_at: string;
};

export type CrmCanvassRouteRow = {
  id: string;
  territory_id: string | null;
  rep_id: string | null;
  name: string;
  status: CrmCanvassStatus;
  walked_on: string;
  started_at: string | null;
  ended_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmKnockRow = {
  id: string;
  canvass_route_id: string;
  account_id: string | null;
  address: string;
  disposition: CrmKnockDisposition;
  knocked_at: string;
  follow_up_on: string | null;
  note: string | null;
};

export type CrmMarketingListRow = {
  id: string;
  name: string;
  description: string | null;
  is_dynamic: boolean;
  criteria: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type CrmListMemberRow = {
  id: string;
  list_id: string;
  account_id: string;
  source: string | null;
  added_at: string;
  unsubscribed_at: string | null;
  unsubscribe_reason: string | null;
};

export type CrmCampaignRow = {
  id: string;
  list_id: string | null;
  name: string;
  channel: CrmChannel;
  status: CrmCampaignStatus;
  subject: string | null;
  body: string | null;
  budget_cents: number | null;
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmMessageRow = {
  id: string;
  campaign_id: string;
  account_id: string;
  channel: CrmChannel;
  status: CrmMessageStatus;
  destination: string | null;
  queued_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  failure_reason: string | null;
};

export type CrmAutomationRow = {
  id: string;
  name: string;
  trigger_on: CrmAutomationTrigger;
  action: CrmAutomationAction;
  delay_hours: number;
  template: string | null;
  active: boolean;
  last_run_at: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
};

export type CrmAttributionRow = {
  id: string;
  account_id: string;
  opportunity_id: string | null;
  campaign_id: string | null;
  knock_id: string | null;
  source: string;
  medium: string | null;
  position: CrmTouchPosition;
  touched_at: string;
  note: string | null;
};

export function toDocumentView(row: CrmDocumentRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    propertyId: row.property_id,
    workOrderId: row.work_order_id,
    title: row.title,
    kind: row.kind,
    // The path is reported, never a link: whoever renders this has to ask
    // storage for a signed URL, which is where the access check lives.
    storagePath: row.storage_path,
    contentType: row.content_type,
    byteSize: row.byte_size,
    notes: row.notes,
    uploadedAt: row.uploaded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toCanvassRouteView(row: CrmCanvassRouteRow) {
  return {
    id: row.id,
    territoryId: row.territory_id,
    repId: row.rep_id,
    name: row.name,
    status: row.status,
    walkedOn: row.walked_on,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toKnockView(row: CrmKnockRow) {
  return {
    id: row.id,
    canvassRouteId: row.canvass_route_id,
    accountId: row.account_id,
    address: row.address,
    disposition: row.disposition,
    knockedAt: row.knocked_at,
    followUpOn: row.follow_up_on,
    note: row.note,
  };
}

export function toMarketingListView(row: CrmMarketingListRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isDynamic: row.is_dynamic,
    criteria: row.criteria,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toListMemberView(row: CrmListMemberRow) {
  return {
    id: row.id,
    listId: row.list_id,
    accountId: row.account_id,
    source: row.source,
    addedAt: row.added_at,
    unsubscribedAt: row.unsubscribed_at,
    unsubscribeReason: row.unsubscribe_reason,
    // Consent as the page needs to read it: a fact with a moment behind it.
    subscribed: row.unsubscribed_at === null,
  };
}

export function toCampaignView(row: CrmCampaignRow) {
  return {
    id: row.id,
    listId: row.list_id,
    name: row.name,
    channel: row.channel,
    status: row.status,
    subject: row.subject,
    body: row.body,
    budgetCents: row.budget_cents,
    scheduledAt: row.scheduled_at,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toMessageView(row: CrmMessageRow) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    accountId: row.account_id,
    channel: row.channel,
    status: row.status,
    destination: row.destination,
    queuedAt: row.queued_at,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    openedAt: row.opened_at,
    clickedAt: row.clicked_at,
    failureReason: row.failure_reason,
  };
}

export function toAutomationView(row: CrmAutomationRow) {
  return {
    id: row.id,
    name: row.name,
    triggerOn: row.trigger_on,
    action: row.action,
    delayHours: row.delay_hours,
    template: row.template,
    active: row.active,
    lastRunAt: row.last_run_at,
    runCount: row.run_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toAttributionView(row: CrmAttributionRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    opportunityId: row.opportunity_id,
    campaignId: row.campaign_id,
    knockId: row.knock_id,
    source: row.source,
    medium: row.medium,
    position: row.position,
    touchedAt: row.touched_at,
    note: row.note,
  };
}

/**
 * The knock dispositions that produced something worth counting. A
 * canvassing report that treats "no answer" and "sold" as the same kind of
 * outcome is not a report.
 */
export function isProductiveKnock(disposition: CrmKnockDisposition): boolean {
  return disposition === "sold" || disposition === "appointment_set" || disposition === "callback";
}

/* -------------------------------------------------------------------------
 * The forms engine, timesheets and licence expiry. The rule that runs
 * through all of it: a form's data has to stay reportable, so an answer's
 * shape is decided by its question's declared type rather than by whatever
 * the field sent.
 * ---------------------------------------------------------------------- */

export const CRM_FORM_KINDS = [
  "inspection", "service_report", "compliance_checklist", "wdo_report",
  "safety_check", "other",
] as const;
export type CrmFormKind = (typeof CRM_FORM_KINDS)[number];

export const CRM_FIELD_TYPES = [
  "text", "long_text", "number", "boolean", "date", "select", "multi_select",
] as const;
export type CrmFieldType = (typeof CRM_FIELD_TYPES)[number];

/** The two question types that carry choices; the schema CHECKs the pairing. */
export const CRM_CHOICE_FIELD_TYPES = ["select", "multi_select"] as const;

export const CRM_FORM_STATUSES = ["assigned", "in_progress", "completed", "void"] as const;
export type CrmFormStatus = (typeof CRM_FORM_STATUSES)[number];

/**
 * Which column an answer belongs in, given its question's type. This is the
 * TypeScript mirror of `crm_check_answer_shape` — the database is the
 * authority, and this exists so the boundary can refuse a mismatch by name
 * rather than surfacing a trigger's exception.
 */
export const CRM_ANSWER_SHAPE: Record<CrmFieldType, "text" | "number" | "boolean" | "date" | "options"> = {
  text: "text",
  long_text: "text",
  number: "number",
  boolean: "boolean",
  date: "date",
  select: "text",
  multi_select: "options",
};

export const CRM_FORM_TEMPLATE_COLUMNS =
  "id, name, kind, version, description, active, created_at, updated_at";
export const CRM_FORM_FIELD_COLUMNS =
  "id, template_id, position, label, field_type, required, help_text, options, created_at";
export const CRM_FORM_INSTANCE_COLUMNS =
  "id, template_id, account_id, property_id, work_order_id, technician_id, status, assigned_at, started_at, completed_at, signed_by_name, signed_at, signature_path, notes, created_at, updated_at";
export const CRM_FORM_ANSWER_COLUMNS =
  "id, instance_id, field_id, value_text, value_number, value_boolean, value_date, value_options, answered_at";
export const CRM_TIMESHEET_COLUMNS =
  "id, technician_id, work_order_id, started_at, ended_at, break_minutes, notes, created_at, updated_at";

export type CrmFormTemplateRow = {
  id: string;
  name: string;
  kind: CrmFormKind;
  version: number;
  description: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type CrmFormFieldRow = {
  id: string;
  template_id: string;
  position: number;
  label: string;
  field_type: CrmFieldType;
  required: boolean;
  help_text: string | null;
  options: string[] | null;
  created_at: string;
};

export type CrmFormInstanceRow = {
  id: string;
  template_id: string;
  account_id: string | null;
  property_id: string | null;
  work_order_id: string | null;
  technician_id: string | null;
  status: CrmFormStatus;
  assigned_at: string;
  started_at: string | null;
  completed_at: string | null;
  signed_by_name: string | null;
  signed_at: string | null;
  signature_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmFormAnswerRow = {
  id: string;
  instance_id: string;
  field_id: string;
  value_text: string | null;
  value_number: number | string | null;
  value_boolean: boolean | null;
  value_date: string | null;
  value_options: string[] | null;
  answered_at: string;
};

export type CrmTimesheetRow = {
  id: string;
  technician_id: string;
  work_order_id: string | null;
  started_at: string;
  ended_at: string | null;
  break_minutes: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export function toFormTemplateView(row: CrmFormTemplateRow) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    version: row.version,
    description: row.description,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toFormFieldView(row: CrmFormFieldRow) {
  return {
    id: row.id,
    templateId: row.template_id,
    position: row.position,
    label: row.label,
    fieldType: row.field_type,
    required: row.required,
    helpText: row.help_text,
    options: row.options ?? [],
    createdAt: row.created_at,
  };
}

export function toFormInstanceView(row: CrmFormInstanceRow) {
  return {
    id: row.id,
    templateId: row.template_id,
    accountId: row.account_id,
    propertyId: row.property_id,
    workOrderId: row.work_order_id,
    technicianId: row.technician_id,
    status: row.status,
    assignedAt: row.assigned_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    signedByName: row.signed_by_name,
    signedAt: row.signed_at,
    // The path, never a link — the same rule documents follow.
    signaturePath: row.signature_path,
    signed: row.signed_at !== null,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toFormAnswerView(row: CrmFormAnswerRow) {
  return {
    id: row.id,
    instanceId: row.instance_id,
    fieldId: row.field_id,
    valueText: row.value_text,
    valueNumber: row.value_number === null ? null : decimal(row.value_number),
    valueBoolean: row.value_boolean,
    valueDate: row.value_date,
    valueOptions: row.value_options ?? null,
    answeredAt: row.answered_at,
  };
}

export function toTimesheetView(row: CrmTimesheetRow) {
  const started = Date.parse(row.started_at);
  const ended = row.ended_at === null ? null : Date.parse(row.ended_at);
  return {
    id: row.id,
    technicianId: row.technician_id,
    workOrderId: row.work_order_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    breakMinutes: row.break_minutes,
    /*
     * Null while the shift is open. A running shift has no worked total
     * yet, and reporting one as though it were finished would inflate every
     * figure built on it.
     */
    workedMinutes:
      ended === null ? null : Math.max(0, Math.round((ended - started) / 60_000) - row.break_minutes),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * How many days until an applicator licence lapses — negative once it has.
 * Null when no expiry is recorded, which is a different thing from "not
 * expiring": a licence with no date on file cannot be reported as current.
 */
export function licenceDaysRemaining(
  expiresOn: string | null,
  today = new Date().toISOString().slice(0, 10),
): number | null {
  if (expiresOn === null) return null;
  return Math.round((Date.parse(expiresOn) - Date.parse(today)) / 86_400_000);
}

/* ---------------------------------------------------------------------------
 * The customer portal (increment 10). Two vocabularies live here and they
 * are deliberately separate:
 *
 *   * the STAFF view of a portal user and a service request — the whole row,
 *     read through ordinary organization-scoped RLS;
 *   * the CUSTOMER projections, which are the return shapes of the SECURITY
 *     DEFINER functions and contain only what a customer may see.
 *
 * Nothing maps one into the other. A customer projection is never built by
 * trimming a staff row, because a trim can be forgotten; it is built from a
 * function whose column list is the entire surface.
 * ------------------------------------------------------------------------- */

export type CrmPortalRole = "viewer" | "payer";
export type CrmRequestKind = "service" | "reschedule" | "question" | "complaint" | "cancel" | "quote";
export type CrmRequestStatus = "submitted" | "acknowledged" | "scheduled" | "resolved" | "declined";

export const CRM_PORTAL_ROLES: readonly CrmPortalRole[] = ["viewer", "payer"];
export const CRM_REQUEST_KINDS: readonly CrmRequestKind[] = [
  "service",
  "reschedule",
  "question",
  "complaint",
  "cancel",
  "quote",
];
export const CRM_REQUEST_STATUSES: readonly CrmRequestStatus[] = [
  "submitted",
  "acknowledged",
  "scheduled",
  "resolved",
  "declined",
];

/** A request in one of these states is finished, and carries a resolved_at. */
export const CRM_CLOSED_REQUEST_STATUSES: readonly CrmRequestStatus[] = ["resolved", "declined"];

export function isClosedRequestStatus(status: CrmRequestStatus): boolean {
  return CRM_CLOSED_REQUEST_STATUSES.includes(status);
}

export const CRM_PORTAL_USER_COLUMNS =
  "id, account_id, contact_id, user_id, email, role, invited_at, activated_at, last_seen_at, active, created_at, updated_at";
export const CRM_PORTAL_REQUEST_COLUMNS =
  "id, account_id, property_id, portal_user_id, kind, status, summary, detail, preferred_date, response, work_order_id, submitted_at, resolved_at, updated_at";

export type CrmPortalUserRow = {
  id: string;
  account_id: string;
  contact_id: string | null;
  user_id: string | null;
  email: string;
  role: CrmPortalRole;
  invited_at: string;
  activated_at: string | null;
  last_seen_at: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type CrmPortalRequestRow = {
  id: string;
  account_id: string;
  property_id: string | null;
  portal_user_id: string | null;
  kind: CrmRequestKind;
  status: CrmRequestStatus;
  summary: string;
  detail: string | null;
  preferred_date: string | null;
  response: string | null;
  work_order_id: string | null;
  submitted_at: string;
  resolved_at: string | null;
  updated_at: string;
};

export function toPortalUserView(row: CrmPortalUserRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    contactId: row.contact_id,
    /*
     * Whether a login is attached, not which one. The auth user id is an
     * internal identifier and no staff screen needs it to do its job.
     */
    linked: row.user_id !== null,
    email: row.email,
    role: row.role,
    invitedAt: row.invited_at,
    activatedAt: row.activated_at,
    lastSeenAt: row.last_seen_at,
    active: row.active,
    /*
     * The three states a portal invitation is actually in. An invitation
     * that was accepted and then switched off reads as `suspended`, not as
     * `invited`, because the customer did accept it once.
     */
    state: row.activated_at === null ? "invited" : row.active ? "active" : "suspended",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toPortalRequestView(row: CrmPortalRequestRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    propertyId: row.property_id,
    portalUserId: row.portal_user_id,
    kind: row.kind,
    status: row.status,
    summary: row.summary,
    detail: row.detail,
    preferredDate: row.preferred_date,
    response: row.response,
    workOrderId: row.work_order_id,
    submittedAt: row.submitted_at,
    resolvedAt: row.resolved_at,
    open: !isClosedRequestStatus(row.status),
    /* Answered means somebody wrote back, which is not the same as closed. */
    answered: row.response !== null,
    updatedAt: row.updated_at,
  };
}

/* --- The customer's own side: the definer projections, verbatim. --------- */

export type CrmPortalSummaryRow = {
  account_name: string;
  account_status: CrmAccountStatus;
  open_invoices: number;
  balance_cents: number | string;
  next_visit_on: string | null;
  open_requests: number;
};

export type CrmPortalInvoiceRow = {
  id: string;
  number: string;
  status: CrmInvoiceStatus;
  total_cents: number | string;
  paid_cents: number | string;
  balance_cents: number | string;
  issued_on: string | null;
  due_on: string | null;
};

export type CrmPortalVisitRow = {
  id: string;
  service_type: string;
  status: CrmWorkOrderStatus;
  scheduled_start: string | null;
  completed_at: string | null;
  property_label: string | null;
  completion_notes: string | null;
};

export type CrmPortalDocumentRow = {
  id: string;
  title: string;
  kind: CrmDocumentKind;
  storage_path: string;
  content_type: string | null;
  byte_size: number | string | null;
  uploaded_at: string;
};

export type CrmPortalRequestMineRow = {
  id: string;
  kind: CrmRequestKind;
  status: CrmRequestStatus;
  summary: string;
  detail: string | null;
  preferred_date: string | null;
  response: string | null;
  submitted_at: string;
  resolved_at: string | null;
};

export function toPortalSummaryView(row: CrmPortalSummaryRow) {
  return {
    accountName: row.account_name,
    accountStatus: row.account_status,
    openInvoices: row.open_invoices,
    balanceCents: Number(row.balance_cents),
    /*
     * Null when nothing is on the calendar. A customer with no upcoming
     * visit should read "none scheduled" and be able to ask for one, not be
     * shown a today's-date placeholder that implies somebody is coming.
     */
    nextVisitOn: row.next_visit_on,
    openRequests: row.open_requests,
  };
}

export function toPortalInvoiceView(
  row: CrmPortalInvoiceRow,
  today = new Date().toISOString().slice(0, 10),
) {
  const balanceCents = Number(row.balance_cents);
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    totalCents: Number(row.total_cents),
    paidCents: Number(row.paid_cents),
    balanceCents,
    issuedOn: row.issued_on,
    dueOn: row.due_on,
    /*
     * The same rule the staff ledger uses, restated over the projection's
     * own columns rather than shared through a staff row type — the portal
     * must not need a staff view object to exist in order to answer.
     */
    overdue: row.status === "open" && balanceCents > 0 && row.due_on !== null && row.due_on < today,
  };
}

export function toPortalVisitView(row: CrmPortalVisitRow) {
  return {
    id: row.id,
    serviceType: row.service_type,
    status: row.status,
    scheduledStart: row.scheduled_start,
    completedAt: row.completed_at,
    propertyLabel: row.property_label,
    /* The technician's note to the customer. Dispatch instructions are not
     * in the projection at all, so there is nothing here to leak. */
    completionNotes: row.completion_notes,
  };
}

export function toPortalDocumentView(row: CrmPortalDocumentRow) {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    /* A path, never a URL. Signing a link is the storage layer's job and
     * this project has no storage provider connected. */
    storagePath: row.storage_path,
    contentType: row.content_type,
    byteSize: row.byte_size === null ? null : Number(row.byte_size),
    uploadedAt: row.uploaded_at,
  };
}

export function toPortalRequestMineView(row: CrmPortalRequestMineRow) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    summary: row.summary,
    detail: row.detail,
    preferredDate: row.preferred_date,
    response: row.response,
    submittedAt: row.submitted_at,
    resolvedAt: row.resolved_at,
    open: !isClosedRequestStatus(row.status),
    answered: row.response !== null,
  };
}

/* ---------------------------------------------------------------------------
 * The commercial portal view (increment 15).
 *
 * The residential portal answers "when are you coming and what do I owe".
 * These are the questions a food plant's quality manager asks instead, and
 * the shapes below are the definer projections in
 * `20260830002300_commercial_portal.sql`, verbatim.
 *
 * Every nullable column stays nullable through its mapper, and for the
 * same reason as increment 11: a compliance binder is exactly where a
 * comfortable zero does damage. `overThreshold: null` means there was no
 * threshold or no reading — not that the station is under one. An
 * `activityTotal` of null means nobody wrote a number down that month, and
 * `scans` is carried beside it so the page can say which.
 * ------------------------------------------------------------------------- */

export type CrmPortalSiteRow = {
  id: string;
  label: string;
  address: string;
  property_type: string | null;
  active_devices: number;
  open_sightings: number;
  last_visit_at: string | null;
  next_visit_at: string | null;
};

export type CrmPortalStationRow = {
  id: string;
  property_id: string;
  property_label: string;
  label: string;
  barcode: string;
  device_type: CrmDeviceType;
  status: CrmDeviceStatus;
  location_note: string | null;
  activity_threshold: number | null;
  installed_at: string;
  last_service_at: string | null;
  last_condition: CrmDeviceCondition | null;
  last_activity_count: number | null;
  last_pest_observed: string | null;
  over_threshold: boolean | null;
};

export type CrmPortalTrendRow = {
  month: string;
  device_type: CrmDeviceType;
  scans: number;
  scans_with_count: number;
  activity_total: number | string | null;
  stations_flagged: number;
};

export type CrmPortalConditionRow = {
  kind: string;
  source_id: string;
  property_id: string;
  property_label: string;
  headline: string;
  detail: string | null;
  severity: string;
  observed_at: string;
  reported_by_customer: boolean;
};

export type CrmPortalSafetyRow = {
  product_id: string;
  name: string;
  epa_registration_number: string | null;
  active_ingredient: string | null;
  signal_word: string | null;
  restricted_use: boolean;
  sds_url: string | null;
  label_url: string | null;
  applications: number;
  last_applied_at: string | null;
};

export type CrmPortalInspectionRow = {
  id: string;
  template_name: string;
  template_kind: CrmFormKind;
  property_id: string | null;
  property_label: string | null;
  completed_at: string;
  signed_by_name: string | null;
  signed_at: string | null;
  has_signature: boolean;
  notes: string | null;
};

export function toPortalSiteView(row: CrmPortalSiteRow) {
  return {
    id: row.id,
    label: row.label,
    address: row.address,
    propertyType: row.property_type,
    activeDevices: row.active_devices,
    openSightings: row.open_sightings,
    /* Null when nothing has ever been done here, and null when nothing is
     * booked. Neither is a date, and neither should be shown as one. */
    lastVisitAt: row.last_visit_at,
    nextVisitAt: row.next_visit_at,
  };
}

export function toPortalStationView(row: CrmPortalStationRow) {
  return {
    id: row.id,
    propertyId: row.property_id,
    propertyLabel: row.property_label,
    label: row.label,
    /* The sticker on the box. An identifier for a bait station is not a
     * secret, and matching the row to the wall is the point. */
    barcode: row.barcode,
    deviceType: row.device_type,
    status: row.status,
    locationNote: row.location_note,
    activityThreshold: row.activity_threshold,
    installedAt: row.installed_at,
    lastServiceAt: row.last_service_at,
    lastCondition: row.last_condition,
    lastActivityCount: row.last_activity_count,
    lastPestObserved: row.last_pest_observed,
    overThreshold: row.over_threshold,
    /* Three states, not two: never scanned, scanned without a count, and
     * scanned with one. The page needs to tell them apart. */
    everScanned: row.last_service_at !== null,
    counted: row.last_activity_count !== null,
  };
}

export function toPortalTrendView(row: CrmPortalTrendRow) {
  return {
    month: row.month,
    deviceType: row.device_type,
    scans: row.scans,
    scansWithCount: row.scans_with_count,
    activityTotal: row.activity_total === null ? null : Number(row.activity_total),
    stationsFlagged: row.stations_flagged,
  };
}

export function toPortalConditionView(row: CrmPortalConditionRow) {
  return {
    kind: row.kind,
    sourceId: row.source_id,
    propertyId: row.property_id,
    propertyLabel: row.property_label,
    headline: row.headline,
    detail: row.detail,
    severity: row.severity,
    observedAt: row.observed_at,
    reportedByCustomer: row.reported_by_customer,
  };
}

export function toPortalSafetyView(row: CrmPortalSafetyRow) {
  return {
    productId: row.product_id,
    name: row.name,
    epaRegistrationNumber: row.epa_registration_number,
    activeIngredient: row.active_ingredient,
    signalWord: row.signal_word,
    restrictedUse: row.restricted_use,
    /* Null means no sheet is recorded. The page says so; it does not offer
     * a link that goes nowhere. */
    sdsUrl: row.sds_url,
    labelUrl: row.label_url,
    applications: row.applications,
    lastAppliedAt: row.last_applied_at,
  };
}

export function toPortalInspectionView(row: CrmPortalInspectionRow) {
  return {
    id: row.id,
    templateName: row.template_name,
    templateKind: row.template_kind,
    propertyId: row.property_id,
    propertyLabel: row.property_label,
    completedAt: row.completed_at,
    signedByName: row.signed_by_name,
    signedAt: row.signed_at,
    /* Whether a signature exists. The storage path is not in the
     * projection, so there is nothing here to hand over. */
    hasSignature: row.has_signature,
    notes: row.notes,
  };
}

/**
 * How a station reads on the floor. Kept beside the mapper because the
 * page, the tests and any later export must agree on when a station is
 * "unknown" rather than "clear" — the whole point of the null columns.
 */
export function stationStanding(
  station: Pick<
    ReturnType<typeof toPortalStationView>,
    "overThreshold" | "lastCondition" | "everScanned"
  >,
): "flagged" | "clear" | "unknown" {
  if (station.lastCondition === "damaged" || station.lastCondition === "missing") return "flagged";
  if (station.lastCondition === "needs_service") return "flagged";
  if (station.overThreshold === true) return "flagged";
  if (!station.everScanned) return "unknown";
  return station.overThreshold === null ? "unknown" : "clear";
}

/* ---------------------------------------------------------------------------
 * The operating dashboards (increment 11).
 *
 * These row types are the return shapes of the SECURITY INVOKER aggregate
 * functions in `20260830001900_operating_dashboards.sql`. Numeric columns
 * arrive from PostgREST as strings when they are bigint, so every one is
 * narrowed here rather than at each call site — and every NULLABLE one
 * stays nullable through the mapper. A rate over an empty denominator is
 * null, and coercing it to zero here would undo the reason it is computed
 * in SQL at all.
 * ------------------------------------------------------------------------- */

export type CrmRevenueMonthRow = {
  month: string;
  invoiced_cents: number | string;
  collected_cents: number | string;
  refunded_cents: number | string;
  invoice_count: number;
  collection_rate_bps: number | null;
};

export type CrmReceivableBucketRow = {
  bucket: string;
  invoice_count: number;
  balance_cents: number | string;
};

export type CrmRetentionRow = {
  customers: number;
  inactive: number;
  prospects: number;
  customers_without_plan: number;
  contracts_active: number;
  contracts_ended: number;
  retention_bps: number | null;
};

export type CrmTechnicianProductivityRow = {
  technician_id: string;
  first_name: string;
  last_name: string | null;
  branch_id: string | null;
  active: boolean;
  scheduled: number;
  completed: number;
  cancelled: number;
  completion_rate_bps: number | null;
  worked_minutes: number | string | null;
  running_shifts: number;
};

export type CrmRouteDayRow = {
  day: string;
  technician_id: string;
  branch_id: string | null;
  stops: number;
  first_start: string | null;
  last_end: string | null;
  span_minutes: number | null;
  booked_minutes: number | null;
  idle_minutes: number | null;
  accounts: number;
};

export function toRevenueMonthView(row: CrmRevenueMonthRow) {
  const invoicedCents = Number(row.invoiced_cents);
  const collectedCents = Number(row.collected_cents);
  const refundedCents = Number(row.refunded_cents);
  return {
    month: row.month,
    invoicedCents,
    collectedCents,
    refundedCents,
    /** What actually stayed: collected less anything given back. */
    netCents: collectedCents - refundedCents,
    invoiceCount: row.invoice_count,
    /** Null when nothing was invoiced that month — never 0. */
    collectionRateBps: row.collection_rate_bps,
  };
}

export function toReceivableBucketView(row: CrmReceivableBucketRow) {
  return {
    bucket: row.bucket,
    invoiceCount: row.invoice_count,
    balanceCents: Number(row.balance_cents),
    /*
     * `current` is open but not yet due and `undated` has no due date to
     * age against; neither is late. The distinction is what stops an aging
     * report from overstating what is actually overdue.
     */
    overdue: row.bucket !== "current" && row.bucket !== "undated",
  };
}

export function toRetentionView(row: CrmRetentionRow) {
  return {
    customers: row.customers,
    inactive: row.inactive,
    prospects: row.prospects,
    customersWithoutPlan: row.customers_without_plan,
    contractsActive: row.contracts_active,
    contractsEnded: row.contracts_ended,
    /** Null when there is no book to retain. */
    retentionBps: row.retention_bps,
  };
}

export function toTechnicianProductivityView(row: CrmTechnicianProductivityRow) {
  return {
    technicianId: row.technician_id,
    firstName: row.first_name,
    lastName: row.last_name,
    name: [row.first_name, row.last_name].filter(Boolean).join(" "),
    branchId: row.branch_id,
    active: row.active,
    scheduled: row.scheduled,
    completed: row.completed,
    cancelled: row.cancelled,
    /** Null when nothing was scheduled in the window. */
    completionRateBps: row.completion_rate_bps,
    /** Finished shifts only. Null when every shift in the window is open. */
    workedMinutes: row.worked_minutes === null ? null : Number(row.worked_minutes),
    runningShifts: row.running_shifts,
  };
}

export function toRouteDayView(row: CrmRouteDayRow) {
  return {
    day: row.day,
    technicianId: row.technician_id,
    branchId: row.branch_id,
    stops: row.stops,
    firstStart: row.first_start,
    lastEnd: row.last_end,
    spanMinutes: row.span_minutes,
    bookedMinutes: row.booked_minutes,
    /** Null on a single-stop day: one stop has no gaps to measure. */
    idleMinutes: row.idle_minutes,
    accounts: row.accounts,
  };
}

/** Basis points as a percentage string, or an em dash when unmeasured. */
export function bpsLabel(bps: number | null): string {
  if (bps === null) return "—";
  return `${(bps / 100).toFixed(1)}%`;
}

/* ---------------------------------------------------------------------------
 * Recurring billing and collections (increment 12).
 * ------------------------------------------------------------------------- */

export type CrmDunningAction =
  | "reminder_call"
  | "reminder_letter"
  | "reminder_email"
  | "final_notice"
  | "payment_plan"
  | "sent_to_collections"
  | "written_off";

export const CRM_DUNNING_ACTIONS: readonly CrmDunningAction[] = [
  "reminder_call",
  "reminder_letter",
  "reminder_email",
  "final_notice",
  "payment_plan",
  "sent_to_collections",
  "written_off",
];

export const CRM_BILLING_RUN_COLUMNS =
  "id, through_on, plans_considered, invoices_created, plans_already_billed, total_cents, note, ran_at";
export const CRM_DUNNING_NOTICE_COLUMNS =
  "id, invoice_id, account_id, action, days_overdue, balance_cents, outcome, acted_at";

export type CrmBillingRunRow = {
  id: string;
  through_on: string;
  plans_considered: number;
  invoices_created: number;
  plans_already_billed: number;
  total_cents: number | string;
  note: string | null;
  ran_at: string;
};

export type CrmDunningNoticeRow = {
  id: string;
  invoice_id: string;
  account_id: string;
  action: CrmDunningAction;
  days_overdue: number;
  balance_cents: number | string;
  outcome: string | null;
  acted_at: string;
};

export type CrmCollectionsRow = {
  invoice_id: string;
  account_id: string;
  account_name: string;
  number: string;
  balance_cents: number | string;
  due_on: string;
  days_overdue: number;
  notices: number;
  last_action: CrmDunningAction | null;
  last_acted_at: string | null;
};

export function toBillingRunView(row: CrmBillingRunRow) {
  return {
    id: row.id,
    throughOn: row.through_on,
    plansConsidered: row.plans_considered,
    invoicesCreated: row.invoices_created,
    /*
     * Plans that were due but whose period was already invoiced. Reported
     * on its own because a run that skipped forty and a run that found
     * forty nothing to do are different events, and only one of them means
     * somebody pressed the button twice.
     */
    plansAlreadyBilled: row.plans_already_billed,
    totalCents: Number(row.total_cents),
    note: row.note,
    ranAt: row.ran_at,
  };
}

export function toDunningNoticeView(row: CrmDunningNoticeRow) {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    accountId: row.account_id,
    action: row.action,
    /* The age when somebody acted, not the age now. */
    daysOverdue: row.days_overdue,
    balanceCents: Number(row.balance_cents),
    outcome: row.outcome,
    actedAt: row.acted_at,
  };
}

/** Which aging bucket an overdue invoice sits in, by the same cuts the report uses. */
export function agingBucket(daysOverdue: number): string {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "1-30";
  if (daysOverdue <= 60) return "31-60";
  if (daysOverdue <= 90) return "61-90";
  return "90+";
}

export function toCollectionsView(row: CrmCollectionsRow) {
  return {
    invoiceId: row.invoice_id,
    accountId: row.account_id,
    accountName: row.account_name,
    number: row.number,
    balanceCents: Number(row.balance_cents),
    dueOn: row.due_on,
    daysOverdue: row.days_overdue,
    bucket: agingBucket(row.days_overdue),
    notices: row.notices,
    /*
     * Null when nobody has done anything yet — which is the row a
     * collections desk most needs to see, so it is a real absence rather
     * than a "none" that reads like an action.
     */
    lastAction: row.last_action,
    lastActedAt: row.last_acted_at,
    untouched: row.notices === 0,
  };
}

/* ---------------------------------------------------------------------------
 * Equipment and fleet (increment 13).
 * ------------------------------------------------------------------------- */

export type CrmEquipmentKind =
  | "vehicle" | "trailer" | "sprayer" | "bait_gun" | "meter"
  | "respirator" | "thermal_camera" | "ladder" | "other";

export type CrmEquipmentStatus = "in_service" | "in_repair" | "out_of_service" | "retired";

export type CrmEquipmentEventKind =
  | "acquired" | "assigned" | "unassigned" | "service" | "inspection"
  | "meter_reading" | "repair_opened" | "repair_closed" | "retired";

export const CRM_EQUIPMENT_KINDS: readonly CrmEquipmentKind[] = [
  "vehicle", "trailer", "sprayer", "bait_gun", "meter",
  "respirator", "thermal_camera", "ladder", "other",
];

export const CRM_EQUIPMENT_EVENT_KINDS: readonly CrmEquipmentEventKind[] = [
  "assigned", "unassigned", "service", "inspection",
  "meter_reading", "repair_opened", "repair_closed", "retired",
];

export const CRM_METER_UNITS = ["miles", "kilometres", "hours"] as const;

export const CRM_EQUIPMENT_COLUMNS =
  "id, asset_tag, kind, name, make, model, serial_number, branch_id, status, assigned_technician_id, meter_reading, meter_unit, meter_read_at, service_interval_days, last_serviced_on, purchased_on, retired_on, notes, created_at, updated_at";
export const CRM_EQUIPMENT_EVENT_COLUMNS =
  "id, equipment_id, kind, technician_id, meter_reading, cost_cents, vendor, note, occurred_at";

export type CrmEquipmentRow = {
  id: string;
  asset_tag: string;
  kind: CrmEquipmentKind;
  name: string;
  make: string | null;
  model: string | null;
  serial_number: string | null;
  branch_id: string | null;
  status: CrmEquipmentStatus;
  assigned_technician_id: string | null;
  meter_reading: number | string | null;
  meter_unit: string | null;
  meter_read_at: string | null;
  service_interval_days: number | null;
  last_serviced_on: string | null;
  purchased_on: string | null;
  retired_on: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmEquipmentEventRow = {
  id: string;
  equipment_id: string;
  kind: CrmEquipmentEventKind;
  technician_id: string | null;
  meter_reading: number | string | null;
  cost_cents: number | string | null;
  vendor: string | null;
  note: string | null;
  occurred_at: string;
};

export type CrmFleetStatusRow = {
  equipment_id: string;
  asset_tag: string;
  name: string;
  kind: CrmEquipmentKind;
  status: CrmEquipmentStatus;
  branch_id: string | null;
  assigned_technician_id: string | null;
  meter_reading: number | string | null;
  meter_unit: string | null;
  last_serviced_on: string | null;
  service_interval_days: number | null;
  next_service_due: string | null;
  days_until_service: number | null;
  events: number;
};

export function toEquipmentView(row: CrmEquipmentRow) {
  return {
    id: row.id,
    assetTag: row.asset_tag,
    kind: row.kind,
    name: row.name,
    make: row.make,
    model: row.model,
    serialNumber: row.serial_number,
    branchId: row.branch_id,
    status: row.status,
    assignedTechnicianId: row.assigned_technician_id,
    meterReading: row.meter_reading === null ? null : Number(row.meter_reading),
    meterUnit: row.meter_unit,
    meterReadAt: row.meter_read_at,
    serviceIntervalDays: row.service_interval_days,
    lastServicedOn: row.last_serviced_on,
    purchasedOn: row.purchased_on,
    retiredOn: row.retired_on,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toEquipmentEventView(row: CrmEquipmentEventRow) {
  return {
    id: row.id,
    equipmentId: row.equipment_id,
    kind: row.kind,
    technicianId: row.technician_id,
    meterReading: row.meter_reading === null ? null : Number(row.meter_reading),
    costCents: row.cost_cents === null ? null : Number(row.cost_cents),
    vendor: row.vendor,
    note: row.note,
    occurredAt: row.occurred_at,
  };
}

/**
 * How an asset's service standing reads.
 *
 * `unscheduled` is its own state and is never folded into `ok`: an asset
 * with no interval on file has not been judged, and reporting it as fine is
 * how a fleet report starts claiming everything is.
 */
export function serviceStanding(
  intervalDays: number | null,
  daysUntilService: number | null,
): "unscheduled" | "overdue" | "due_soon" | "ok" {
  if (intervalDays === null || daysUntilService === null) return "unscheduled";
  if (daysUntilService < 0) return "overdue";
  if (daysUntilService <= 14) return "due_soon";
  return "ok";
}

export function toFleetStatusView(row: CrmFleetStatusRow) {
  return {
    equipmentId: row.equipment_id,
    assetTag: row.asset_tag,
    name: row.name,
    kind: row.kind,
    status: row.status,
    branchId: row.branch_id,
    assignedTechnicianId: row.assigned_technician_id,
    meterReading: row.meter_reading === null ? null : Number(row.meter_reading),
    meterUnit: row.meter_unit,
    lastServicedOn: row.last_serviced_on,
    serviceIntervalDays: row.service_interval_days,
    /** Null when nothing says when — unscheduled, not "not due". */
    nextServiceDue: row.next_service_due,
    daysUntilService: row.days_until_service,
    standing: serviceStanding(row.service_interval_days, row.days_until_service),
    events: row.events,
    /** Assigned to nobody. A real state, and the one a yard walk is for. */
    unassigned: row.assigned_technician_id === null && row.status !== "retired",
  };
}

/* ---------------------------------------------------------------------------
 * Revenue forecasting (increment 14).
 * ------------------------------------------------------------------------- */

export type CrmForecastMonthRow = {
  month: string;
  recurring_cents: number | string;
  contracted_cents: number | string;
  total_cents: number | string;
  plans: number;
  contracts: number;
};

export type CrmForecastBasisRow = {
  active_plans: number;
  unpriced_plans: number;
  active_contracts: number;
  open_ended_contracts: number;
  customers_without_plan: number;
  priced_share_bps: number | null;
};

export function toForecastMonthView(row: CrmForecastMonthRow) {
  return {
    month: row.month,
    recurringCents: Number(row.recurring_cents),
    contractedCents: Number(row.contracted_cents),
    totalCents: Number(row.total_cents),
    plans: row.plans,
    contracts: row.contracts,
  };
}

export function toForecastBasisView(row: CrmForecastBasisRow) {
  return {
    activePlans: row.active_plans,
    /*
     * Each of these is a reason the forecast UNDERSTATES, which is why they
     * travel with it rather than behind it. An unpriced plan bills nothing
     * in the projection; an open-ended contract is absent from the
     * contracted line entirely; a customer with no plan contributes
     * nothing at all.
     */
    unpricedPlans: row.unpriced_plans,
    activeContracts: row.active_contracts,
    openEndedContracts: row.open_ended_contracts,
    customersWithoutPlan: row.customers_without_plan,
    /** Null when there are no plans at all — a share of nothing is not zero. */
    pricedShareBps: row.priced_share_bps,
  };
}
