import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SEED_SOURCE,
  daysAgoIso,
  dateInDays,
  generateOperations,
  generateSeedDataset,
  type SeedScale,
} from "@/lib/services/seed-generator";

/**
 * Walks the generated dataset into a workspace, in dependency order,
 * through the caller's own RLS-scoped client.
 *
 * The whole point is that seeded rows are indistinguishable from rows the
 * product wrote, because they ARE rows the product wrote: statuses and
 * stages move one step at a time so the database's triggers author the
 * history, applications draw down their real lots, and stations earn their
 * ledgers. Nothing here forges a system-written row.
 *
 * Inserts are batched — a 320-account book is tens of thousands of rows,
 * and one round trip per row would take minutes.
 */

type SeedError = { message: string; code?: string };

export type SeedCounts = {
  accounts: number;
  contacts: number;
  properties: number;
  opportunities: number;
  technicians: number;
  servicePlans: number;
  workOrders: number;
  devices: number;
  deviceScans: number;
  sightings: number;
  /* Of those sightings, the ones the customer filed themselves. */
  customerReportedSightings: number;
  wdoInspections: number;
  wdoFindings: number;
  products: number;
  lots: number;
  applications: number;
  complianceRules: number;
  estimates: number;
  estimateLines: number;
  contracts: number;
  invoices: number;
  invoiceLines: number;
  payments: number;
  refunds: number;
  branches: number;
  employees: number;
  territories: number;
  commissions: number;
  documents: number;
  portalUsers: number;
  portalRequests: number;
  billingRuns: number;
  dunningNotices: number;
  equipment: number;
  equipmentEvents: number;
  canvassRoutes: number;
  knocks: number;
  marketingLists: number;
  listMembers: number;
  campaigns: number;
  messages: number;
  automations: number;
  attributions: number;
  formTemplates: number;
  formFields: number;
  formInstances: number;
  formAnswers: number;
  timesheets: number;
  timelineEvents: number;
  planSteps: number;
  stockMovements: number;
  fieldSubmissions: number;
  propertyUnits: number;
  serviceDocuments: number;
};

export type SeedRunOutcome = { error: SeedError } | { seeded: SeedCounts };

const BATCH = 500;

type SeedRow = Record<string, unknown>;

/**
 * Insert in chunks, returning the selected rows in insert order. The rows
 * are shaped per table by their callers, so the payload is untyped here on
 * purpose — the database's own constraints are what validate it, and they
 * are the check that actually matters.
 */
async function insertAll(
  client: SupabaseClient,
  table: string,
  rows: SeedRow[],
  columns: string,
): Promise<{ error: SeedError } | { data: SeedRow[] }> {
  const collected: SeedRow[] = [];
  for (let offset = 0; offset < rows.length; offset += BATCH) {
    const slice = rows.slice(offset, offset + BATCH);
    if (slice.length === 0) continue;
    const inserted = await client
      .from(table)
      .insert(slice as never)
      .select(columns);
    if (inserted.error) return { error: inserted.error };
    collected.push(...((inserted.data ?? []) as unknown as SeedRow[]));
  }
  return { data: collected };
}

export async function runSeed(
  client: SupabaseClient,
  organizationId: string,
  userId: string,
  scale: SeedScale,
): Promise<SeedRunOutcome> {
  const dataset = generateSeedDataset(scale);
  const org = organizationId;

  /* ------------------------------------------------------------ the company */

  /*
   * Branches first, then the org chart, then the managers attached back onto
   * the branches. The database makes the same choice — a branch is managed
   * by an employee who belongs to a branch, so one of those two directions
   * has to be declared second — and the seeder walks it the same way rather
   * than pretending the cycle is not there.
   */
  const branchRows = dataset.branches.map((branch) => ({
    organization_id: org,
    code: branch.code,
    name: branch.name,
    address: branch.address,
    phone: branch.phone,
    email: branch.email,
    time_zone: branch.timeZone,
    opened_on: dateInDays(-branch.openedDaysAgo),
    closed_on: branch.closedDaysAgo === undefined ? null : dateInDays(-branch.closedDaysAgo),
    active: branch.active,
    notes: branch.notes,
    created_by: userId,
  }));
  const branches = await insertAll(client, "crm_branches", branchRows, "id, code");
  if ("error" in branches) return branches;
  const branchIdByCode = new Map(branches.data.map((row) => [row.code as string, row.id as string]));
  const branchId = (index: number | undefined) =>
    index === undefined ? null : branchIdByCode.get(dataset.branches[index].code) ?? null;

  const employeeRows = dataset.employees.map((employee) => ({
    organization_id: org,
    branch_id: branchId(employee.branchIndex),
    employee_code: employee.employeeCode,
    first_name: employee.firstName,
    last_name: employee.lastName,
    email: employee.email,
    phone: employee.phone,
    role: employee.role,
    title: employee.title,
    hire_date: dateInDays(-employee.hiredDaysAgo),
    end_date: employee.endedDaysAgo === undefined ? null : dateInDays(-employee.endedDaysAgo),
    commission_bps: employee.commissionBps ?? null,
    monthly_quota_cents: employee.monthlyQuotaCents ?? null,
    active: employee.active,
    notes: employee.notes,
    created_by: userId,
  }));
  const employees = await insertAll(client, "crm_employees", employeeRows, "id, employee_code");
  if ("error" in employees) return employees;
  const employeeIdByCode = new Map(
    employees.data.map((row) => [row.employee_code as string, row.id as string]),
  );
  const employeeId = (index: number | undefined) =>
    index === undefined ? null : employeeIdByCode.get(dataset.employees[index].employeeCode) ?? null;

  // The org chart's edges, once every node exists.
  for (const [index, employee] of dataset.employees.entries()) {
    if (employee.reportsToIndex === undefined) continue;
    const supervisor = employeeId(employee.reportsToIndex);
    const person = employeeId(index);
    if (supervisor === null || person === null || supervisor === person) continue;
    const linked = await client
      .from("crm_employees")
      .update({ reports_to_id: supervisor } as never)
      .eq("organization_id", org)
      .eq("id", person);
    if (linked.error) return { error: linked.error };
  }

  // …and the branches' managers, grouped so one statement serves every
  // branch a given manager runs.
  const branchesByManager = new Map<string, string[]>();
  for (const [index, branch] of dataset.branches.entries()) {
    const manager = employeeId(branch.managerIndex);
    const id = branchId(index);
    if (manager === null || id === null) continue;
    const bucket = branchesByManager.get(manager) ?? [];
    bucket.push(id);
    branchesByManager.set(manager, bucket);
  }
  for (const [manager, ids] of branchesByManager) {
    const managed = await client
      .from("crm_branches")
      .update({ manager_id: manager } as never)
      .eq("organization_id", org)
      .in("id", ids);
    if (managed.error) return { error: managed.error };
  }

  const territoryRows = dataset.territories.map((territory) => ({
    organization_id: org,
    branch_id: branchId(territory.branchIndex),
    rep_id: employeeId(territory.repIndex),
    code: territory.code,
    name: territory.name,
    city: territory.city,
    region: territory.region,
    postal_codes: territory.postalCodes,
    active: territory.active,
    notes: territory.notes,
    created_by: userId,
  }));
  const territories = await insertAll(client, "crm_territories", territoryRows, "id, code");
  if ("error" in territories) return territories;
  const territoryIdByCode = new Map(
    territories.data.map((row) => [row.code as string, row.id as string]),
  );
  const territoryId = (index: number | undefined) =>
    index === undefined ? null : territoryIdByCode.get(dataset.territories[index].code) ?? null;

  /* ---------------------------------------------------------- independents */

  const technicianRows = dataset.technicians.map((technician) => ({
    organization_id: org,
    first_name: technician.firstName,
    last_name: technician.lastName,
    email: technician.email,
    phone: technician.phone,
    license_number: technician.licenseNumber,
    active: technician.active,
    branch_id: branchId(technician.branchIndex),
    reports_to_id: employeeId(technician.reportsToIndex),
    hire_date: technician.hiredDaysAgo === undefined ? null : dateInDays(-technician.hiredDaysAgo),
    created_by: userId,
  }));
  const technicians = await insertAll(client, "crm_technicians", technicianRows, "id, license_number");
  if ("error" in technicians) return technicians;
  const technicianIdByLicense = new Map(
    technicians.data.map((row) => [row.license_number as string, row.id as string]),
  );
  const technicianId = (index: number) =>
    technicianIdByLicense.get(dataset.technicians[index].licenseNumber) ?? null;

  const productRows = dataset.products.map((product) => ({
    organization_id: org,
    name: product.name,
    epa_registration_number: product.epaRegistrationNumber,
    active_ingredient: product.activeIngredient,
    signal_word: product.signalWord,
    sds_url: product.sdsUrl,
    label_url: product.labelUrl,
    restricted_use: product.restrictedUse,
    default_unit: product.defaultUnit,
    active: product.active,
    created_by: userId,
  }));
  const products = await insertAll(client, "crm_products", productRows, "id, name");
  if ("error" in products) return products;
  const productIdByName = new Map(products.data.map((row) => [row.name as string, row.id as string]));
  const productId = (index: number) => productIdByName.get(dataset.products[index].name) ?? null;

  const lotRows = dataset.products.flatMap((product) =>
    product.lots.map((lot) => ({
      organization_id: org,
      product_id: productIdByName.get(product.name),
      lot_number: lot.lotNumber,
      unit: product.defaultUnit,
      quantity_received: lot.quantity,
      quantity_remaining: lot.quantity,
      received_on: daysAgoIso(lot.receivedDaysAgo).slice(0, 10),
      expires_on: dateInDays(lot.expiresInDays),
      created_by: userId,
    })),
  );
  const lots = await insertAll(client, "crm_product_lots", lotRows, "id, lot_number");
  if ("error" in lots) return lots;
  const lotIdByNumber = new Map(lots.data.map((row) => [row.lot_number as string, row.id as string]));

  const ruleRows = dataset.jurisdictions.map((rule) => ({
    organization_id: org,
    jurisdiction: rule.jurisdiction,
    label: rule.label,
    retention_years: rule.retentionYears,
    requires_applicator_license: rule.requiresApplicatorLicense,
    requires_target_pest: rule.requiresTargetPest,
    requires_application_rate: rule.requiresApplicationRate,
    requires_treated_area: rule.requiresTreatedArea,
    notes: rule.notes,
    active: rule.active,
    created_by: userId,
  }));
  const rules = await insertAll(client, "crm_compliance_rules", ruleRows, "id");
  if ("error" in rules) return rules;

  /* ------------------------------------------------------------- the book */

  const accountRows = dataset.accounts.map((account) => ({
    organization_id: org,
    name: account.name,
    kind: account.kind,
    status: "lead",
    email: account.email,
    phone: account.phone,
    source: SEED_SOURCE,
    billing_address: account.billingAddress,
    notes: account.notes,
    branch_id: branchId(account.branchIndex),
    territory_id: territoryId(account.territoryIndex),
    owner_employee_id: employeeId(account.ownerEmployeeIndex),
    created_by: userId,
  }));
  const accounts = await insertAll(client, "crm_accounts", accountRows, "id, name");
  if ("error" in accounts) return accounts;
  const accountIdByName = new Map(accounts.data.map((row) => [row.name as string, row.id as string]));

  // Lifecycle, one move at a time, so the trigger writes each transition.
  // Grouped by target status: every account at a given step moves together,
  // which is a handful of statements instead of one per account.
  for (const step of [0, 1, 2]) {
    for (const status of ["prospect", "customer", "inactive"]) {
      const ids = dataset.accounts
        .filter((account) => account.statusPath[step] === status)
        .map((account) => accountIdByName.get(account.name))
        .filter((id): id is string => Boolean(id));
      if (ids.length === 0) continue;
      const moved = await client
        .from("crm_accounts")
        .update({ status })
        .eq("organization_id", org)
        .in("id", ids);
      if (moved.error) return { error: moved.error };
    }
  }

  const contactRows = dataset.accounts.flatMap((account) =>
    account.contacts.map((contact, seat) => ({
      organization_id: org,
      account_id: accountIdByName.get(account.name),
      first_name: contact.firstName,
      last_name: contact.lastName,
      role: contact.role,
      email: contact.email,
      phone: contact.phone,
      is_primary: seat === 0,
    })),
  );
  const contacts = await insertAll(client, "crm_contacts", contactRows, "id, account_id, email");
  if ("error" in contacts) return contacts;
  // Keyed by account and address so a portal invitation can name the person
  // it was sent to rather than floating free of the contact list.
  const contactIdByKey = new Map(
    contacts.data.map((row) => [`${row.account_id as string}:${row.email as string}`, row.id as string]),
  );

  const propertyRows = dataset.accounts.flatMap((account) =>
    account.properties.map((property) => ({
      organization_id: org,
      account_id: accountIdByName.get(account.name),
      label: property.label,
      address: property.address,
      property_type: property.propertyType,
      access_notes: property.accessNotes,
    })),
  );
  const properties = await insertAll(
    client,
    "crm_properties",
    propertyRows,
    "id, account_id, label",
  );
  if ("error" in properties) return properties;
  const propertyIdByKey = new Map(
    properties.data.map((row) => [`${row.account_id as string}:${row.label as string}`, row.id as string]),
  );
  const propertyFor = (accountName: string, index: number) => {
    const accountId = accountIdByName.get(accountName);
    const account = dataset.accounts.find((entry) => entry.name === accountName);
    if (!accountId || !account) return null;
    const label = account.properties[index % account.properties.length].label;
    return propertyIdByKey.get(`${accountId}:${label}`) ?? null;
  };

  const opportunityRows = dataset.accounts.flatMap((account) =>
    account.opportunities.map((opportunity) => ({
      organization_id: org,
      account_id: accountIdByName.get(account.name),
      name: opportunity.name,
      stage: "new",
      value_cents: opportunity.valueCents,
      expected_close_date: dateInDays(opportunity.expectedInDays),
      notes: opportunity.notes,
      // The rep who owns the account works its deals; without this the
      // leaderboard would have nothing to attribute.
      owner_employee_id: employeeId(account.ownerEmployeeIndex),
      created_by: userId,
    })),
  );
  const opportunities = await insertAll(client, "crm_opportunities", opportunityRows, "id, name");
  if ("error" in opportunities) return opportunities;
  const opportunityIdByName = new Map(
    opportunities.data.map((row) => [row.name as string, row.id as string]),
  );

  // Stage history, grouped by step and target stage for the same reason.
  const longestStagePath = Math.max(
    0,
    ...dataset.accounts.flatMap((account) =>
      account.opportunities.map((opportunity) => opportunity.stagePath.length),
    ),
  );
  for (let step = 0; step < longestStagePath; step += 1) {
    for (const stage of ["contacted", "inspection", "proposal", "negotiation", "won", "lost"]) {
      const moving = dataset.accounts.flatMap((account) =>
        account.opportunities
          .filter((opportunity) => opportunity.stagePath[step] === stage)
          .map((opportunity) => ({
            id: opportunityIdByName.get(opportunity.name),
            lostReason: opportunity.lostReason,
          })),
      );
      const ids = moving.map((entry) => entry.id).filter((id): id is string => Boolean(id));
      if (ids.length === 0) continue;
      if (stage === "lost") {
        // A loss carries its own reason, so these move one at a time.
        for (const entry of moving) {
          if (!entry.id) continue;
          const moved = await client
            .from("crm_opportunities")
            .update({ stage, lost_reason: entry.lostReason ?? null })
            .eq("organization_id", org)
            .eq("id", entry.id);
          if (moved.error) return { error: moved.error };
        }
        continue;
      }
      const moved = await client
        .from("crm_opportunities")
        .update({ stage })
        .eq("organization_id", org)
        .in("id", ids);
      if (moved.error) return { error: moved.error };
    }
  }

  /* ------------------------------------------------------- operational data */

  const operations = new Map(
    dataset.accounts.map((account) => [account.name, generateOperations(account, dataset)]),
  );

  /*
   * Roughly three plans in five run on a named calendar rather than an
   * interval (ADR-211): a monthly plan visits on the 1st and the 15th, a
   * quarterly one on the second Tuesday of each quarter's first month.
   * The cycle has to be set at insert, because a step cannot be written
   * against a plan that has no cycle — the trigger says so.
   */
  let planOrdinal = 0;
  const planRows = dataset.accounts.flatMap((account) =>
    (operations.get(account.name)?.plans ?? []).map((plan) => {
      const ordinal = planOrdinal++;
      const sequenced = ordinal % 5 < 3;
      return {
        organization_id: org,
        account_id: accountIdByName.get(account.name),
        property_id: propertyFor(account.name, plan.propertyIndex),
        service_type: plan.serviceType,
        recurrence: plan.recurrence,
        next_due: dateInDays(plan.dueInDays),
        technician_id: technicianId(plan.technicianIndex),
        value_cents: plan.valueCents,
        active: plan.active,
        notes: plan.notes,
        cycle_months: sequenced ? (ordinal % 2 === 0 ? 1 : 3) : null,
        created_by: userId,
      };
    }),
  );
  const plans = await insertAll(client, "crm_service_plans", planRows, "id");
  if ("error" in plans) return plans;
  // Plans come back in insert order, so a per-account offset locates them.
  const planIds = plans.data.map((row) => row.id as string);
  const planOffsets = new Map<string, number>();
  {
    let cursor = 0;
    for (const account of dataset.accounts) {
      planOffsets.set(account.name, cursor);
      cursor += operations.get(account.name)?.plans.length ?? 0;
    }
  }

  const visitRows = dataset.accounts.flatMap((account) =>
    (operations.get(account.name)?.visits ?? []).map((visit) => {
      const day = dateInDays(visit.inDays);
      return {
        organization_id: org,
        account_id: accountIdByName.get(account.name),
        property_id: propertyFor(account.name, visit.propertyIndex),
        technician_id: technicianId(visit.technicianIndex),
        plan_id:
          visit.planIndex === undefined
            ? null
            : planIds[(planOffsets.get(account.name) ?? 0) + visit.planIndex] ?? null,
        service_type: visit.serviceType,
        scheduled_start: `${day}T${String(7 + (account.index % 9)).padStart(2, "0")}:00:00Z`,
        scheduled_end: `${day}T${String(7 + (account.index % 9) + visit.durationHours).padStart(2, "0")}:00:00Z`,
        instructions: visit.instructions,
        created_by: userId,
      };
    }),
  );
  const visits = await insertAll(client, "crm_work_orders", visitRows, "id");
  if ("error" in visits) return visits;
  // Work orders come back in insert order, so they line up with their source.
  const visitSources = dataset.accounts.flatMap((account) =>
    (operations.get(account.name)?.visits ?? []).map((visit) => visit),
  );
  const visitIds = visits.data.map((row) => row.id as string);

  // Visit outcomes: grouped per step and status, and completions carry notes.
  const longestVisitPath = Math.max(0, ...visitSources.map((visit) => visit.statusPath.length));
  for (let step = 0; step < longestVisitPath; step += 1) {
    for (const status of ["dispatched", "in_progress", "completed", "cancelled"]) {
      const indexes = visitSources
        .map((visit, position) => ({ visit, position }))
        .filter((entry) => entry.visit.statusPath[step] === status);
      if (indexes.length === 0) continue;
      if (status === "completed") {
        for (const entry of indexes) {
          const moved = await client
            .from("crm_work_orders")
            .update({ status, completion_notes: entry.visit.completionNotes })
            .eq("organization_id", org)
            .eq("id", visitIds[entry.position]);
          if (moved.error) return { error: moved.error };
        }
        continue;
      }
      const moved = await client
        .from("crm_work_orders")
        .update({ status })
        .eq("organization_id", org)
        .in("id", indexes.map((entry) => visitIds[entry.position]));
      if (moved.error) return { error: moved.error };
    }
  }

  /* ------------------------------------------------------------ IPM layer */

  const deviceRows = dataset.accounts.flatMap((account) =>
    (operations.get(account.name)?.devices ?? []).map((device) => ({
      organization_id: org,
      account_id: accountIdByName.get(account.name),
      property_id: propertyFor(account.name, device.propertyIndex),
      label: device.label,
      device_type: device.deviceType,
      barcode: device.barcode,
      location_note: device.locationNote,
      activity_threshold: device.activityThreshold,
      installed_at: daysAgoIso(device.installedDaysAgo),
      created_by: userId,
    })),
  );
  const devices = await insertAll(client, "crm_devices", deviceRows, "id, barcode");
  if ("error" in devices) return devices;
  const deviceIdByBarcode = new Map(
    devices.data.map((row) => [row.barcode as string, row.id as string]),
  );

  const scanVisitOffsets = new Map<string, number>();
  {
    let cursor = 0;
    for (const account of dataset.accounts) {
      scanVisitOffsets.set(account.name, cursor);
      cursor += operations.get(account.name)?.visits.length ?? 0;
    }
  }

  const scanRows = dataset.accounts.flatMap((account) =>
    (operations.get(account.name)?.devices ?? []).flatMap((device) =>
      device.scans.map((scan) => ({
        organization_id: org,
        device_id: deviceIdByBarcode.get(device.barcode),
        work_order_id:
          scan.visitIndex === undefined
            ? null
            : visitIds[(scanVisitOffsets.get(account.name) ?? 0) + scan.visitIndex] ?? null,
        event: scan.event,
        condition: scan.condition,
        activity_count: scan.activityCount,
        pest_observed: scan.pestObserved,
        location_note: scan.locationNote,
        note: scan.note,
        recorded_at: daysAgoIso(scan.daysAgo),
        actor_user_id: userId,
      })),
    ),
  );
  const scans = await insertAll(client, "crm_device_events", scanRows, "id");
  if ("error" in scans) return scans;

  const sightingRows = dataset.accounts.flatMap((account) =>
    (operations.get(account.name)?.sightings ?? []).map((sighting) => ({
      organization_id: org,
      account_id: accountIdByName.get(account.name),
      property_id: propertyFor(account.name, sighting.propertyIndex),
      pest: sighting.pest,
      severity: sighting.severity,
      location_note: sighting.locationNote,
      note: sighting.note,
      sighted_at: daysAgoIso(sighting.daysAgo),
      // A resolved sighting carries its action and timestamp together — the
      // schema's CHECK refuses one without the other.
      corrective_action: sighting.correctiveAction ?? null,
      corrected_at:
        sighting.correctiveAction === undefined
          ? null
          : daysAgoIso(sighting.correctedDaysAgo ?? sighting.daysAgo),
      created_by: userId,
    })),
  );
  // account_id comes back so the portal can claim a share of these below,
  // once the invitations that would have reported them exist.
  const sightings = await insertAll(
    client,
    "crm_pest_sightings",
    sightingRows,
    "id, account_id",
  );
  if ("error" in sightings) return sightings;

  // Work orders came back in insert order too, so an account's visits are
  // the slice starting at its offset.
  const visitOffsets = new Map<string, number>();
  {
    let cursor = 0;
    for (const account of dataset.accounts) {
      visitOffsets.set(account.name, cursor);
      cursor += operations.get(account.name)?.visits.length ?? 0;
    }
  }

  /* ------------------------------------------------------- WDO reports (16) */

  /*
   * The reports are written as DRAFTS, then issued through
   * crm_wdo_issue_report — the same function the product uses. Setting
   * `status = 'issued'` on the insert would skip the check that spans both
   * tables, and a seed that walked around the guard would be a book the
   * product itself could not have produced.
   */
  const wdoRowFor = (account: (typeof dataset.accounts)[number], report: {
    propertyIndex: number;
    technicianIndex: number;
    reportNumber: string;
    inspectedDaysAgo: number;
    structuresInspected: string;
    visibleEvidence: boolean;
    obstructions?: string;
    inaccessibleAreas?: string;
    recommendation?: string;
    visitSeat?: number;
  }, supersedesId: string | null) => ({
    organization_id: org,
    account_id: accountIdByName.get(account.name),
    property_id: propertyFor(account.name, report.propertyIndex),
    inspector_technician_id: technicianId(report.technicianIndex),
    work_order_id:
      report.visitSeat === undefined
        ? null
        : visitIds[(visitOffsets.get(account.name) ?? 0) + report.visitSeat] ?? null,
    report_number: report.reportNumber,
    inspected_on: dateInDays(-report.inspectedDaysAgo),
    structures_inspected: report.structuresInspected,
    visible_evidence: report.visibleEvidence,
    obstructions: report.obstructions ?? null,
    inaccessible_areas: report.inaccessibleAreas ?? null,
    recommendation: report.recommendation ?? null,
    supersedes_id: supersedesId,
    created_by: userId,
  });

  /*
   * Two passes, because a correction names the report it replaces and that
   * report needs an id first. Doing it as two inserts rather than an
   * insert-then-update matters: by the time the originals are ISSUED below
   * they are frozen, and an update setting supersedes_id on a frozen row
   * is exactly what the guard refuses.
   */
  const wdoFirstPass = dataset.accounts.flatMap((account) =>
    (operations.get(account.name)?.wdoInspections ?? [])
      .filter((report) => report.supersedesReportNumber === undefined)
      .map((report) => wdoRowFor(account, report, null)),
  );
  const wdoOriginals = await insertAll(
    client,
    "crm_wdo_inspections",
    wdoFirstPass,
    "id, report_number",
  );
  if ("error" in wdoOriginals) return wdoOriginals;
  const wdoIdByNumber = new Map(
    wdoOriginals.data.map((row) => [row.report_number as string, row.id as string]),
  );

  const wdoSecondPass = dataset.accounts.flatMap((account) =>
    (operations.get(account.name)?.wdoInspections ?? [])
      .filter((report) => report.supersedesReportNumber !== undefined)
      .map((report) =>
        wdoRowFor(
          account,
          report,
          wdoIdByNumber.get(report.supersedesReportNumber as string) ?? null,
        ),
      ),
  );
  const wdoCorrections = await insertAll(
    client,
    "crm_wdo_inspections",
    wdoSecondPass,
    "id, report_number",
  );
  if ("error" in wdoCorrections) return wdoCorrections;
  for (const row of wdoCorrections.data) {
    wdoIdByNumber.set(row.report_number as string, row.id as string);
  }
  const wdoInspectionCount = wdoOriginals.data.length + wdoCorrections.data.length;

  const wdoFindingRows = dataset.accounts.flatMap((account) =>
    (operations.get(account.name)?.wdoInspections ?? []).flatMap((report) => {
      const inspectionId = wdoIdByNumber.get(report.reportNumber);
      if (inspectionId === undefined) return [];
      return report.findings.map((finding) => ({
        organization_id: org,
        inspection_id: inspectionId,
        kind: finding.kind,
        organism: finding.organism ?? null,
        area: finding.area,
        // Both halves or neither; the schema refuses anything between.
        position_x: finding.positionX ?? null,
        position_y: finding.positionY ?? null,
        note: finding.note ?? null,
        treatment_note: finding.treatmentNote ?? null,
        created_by: userId,
      }));
    }),
  );
  const wdoFindings = await insertAll(client, "crm_wdo_findings", wdoFindingRows, "id");
  if ("error" in wdoFindings) return wdoFindings;

  // Issue the ones meant to be issued, one call each, through the product's
  // own function — so every issued report in the book passed the same
  // contradiction check a real one would.
  for (const account of dataset.accounts) {
    for (const report of operations.get(account.name)?.wdoInspections ?? []) {
      if (!report.issued) continue;
      const inspectionId = wdoIdByNumber.get(report.reportNumber);
      if (inspectionId === undefined) continue;
      const issued = await client.rpc("crm_wdo_issue_report", { p_inspection: inspectionId });
      if (issued.error) return { error: issued.error };
    }
  }

  /* --------------------------------------------------------- applications */

  const applicationRows = dataset.accounts.flatMap((account) => {
    const accountOperations = operations.get(account.name);
    const visitOffset = visitOffsets.get(account.name) ?? 0;
    return (accountOperations?.applications ?? []).map((application) => {
      const product = dataset.products[application.productIndex];
      const lot = product.lots[application.lotIndex % product.lots.length];
      const device =
        application.deviceIndex === undefined
          ? null
          : accountOperations?.devices[application.deviceIndex] ?? null;
      return {
        organization_id: org,
        account_id: accountIdByName.get(account.name),
        property_id: propertyFor(account.name, application.propertyIndex),
        product_id: productId(application.productIndex),
        lot_id: lotIdByNumber.get(lot.lotNumber) ?? null,
        work_order_id:
          application.visitIndex === undefined
            ? null
            : visitIds[visitOffset + application.visitIndex] ?? null,
        device_id: device === null ? null : deviceIdByBarcode.get(device.barcode) ?? null,
        technician_id: technicianId(application.technicianIndex),
        applicator_license: dataset.technicians[application.technicianIndex].licenseNumber,
        method: application.method,
        quantity: application.quantity,
        // The lot's unit is the application's unit; the drawdown trigger
        // refuses any other, and rightly.
        unit: product.defaultUnit,
        target_pest: application.targetPest,
        application_rate: application.applicationRate,
        treated_area: application.treatedArea,
        location_note: application.locationNote,
        note: application.note,
        applied_at: daysAgoIso(application.daysAgo),
        created_by: userId,
      };
    });
  });
  /*
   * Two passes, because a correction must point at a row that already
   * exists: the originals first, then the superseding records that name
   * them. A single batch could not resolve the reference, and the
   * database is right to refuse one that cannot.
   */
  const correctionSources = dataset.accounts.flatMap((account) => {
    const accountOperations = operations.get(account.name);
    return (accountOperations?.applications ?? [])
      .map((application, position) => ({ account, application, position }))
      .filter((entry) => entry.application.supersedesIndex !== undefined);
  });
  const correctionKeys = new Set(
    correctionSources.map((entry) => `${entry.account.name}:${entry.position}`),
  );
  const originalRows: SeedRow[] = [];
  const originalKeys: string[] = [];
  {
    let cursor = 0;
    for (const account of dataset.accounts) {
      const count = operations.get(account.name)?.applications.length ?? 0;
      for (let position = 0; position < count; position += 1) {
        const row = applicationRows[cursor + position];
        if (correctionKeys.has(`${account.name}:${position}`)) continue;
        originalRows.push(row);
        originalKeys.push(`${account.name}:${position}`);
      }
      cursor += count;
    }
  }

  const applications = await insertAll(client, "crm_applications", originalRows, "id");
  if ("error" in applications) return applications;
  const applicationIdByKey = new Map(
    applications.data.map((row, position) => [originalKeys[position], row.id as string]),
  );

  const correctionRows = correctionSources.map((entry) => {
    const offset =
      dataset.accounts
        .slice(0, dataset.accounts.indexOf(entry.account))
        .reduce((sum, account) => sum + (operations.get(account.name)?.applications.length ?? 0), 0);
    const row: SeedRow = { ...applicationRows[offset + entry.position] };
    row.supersedes_id =
      applicationIdByKey.get(
        `${entry.account.name}:${entry.application.supersedesIndex ?? 0}`,
      ) ?? null;
    row.note = `Correction: supersedes the earlier record for this treatment. ${String(row.note ?? "")}`.trim();
    return row;
  }).filter((row) => row.supersedes_id !== null);

  const corrections = await insertAll(client, "crm_applications", correctionRows, "id");
  if ("error" in corrections) return corrections;

  /* ---------------------------------------------------------- the money */

  const dayOf = (days: number) => dateInDays(days);

  const estimateRows = dataset.accounts.flatMap((account) =>
    (operations.get(account.name)?.billing.estimates ?? []).map((estimate) => {
      const subtotal = estimate.lines.reduce(
        (sum, line) => sum + line.quantity * line.unitPriceCents,
        0,
      );
      return {
        organization_id: org,
        account_id: accountIdByName.get(account.name),
        property_id: propertyFor(account.name, estimate.propertyIndex),
        opportunity_id:
          estimate.opportunityIndex === undefined
            ? null
            : opportunityIdByName.get(
                account.opportunities[estimate.opportunityIndex]?.name ?? "",
              ) ?? null,
        number: estimate.number,
        status: estimate.status,
        subtotal_cents: subtotal,
        tax_cents: estimate.taxCents,
        total_cents: subtotal + estimate.taxCents,
        valid_until: dayOf(estimate.validInDays),
        terms: estimate.terms,
        notes: estimate.notes,
        sent_at: daysAgoIso(estimate.sentDaysAgo),
        // The schema ties a decision timestamp to a decided status.
        decided_at:
          estimate.decidedDaysAgo === undefined ? null : daysAgoIso(estimate.decidedDaysAgo),
        created_by: userId,
      };
    }),
  );
  const estimates = await insertAll(client, "crm_estimates", estimateRows, "id, number");
  if ("error" in estimates) return estimates;
  const estimateIdByNumber = new Map(
    estimates.data.map((row) => [row.number as string, row.id as string]),
  );

  const estimateLineRows = dataset.accounts.flatMap((account) =>
    (operations.get(account.name)?.billing.estimates ?? []).flatMap((estimate) =>
      estimate.lines.map((line, seat) => ({
        organization_id: org,
        estimate_id: estimateIdByNumber.get(estimate.number),
        position: seat + 1,
        description: line.description,
        quantity: line.quantity,
        unit_price_cents: line.unitPriceCents,
        amount_cents: line.quantity * line.unitPriceCents,
      })),
    ),
  );
  const estimateLines = await insertAll(client, "crm_estimate_lines", estimateLineRows, "id");
  if ("error" in estimateLines) return estimateLines;

  const contractRows = dataset.accounts.flatMap((account) => {
    const billing = operations.get(account.name)?.billing;
    const planOffset = planOffsets.get(account.name) ?? 0;
    return (billing?.contracts ?? []).map((contract) => ({
      organization_id: org,
      account_id: accountIdByName.get(account.name),
      estimate_id:
        contract.estimateIndex === undefined
          ? null
          : estimateIdByNumber.get(billing?.estimates[contract.estimateIndex]?.number ?? "") ?? null,
      plan_id: contract.planIndex === undefined ? null : planIds[planOffset + contract.planIndex] ?? null,
      number: contract.number,
      status: contract.status,
      value_cents: contract.valueCents,
      starts_on: dayOf(contract.startsInDays),
      ends_on: dayOf(contract.endsInDays),
      auto_renew: contract.autoRenew,
      terms: contract.terms,
      notes: contract.notes,
      signed_at: contract.signedDaysAgo === undefined ? null : daysAgoIso(contract.signedDaysAgo),
      signed_by_name: contract.signedByName ?? null,
      ended_at: contract.endedDaysAgo === undefined ? null : daysAgoIso(contract.endedDaysAgo),
      created_by: userId,
    }));
  });
  const contracts = await insertAll(client, "crm_contracts", contractRows, "id, number");
  if ("error" in contracts) return contracts;
  const contractIdByNumber = new Map(
    contracts.data.map((row) => [row.number as string, row.id as string]),
  );

  const invoiceRows = dataset.accounts.flatMap((account) => {
    const billing = operations.get(account.name)?.billing;
    const visitOffset = visitOffsets.get(account.name) ?? 0;
    return (billing?.invoices ?? []).map((invoice) => {
      const subtotal = invoice.lines.reduce(
        (sum, line) => sum + line.quantity * line.unitPriceCents,
        0,
      );
      return {
        organization_id: org,
        account_id: accountIdByName.get(account.name),
        contract_id:
          invoice.contractIndex === undefined
            ? null
            : contractIdByNumber.get(billing?.contracts[invoice.contractIndex]?.number ?? "") ?? null,
        work_order_id:
          invoice.visitIndex === undefined ? null : visitIds[visitOffset + invoice.visitIndex] ?? null,
        number: invoice.number,
        status: invoice.status,
        subtotal_cents: subtotal,
        tax_cents: invoice.taxCents,
        total_cents: subtotal + invoice.taxCents,
        issued_on: daysAgoIso(invoice.issuedDaysAgo).slice(0, 10),
        // Net terms run from the issue date; the schema refuses a due date
        // that precedes it, and rightly.
        due_on: dayOf(invoice.netDays - invoice.issuedDaysAgo),
        memo: invoice.memo,
        voided_at: invoice.voidReason === undefined ? null : daysAgoIso(invoice.issuedDaysAgo),
        void_reason: invoice.voidReason ?? null,
        created_by: userId,
      };
    });
  });
  const invoices = await insertAll(client, "crm_invoices", invoiceRows, "id, number");
  if ("error" in invoices) return invoices;
  const invoiceIdByNumber = new Map(
    invoices.data.map((row) => [row.number as string, row.id as string]),
  );

  const invoiceLineRows = dataset.accounts.flatMap((account) =>
    (operations.get(account.name)?.billing.invoices ?? []).flatMap((invoice) =>
      invoice.lines.map((line, seat) => ({
        organization_id: org,
        invoice_id: invoiceIdByNumber.get(invoice.number),
        position: seat + 1,
        description: line.description,
        quantity: line.quantity,
        unit_price_cents: line.unitPriceCents,
        amount_cents: line.quantity * line.unitPriceCents,
      })),
    ),
  );
  const invoiceLines = await insertAll(client, "crm_invoice_lines", invoiceLineRows, "id");
  if ("error" in invoiceLines) return invoiceLines;

  // Payments settle their invoices and write their own history by trigger.
  const paymentRows = dataset.accounts.flatMap((account) =>
    (operations.get(account.name)?.billing.invoices ?? []).flatMap((invoice) =>
      invoice.payments.map((payment) => ({
        organization_id: org,
        account_id: accountIdByName.get(account.name),
        invoice_id: invoiceIdByNumber.get(invoice.number),
        amount_cents: payment.amountCents,
        method: payment.method,
        reference: payment.reference,
        received_at: daysAgoIso(payment.daysAgo),
        note: payment.note,
        created_by: userId,
      })),
    ),
  );
  const payments = await insertAll(client, "crm_payments", paymentRows, "id");
  if ("error" in payments) return payments;
  const paymentIds = payments.data.map((row) => row.id as string);

  // Refunds reference the payment they credit, by its position in the batch.
  const refundRows: SeedRow[] = [];
  {
    let cursor = 0;
    for (const account of dataset.accounts) {
      for (const invoice of operations.get(account.name)?.billing.invoices ?? []) {
        for (const payment of invoice.payments) {
          if (payment.refund) {
            refundRows.push({
              organization_id: org,
              payment_id: paymentIds[cursor],
              amount_cents: payment.refund.amountCents,
              reason: payment.refund.reason,
              refunded_at: daysAgoIso(payment.refund.daysAgo),
              created_by: userId,
            });
          }
          cursor += 1;
        }
      }
    }
  }
  const refunds = await insertAll(client, "crm_refunds", refundRows, "id");
  if ("error" in refunds) return refunds;

  /* ------------------------------------------------------------ commissions */

  /*
   * What each sale earned the rep who owns the account. No amount is sent:
   * the database multiplies the basis by the rate, and a seeded payout that
   * stated its own total would be asserting the one number this schema
   * refuses to take from a caller. The row comes back with the amount the
   * trigger computed.
   */
  const commissionRows = dataset.accounts.flatMap((account) => {
    const billing = operations.get(account.name)?.billing;
    const owner = employeeId(account.ownerEmployeeIndex);
    if (billing === undefined || owner === null) return [];
    return billing.commissions.flatMap((commission) => {
      const earnedAt = daysAgoIso(commission.earnedDaysAgo);
      const stamped =
        commission.status === "accrued"
          ? { approved_at: null, paid_at: null }
          : commission.status === "approved"
            ? { approved_at: earnedAt, paid_at: null }
            : commission.status === "paid"
              ? { approved_at: earnedAt, paid_at: earnedAt }
              : // A voided commission keeps whatever moments it reached.
                { approved_at: earnedAt, paid_at: null };
      return [
        {
          organization_id: org,
          employee_id: owner,
          opportunity_id:
            commission.opportunityIndex === undefined
              ? null
              : opportunityIdByName.get(
                  account.opportunities[commission.opportunityIndex]?.name ?? "",
                ) ?? null,
          contract_id:
            commission.contractIndex === undefined
              ? null
              : contractIdByNumber.get(billing.contracts[commission.contractIndex]?.number ?? "") ?? null,
          invoice_id:
            commission.invoiceIndex === undefined
              ? null
              : invoiceIdByNumber.get(billing.invoices[commission.invoiceIndex]?.number ?? "") ?? null,
          basis_cents: commission.basisCents,
          rate_bps: commission.rateBps,
          status: commission.status,
          earned_on: dateInDays(-commission.earnedDaysAgo),
          ...stamped,
          note: commission.note,
          created_by: userId,
        },
      ];
    });
  })
    // A commission has to name what it was earned on; one whose source did
    // not survive resolution is dropped rather than filed against nothing.
    .filter(
      (row) =>
        row.opportunity_id !== null || row.contract_id !== null || row.invoice_id !== null,
    );
  const commissions = await insertAll(client, "crm_commissions", commissionRows, "id");
  if ("error" in commissions) return commissions;

  /* ------------------------------- documents, canvassing and marketing (8) */

  // Documents are metadata and a private storage path. No bytes travel here,
  // and the path is not a URL — the schema refuses one with a scheme in it.
  const documentRows = dataset.accounts.flatMap((account) => {
    const accountId = accountIdByName.get(account.name);
    if (accountId === undefined) return [];
    const visitOffset = visitOffsets.get(account.name) ?? 0;
    return (account.documents ?? []).map((document) => ({
      organization_id: org,
      account_id: accountId,
      property_id:
        document.propertySeat === undefined ? null : propertyFor(account.name, document.propertySeat),
      work_order_id:
        document.visitSeat === undefined ? null : visitIds[visitOffset + document.visitSeat] ?? null,
      title: document.title,
      kind: document.kind,
      storage_path: document.storagePath,
      content_type: document.contentType,
      byte_size: document.byteSize,
      notes: document.notes,
      uploaded_at: daysAgoIso(document.uploadedDaysAgo),
      created_by: userId,
    }));
  });
  const documents = await insertAll(client, "crm_documents", documentRows, "id");
  if ("error" in documents) return documents;

  /* ----------------------------------------- equipment and fleet (13) */

  /*
   * Assets first, then the ledger. Every asset is born with an acquisition
   * event written by trigger, so the runner inserts none — and the events
   * below are the ones that came after.
   */
  const equipmentRows = dataset.equipment.map((asset) => ({
    organization_id: org,
    asset_tag: asset.assetTag,
    kind: asset.kind,
    name: asset.name,
    make: asset.make ?? null,
    model: asset.model ?? null,
    serial_number: asset.serialNumber ?? null,
    branch_id: branchId(asset.branchIndex),
    meter_reading: asset.meterReading ?? null,
    meter_unit: asset.meterUnit ?? null,
    // The schema takes a reading, its unit and its moment together or none
    // of the three.
    meter_read_at: asset.meterReading === undefined ? null : daysAgoIso(asset.purchasedDaysAgo),
    service_interval_days: asset.serviceIntervalDays ?? null,
    purchased_on: dateInDays(-asset.purchasedDaysAgo),
    notes: asset.notes ?? null,
    created_by: userId,
  }));
  const equipment = await insertAll(client, "crm_equipment", equipmentRows, "id, asset_tag");
  if ("error" in equipment) return equipment;
  const equipmentIdByTag = new Map(
    equipment.data.map((row) => [row.asset_tag as string, row.id as string]),
  );

  /*
   * The ledger, oldest first per asset, with meter readings that only ever
   * climb — the trigger refuses anything else, and a seeder that produced
   * a backwards reading would be testing the guard rather than filling the
   * book.
   */
  const equipmentEventRows = dataset.equipment.flatMap((asset) => {
    const equipmentId = equipmentIdByTag.get(asset.assetTag);
    if (equipmentId === undefined) return [];
    let meter = asset.meterReading ?? null;
    return asset.events.map((event) => {
      if (event.meterAdd !== undefined && meter !== null) meter += event.meterAdd;
      return {
        organization_id: org,
        equipment_id: equipmentId,
        kind: event.kind,
        technician_id:
          event.technicianIndex === undefined ? null : technicianId(event.technicianIndex),
        meter_reading: event.meterAdd === undefined ? null : meter,
        cost_cents: event.costCents ?? null,
        vendor: event.vendor ?? null,
        note: event.note ?? null,
        occurred_at: daysAgoIso(event.daysAgo),
        created_by: userId,
      };
    });
  });
  const equipmentEvents = await insertAll(
    client,
    "crm_equipment_events",
    equipmentEventRows,
    "id",
  );
  if ("error" in equipmentEvents) return equipmentEvents;

  /* --------------------------- recurring billing and collections (12) */

  /*
   * Billing runs are historical records of batches somebody performed.
   * They are seeded directly rather than by calling the generator: the
   * generator would advance every plan's next_due as a side effect, which
   * would leave the corpus with nothing due and a dispatch board that
   * reads as finished work.
   */
  const billingRunRows = dataset.billingRuns.map((run) => ({
    organization_id: org,
    through_on: dateInDays(-run.throughDaysAgo),
    plans_considered: run.plansConsidered,
    invoices_created: run.invoicesCreated,
    plans_already_billed: run.plansAlreadyBilled,
    total_cents: run.totalCents,
    note: run.note,
    ran_at: daysAgoIso(run.throughDaysAgo),
    created_by: userId,
  }));
  const billingRuns = await insertAll(client, "crm_billing_runs", billingRunRows, "id");
  if ("error" in billingRuns) return billingRuns;

  /*
   * What somebody did about an overdue invoice. The account is carried on
   * the row and a trigger checks it against the invoice's own account, so
   * these are built from each account's own invoices rather than from a
   * flat list — a note filed against the wrong customer is refused, and
   * rightly.
   */
  const dunningRows = dataset.accounts.flatMap((account) => {
    const accountId = accountIdByName.get(account.name);
    if (accountId === undefined) return [];
    const numbers = (operations.get(account.name)?.billing.invoices ?? [])
      .filter((invoice) => invoice.status === "open")
      .map((invoice) => invoice.number);
    if (numbers.length === 0) return [];
    return (account.dunning ?? []).flatMap((notice) => {
      const number = numbers[notice.invoiceSeat % numbers.length];
      const invoiceId = invoiceIdByNumber.get(number);
      if (invoiceId === undefined) return [];
      return [{
        organization_id: org,
        invoice_id: invoiceId,
        account_id: accountId,
        action: notice.action,
        days_overdue: notice.daysOverdue,
        // Derived from the account's own index rather than drawn from a
        // generator this module does not own: the runner stays a pure
        // shaper of rows, and a re-run reproduces the same figure.
        balance_cents: (5 + ((account.index * 37 + notice.invoiceSeat * 11) % 896)) * 1000,
        outcome: notice.outcome ?? null,
        acted_at: daysAgoIso(notice.actedDaysAgo),
        created_by: userId,
      }];
    });
  });
  const dunningNotices = await insertAll(client, "crm_dunning_notices", dunningRows, "id");
  if ("error" in dunningNotices) return dunningNotices;

  /* ------------------------------------------- the customer portal (10) */

  /*
   * INVITATIONS, not logins. `user_id`, `activated_at` and `last_seen_at`
   * are left empty on every seeded row because a login is a real Supabase
   * auth user accepting an invitation, and the seeder has none to offer.
   * Writing a fabricated uuid there would break the foreign key; writing a
   * date without one would claim a customer signed in who never did.
   */
  const portalUserRows = dataset.accounts.flatMap((account) => {
    const accountId = accountIdByName.get(account.name);
    if (accountId === undefined) return [];
    return (account.portalUsers ?? []).map((portalUser) => ({
      organization_id: org,
      account_id: accountId,
      contact_id: contactIdByKey.get(`${accountId}:${portalUser.email}`) ?? null,
      email: portalUser.email,
      role: portalUser.role,
      invited_at: daysAgoIso(portalUser.invitedDaysAgo),
      active: portalUser.active,
      created_by: userId,
    }));
  });
  const portalUsers = await insertAll(
    client,
    "crm_portal_users",
    portalUserRows,
    "id, account_id, email",
  );
  if ("error" in portalUsers) return portalUsers;
  const portalUserIdByKey = new Map(
    portalUsers.data.map((row) => [`${row.account_id as string}:${row.email as string}`, row.id as string]),
  );

  /*
   * Provenance on a share of the sightings (increment 15).
   *
   * Some sightings are a technician's observation and some are the
   * customer walking their own floor at 06:00 and filing it before the
   * branch opens. Both are real, and the branch triaging the morning list
   * needs to tell them apart — so a deterministic third of each account's
   * sightings are stamped with that account's first portal seat.
   *
   * This is an UPDATE rather than part of the insert because the portal
   * invitations do not exist yet at the point the sightings are written,
   * and a stamp pointing at a row that is not there is not provenance.
   */
  const sightingIdsBySeat = new Map<string, string[]>();
  {
    const seenPerAccount = new Map<string, number>();
    for (const row of sightings.data) {
      const sightingAccount = row.account_id as string;
      const seen = seenPerAccount.get(sightingAccount) ?? 0;
      seenPerAccount.set(sightingAccount, seen + 1);
      if (seen % 3 !== 0) continue;
      const account = dataset.accounts.find(
        (candidate) => accountIdByName.get(candidate.name) === sightingAccount,
      );
      const seat = account?.portalUsers?.[0];
      if (seat === undefined) continue;
      const portalUserId = portalUserIdByKey.get(`${sightingAccount}:${seat.email}`);
      if (portalUserId === undefined) continue;
      const bucket = sightingIdsBySeat.get(portalUserId);
      if (bucket === undefined) sightingIdsBySeat.set(portalUserId, [row.id as string]);
      else bucket.push(row.id as string);
    }
  }
  let customerReportedSightings = 0;
  for (const [portalUserId, ids] of sightingIdsBySeat) {
    const stamped = await client
      .from("crm_pest_sightings")
      .update({ reported_by_portal_user_id: portalUserId } as never)
      .in("id", ids)
      .select("id");
    if (stamped.error) return { error: stamped.error };
    customerReportedSightings += (stamped.data ?? []).length;
  }

  const portalRequestRows = dataset.accounts.flatMap((account) => {
    const accountId = accountIdByName.get(account.name);
    if (accountId === undefined) return [];
    const visitOffset = visitOffsets.get(account.name) ?? 0;
    const seats = account.portalUsers ?? [];
    return (account.portalRequests ?? []).map((request) => {
      const seat = request.portalSeat === undefined ? undefined : seats[request.portalSeat];
      return {
        organization_id: org,
        account_id: accountId,
        property_id:
          request.propertySeat === undefined ? null : propertyFor(account.name, request.propertySeat),
        portal_user_id:
          seat === undefined ? null : portalUserIdByKey.get(`${accountId}:${seat.email}`) ?? null,
        kind: request.kind,
        status: request.status,
        summary: request.summary,
        detail: request.detail ?? null,
        preferred_date: request.preferredInDays === undefined ? null : dateInDays(request.preferredInDays),
        response: request.response ?? null,
        work_order_id:
          request.visitSeat === undefined ? null : visitIds[visitOffset + request.visitSeat] ?? null,
        submitted_at: daysAgoIso(request.submittedDaysAgo),
        // The schema pairs these: a closed request carries the moment it
        // closed, and an open one carries none.
        resolved_at: request.resolvedDaysAgo === undefined ? null : daysAgoIso(request.resolvedDaysAgo),
        created_by: userId,
      };
    });
  });
  const portalRequests = await insertAll(client, "crm_portal_requests", portalRequestRows, "id");
  if ("error" in portalRequests) return portalRequests;

  const canvassRouteRows = dataset.canvassRoutes.map((route) => {
    const walkedAt = daysAgoIso(route.walkedDaysAgo);
    return {
      organization_id: org,
      territory_id: territoryId(route.territoryIndex),
      rep_id: employeeId(route.repIndex),
      name: route.name,
      status: route.status,
      walked_on: dateInDays(-route.walkedDaysAgo),
      // A walked route has a start; a complete one has both moments.
      started_at: route.status === "planned" || route.status === "cancelled" ? null : walkedAt,
      ended_at: route.status === "complete" ? walkedAt : null,
      notes: route.notes,
      created_by: userId,
    };
  });
  const canvassRoutes = await insertAll(client, "crm_canvass_routes", canvassRouteRows, "id");
  if ("error" in canvassRoutes) return canvassRoutes;
  const canvassRouteIds = canvassRoutes.data.map((row) => row.id as string);

  const knockRows = dataset.canvassRoutes.flatMap((route, routeIndex) =>
    route.knocks.map((knock) => ({
      organization_id: org,
      canvass_route_id: canvassRouteIds[routeIndex],
      // Only a sale names the customer it produced; the CHECK requires it.
      account_id:
        knock.accountIndex === undefined
          ? null
          : accountIdByName.get(dataset.accounts[knock.accountIndex]?.name ?? "") ?? null,
      address: knock.address,
      disposition: knock.disposition,
      knocked_at: daysAgoIso(Math.max(1, route.walkedDaysAgo)),
      follow_up_on:
        knock.followUpInDays === undefined ? null : dateInDays(knock.followUpInDays),
      note: knock.note,
      created_by: userId,
    })),
  ).filter((row) => row.disposition !== "sold" || row.account_id !== null);
  const knocks = await insertAll(client, "crm_knocks", knockRows, "id");
  if ("error" in knocks) return knocks;

  // Which door produced which customer, so a door-knock touch can name the
  // knock it came from rather than gesturing at the channel.
  const knockIds = knocks.data.map((row) => row.id as string);
  const soldKnockByAccount = new Map<string, string>();
  for (const [position, row] of knockRows.entries()) {
    const accountId = row.account_id;
    if (typeof accountId !== "string") continue;
    if (soldKnockByAccount.has(accountId)) continue;
    const id = knockIds[position];
    if (id !== undefined) soldKnockByAccount.set(accountId, id);
  }

  const listRows = dataset.marketingLists.map((list) => ({
    organization_id: org,
    name: list.name,
    description: list.description,
    is_dynamic: list.isDynamic,
    criteria: list.criteria ?? null,
    active: list.active,
    created_by: userId,
  }));
  const lists = await insertAll(client, "crm_marketing_lists", listRows, "id, name");
  if ("error" in lists) return lists;
  const listIdByName = new Map(lists.data.map((row) => [row.name as string, row.id as string]));
  const listId = (index: number | undefined) =>
    index === undefined ? null : listIdByName.get(dataset.marketingLists[index]?.name ?? "") ?? null;

  // Consent, with the moment it was withdrawn kept rather than the row
  // removed. One membership per account per list, which the index enforces.
  const memberRows: SeedRow[] = [];
  {
    const seen = new Set<string>();
    for (const account of dataset.accounts) {
      const accountId = accountIdByName.get(account.name);
      if (accountId === undefined) continue;
      for (const seat of account.listSeats ?? []) {
        const list = listId(seat.listIndex);
        if (list === null) continue;
        const key = `${list}:${accountId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        memberRows.push({
          organization_id: org,
          list_id: list,
          account_id: accountId,
          source: seat.source,
          added_at: daysAgoIso(seat.addedDaysAgo),
          unsubscribed_at:
            seat.unsubscribedDaysAgo === undefined ? null : daysAgoIso(seat.unsubscribedDaysAgo),
          unsubscribe_reason: seat.unsubscribeReason ?? null,
          created_by: userId,
        });
      }
    }
  }
  const listMembers = await insertAll(client, "crm_list_members", memberRows, "id");
  if ("error" in listMembers) return listMembers;

  const campaignRows = dataset.campaigns.map((campaign) => ({
    organization_id: org,
    list_id: listId(campaign.listIndex),
    name: campaign.name,
    channel: campaign.channel,
    status: campaign.status,
    subject: campaign.subject ?? null,
    body: campaign.body,
    budget_cents: campaign.budgetCents,
    scheduled_at:
      campaign.scheduledDaysAgo === undefined ? null : daysAgoIso(campaign.scheduledDaysAgo),
    sent_at: campaign.sentDaysAgo === undefined ? null : daysAgoIso(campaign.sentDaysAgo),
    created_by: userId,
  }));
  const campaigns = await insertAll(client, "crm_campaigns", campaignRows, "id, name");
  if ("error" in campaigns) return campaigns;
  const campaignIdByName = new Map(
    campaigns.data.map((row) => [row.name as string, row.id as string]),
  );

  /*
   * The message log. The funnel only runs one way — a click implies an open,
   * an open implies delivery, delivery implies a send — so each message is
   * built by walking forward from queued and stopping where its outcome
   * says it stopped.
   */
  const messageRows = dataset.campaigns.flatMap((campaign, campaignIndex) => {
    const id = campaignIdByName.get(campaign.name);
    if (id === undefined || campaign.recipientCount === 0) return [];
    const sentDaysAgo = campaign.sentDaysAgo ?? 30;
    return Array.from({ length: campaign.recipientCount }, (_, seat) => {
      const account = dataset.accounts[(seat * campaign.recipientStride + campaignIndex) % dataset.accounts.length];
      const accountId = accountIdByName.get(account.name);
      if (accountId === undefined) return null;
      const outcome = (campaignIndex + seat) % 8;
      const sentAt = daysAgoIso(sentDaysAgo);
      const deliveredAt = daysAgoIso(Math.max(1, sentDaysAgo - 1));
      const openedAt = daysAgoIso(Math.max(1, sentDaysAgo - 2));
      const clickedAt = daysAgoIso(Math.max(1, sentDaysAgo - 3));
      const status =
        outcome === 0 ? "bounced"
        : outcome === 1 ? "failed"
        : outcome === 2 ? "unsubscribed"
        : outcome === 3 ? "sent"
        : outcome === 4 ? "delivered"
        : outcome <= 6 ? "opened"
        : "clicked";
      const reached = status !== "bounced" && status !== "failed";
      const delivered = reached && status !== "sent";
      const opened = status === "opened" || status === "clicked";
      const clicked = status === "clicked";
      return {
        organization_id: org,
        campaign_id: id,
        account_id: accountId,
        channel: campaign.channel,
        status,
        destination: campaign.channel === "sms" ? account.phone : account.email,
        queued_at: daysAgoIso(Math.min(900, sentDaysAgo + 1)),
        sent_at: reached || status === "bounced" ? sentAt : null,
        delivered_at: delivered ? deliveredAt : null,
        opened_at: opened ? openedAt : null,
        clicked_at: clicked ? clickedAt : null,
        // A reason belongs to a failure, and only to one.
        failure_reason:
          status === "bounced" ? "Mailbox does not exist."
          : status === "failed" ? "The carrier rejected the message."
          : null,
        created_by: userId,
      };
    }).filter((row): row is NonNullable<typeof row> => row !== null);
  });
  const messages = await insertAll(client, "crm_messages", messageRows, "id");
  if ("error" in messages) return messages;

  const automationRows = dataset.automations.map((automation) => ({
    organization_id: org,
    name: automation.name,
    trigger_on: automation.triggerOn,
    action: automation.action,
    delay_hours: automation.delayHours,
    template: automation.template ?? null,
    active: automation.active,
    // Deliberately zero: no executor runs these, and the schema CHECKs that
    // a run count and a last-run moment agree. Seeding a count would be
    // claiming something ran.
    run_count: 0,
    last_run_at: null,
    created_by: userId,
  }));
  const automations = await insertAll(client, "crm_automations", automationRows, "id");
  if ("error" in automations) return automations;

  const attributionRows = dataset.accounts.flatMap((account) => {
    const accountId = accountIdByName.get(account.name);
    if (accountId === undefined) return [];
    return (account.touches ?? []).map((touch) => ({
      organization_id: org,
      account_id: accountId,
      opportunity_id:
        account.opportunities.length > 0
          ? opportunityIdByName.get(account.opportunities[0].name) ?? null
          : null,
      campaign_id:
        touch.campaignIndex === undefined
          ? null
          : campaignIdByName.get(dataset.campaigns[touch.campaignIndex]?.name ?? "") ?? null,
      // A canvassing touch names the door it came from, where that door is
      // one this book actually recorded.
      knock_id: touch.source === "door knock" ? soldKnockByAccount.get(accountId) ?? null : null,
      source: touch.source,
      medium: touch.medium,
      position: touch.position,
      touched_at: daysAgoIso(touch.touchedDaysAgo),
      note: touch.note,
      created_by: userId,
    }));
  });
  const attributions = await insertAll(client, "crm_attributions", attributionRows, "id");
  if ("error" in attributions) return attributions;

  /* ------------------------------- forms, timesheets and licences (9) */

  const templateRows = dataset.formTemplates.map((template) => ({
    organization_id: org,
    name: template.name,
    kind: template.kind,
    version: template.version,
    description: template.description,
    active: template.active,
    created_by: userId,
  }));
  const formTemplates = await insertAll(client, "crm_form_templates", templateRows, "id, name");
  if ("error" in formTemplates) return formTemplates;
  const templateIdByName = new Map(
    formTemplates.data.map((row) => [row.name as string, row.id as string]),
  );
  const templateId = (index: number) =>
    templateIdByName.get(dataset.formTemplates[index]?.name ?? "") ?? null;

  /*
   * The questions have to land before any form is assigned from a template:
   * once one is, the schema freezes them, and a seeder adding a question
   * afterwards would be testing that guard rather than the book.
   */
  const fieldRows = dataset.formTemplates.flatMap((template, templateIndex) => {
    const id = templateId(templateIndex);
    if (id === null) return [];
    return template.fields.map((field, position) => ({
      organization_id: org,
      template_id: id,
      position: position + 1,
      label: field.label,
      field_type: field.fieldType,
      required: field.required,
      help_text: field.helpText,
      options: field.options ?? null,
    }));
  });
  const formFields = await insertAll(client, "crm_form_fields", fieldRows, "id, template_id, position");
  if ("error" in formFields) return formFields;
  const fieldIdByKey = new Map(
    formFields.data.map((row) => [`${row.template_id as string}:${row.position as number}`, row.id as string]),
  );

  const instanceRows = dataset.accounts.flatMap((account) => {
    const accountId = accountIdByName.get(account.name);
    if (accountId === undefined) return [];
    const visitOffset = visitOffsets.get(account.name) ?? 0;
    return (account.forms ?? []).flatMap((form) => {
      const template = templateId(form.templateIndex);
      if (template === null) return [];
      const assignedAt = daysAgoIso(form.assignedDaysAgo);
      return [
        {
          organization_id: org,
          template_id: template,
          account_id: accountId,
          property_id:
            form.propertySeat === undefined ? null : propertyFor(account.name, form.propertySeat),
          work_order_id:
            form.visitSeat === undefined ? null : visitIds[visitOffset + form.visitSeat] ?? null,
          technician_id: technicianId(form.technicianIndex),
          // Assigned first, so the answers can land before the completion
          // the database checks them against.
          status: "assigned",
          assigned_at: assignedAt,
          started_at: form.status === "assigned" ? null : assignedAt,
          notes: form.notes,
          created_by: userId,
        },
      ];
    });
  });
  const formInstances = await insertAll(client, "crm_form_instances", instanceRows, "id");
  if ("error" in formInstances) return formInstances;
  const instanceIds = formInstances.data.map((row) => row.id as string);

  // Answers, each in the column its question's type calls for.
  const answerRows: SeedRow[] = [];
  {
    let cursor = 0;
    for (const account of dataset.accounts) {
      if (accountIdByName.get(account.name) === undefined) continue;
      for (const form of account.forms ?? []) {
        const template = dataset.formTemplates[form.templateIndex];
        const templateKey = templateId(form.templateIndex);
        const instance = instanceIds[cursor];
        if (template === undefined || templateKey === null || instance === undefined) {
          cursor += 1;
          continue;
        }
        template.fields.forEach((field, position) => {
          // A part-finished form answers what it has reached; a completed
          // one answers everything, which is what lets it complete.
          if (!form.answerEvery && !field.required) return;
          const fieldId = fieldIdByKey.get(`${templateKey}:${position + 1}`);
          if (fieldId === undefined) return;
          answerRows.push({
            organization_id: org,
            instance_id: instance,
            field_id: fieldId,
            value_text:
              field.fieldType === "text" ? `${account.contacts[0]?.firstName ?? "Alex"} ${account.contacts[0]?.lastName ?? "Reyes"}`
              : field.fieldType === "long_text" ? "Interior, exterior perimeter, dock doors and the dry store."
              : field.fieldType === "select" ? (field.options ?? ["none"])[(account.index + position) % (field.options?.length ?? 1)]
              : null,
            value_number: field.fieldType === "number" ? 4 + ((account.index + position) % 18) : null,
            value_boolean: field.fieldType === "boolean" ? (account.index + position) % 3 !== 0 : null,
            value_date: field.fieldType === "date" ? dateInDays(30 + (position % 60)) : null,
            value_options:
              field.fieldType === "multi_select"
                ? [(field.options ?? ["ants"])[(account.index + position) % (field.options?.length ?? 1)]]
                : null,
            answered_at: daysAgoIso(Math.max(1, form.assignedDaysAgo - 1)),
            created_by: userId,
          });
        });
        cursor += 1;
      }
    }
  }
  const formAnswers = await insertAll(client, "crm_form_answers", answerRows, "id");
  if ("error" in formAnswers) return formAnswers;

  // Now the forms can reach the status they were meant to have, because the
  // completeness trigger has something to count.
  {
    let cursor = 0;
    const byStatus = new Map<string, string[]>();
    for (const account of dataset.accounts) {
      if (accountIdByName.get(account.name) === undefined) continue;
      for (const form of account.forms ?? []) {
        const instance = instanceIds[cursor];
        cursor += 1;
        if (instance === undefined || form.status === "assigned") continue;
        const bucket = byStatus.get(form.status) ?? [];
        bucket.push(instance);
        byStatus.set(form.status, bucket);
      }
    }
    for (const [status, ids] of byStatus) {
      for (let start = 0; start < ids.length; start += 500) {
        const slice = ids.slice(start, start + 500);
        const moved = await client
          .from("crm_form_instances")
          .update({
            status,
            completed_at: status === "completed" ? new Date().toISOString() : null,
          } as never)
          .eq("organization_id", org)
          .in("id", slice);
        if (moved.error) return { error: moved.error };
      }
    }
  }

  // Signatures, on the completed forms that carry one.
  {
    let cursor = 0;
    for (const account of dataset.accounts) {
      if (accountIdByName.get(account.name) === undefined) continue;
      for (const form of account.forms ?? []) {
        const instance = instanceIds[cursor];
        cursor += 1;
        if (instance === undefined || form.signedByName === undefined) continue;
        const signed = await client
          .from("crm_form_instances")
          .update({
            signed_by_name: form.signedByName,
            signed_at: daysAgoIso(Math.max(1, form.assignedDaysAgo - 1)),
            signature_path: `services/forms/${String(account.index).padStart(4, "0")}-${cursor}.png`,
          } as never)
          .eq("organization_id", org)
          .eq("id", instance);
        if (signed.error) return { error: signed.error };
      }
    }
  }

  // Shifts, laid end to end per technician by the generator so none
  // overlaps another — the database refuses an overlap.
  /*
   * Which visits each technician actually performed, so a shift names a
   * work order that person really worked rather than any row that would
   * satisfy the foreign key.
   */
  const visitsByTechnician = new Map<string, string[]>();
  for (const [position, row] of visitRows.entries()) {
    const assigned = row.technician_id;
    const visit = visitIds[position];
    if (typeof assigned !== "string" || visit === undefined) continue;
    const bucket = visitsByTechnician.get(assigned) ?? [];
    bucket.push(visit);
    visitsByTechnician.set(assigned, bucket);
  }

  const shiftRows = dataset.technicians.flatMap((technician, technicianIndex) => {
    const id = technicianId(technicianIndex);
    if (id === null) return [];
    const theirVisits = visitsByTechnician.get(id) ?? [];
    return (technician.shifts ?? []).map((shift, seat) => {
      const start = new Date(Date.now() - shift.startedDaysAgo * 86_400_000);
      start.setUTCHours(shift.startHour, 0, 0, 0);
      const end = new Date(start.getTime() + shift.hours * 3_600_000);
      return {
        organization_id: org,
        technician_id: id,
        // A shift spent on a job names it; a day of admin or training does
        // not, which is why the column is nullable in the first place.
        work_order_id:
          theirVisits.length > 0 && seat % 2 === 0
            ? theirVisits[seat % theirVisits.length]
            : null,
        started_at: start.toISOString(),
        // An open shift has no end, and reports no worked total.
        ended_at: shift.open ? null : end.toISOString(),
        break_minutes: shift.breakMinutes,
        notes: shift.notes,
        created_by: userId,
      };
    });
  });
  const timesheets = await insertAll(client, "crm_timesheets", shiftRows, "id");
  if ("error" in timesheets) return timesheets;

  // Licence expiry, so the compliance page has expired, expiring, current
  // and unrecorded licences to tell apart. Grouped by date so one statement
  // serves every technician sharing it.
  {
    const byDate = new Map<string, string[]>();
    for (const [index, technician] of dataset.technicians.entries()) {
      const id = technicianId(index);
      if (id === null || technician.licenceExpiresInDays === undefined) continue;
      const key = `${dateInDays(technician.licenceExpiresInDays)}|${technician.licenceState ?? "OR"}`;
      const bucket = byDate.get(key) ?? [];
      bucket.push(id);
      byDate.set(key, bucket);
    }
    for (const [key, ids] of byDate) {
      const [expires, state] = key.split("|");
      for (let start = 0; start < ids.length; start += 500) {
        const dated = await client
          .from("crm_technicians")
          .update({ license_expires_on: expires, license_state: state } as never)
          .eq("organization_id", org)
          .in("id", ids.slice(start, start + 500));
        if (dated.error) return { error: dated.error };
      }
    }
  }

  /* --------------------------------------------------- hand-recorded history */

  const eventRows = dataset.accounts.flatMap((account) =>
    account.events.map((event) => ({
      organization_id: org,
      account_id: accountIdByName.get(account.name),
      kind: event.kind,
      summary: event.summary,
      detail: event.detail,
      occurred_at: daysAgoIso(event.daysAgo),
      actor_user_id: userId,
    })),
  );
  const events = await insertAll(client, "crm_timeline_events", eventRows, "id");
  if ("error" in events) return events;

  /*
   * The three tables the roster census (task #78) found uncovered. They are
   * business data, not operational exhaust, so they are seeded rather than
   * excused: a plan's calendar, where the chemical physically sits, and the
   * proof that a field write arrived.
   */

  /** A deterministic uuid, so re-seeding is idempotent by natural key. */
  const seedUuid = (prefix: string, ordinal: number) =>
    `${prefix}-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;

  // ADR-211: the calendar a sequenced plan actually runs on.
  const stepRows: SeedRow[] = plans.data.flatMap((plan, index) => {
    const cycle = planRows[index]?.cycle_months as number | null | undefined;
    if (cycle == null) return [];
    const planId = plan.id as string;
    // A twice-monthly plan's visits are both the plan's own service; a
    // quarterly programme names what each visit is, which is the half of
    // sequencing an interval cannot express.
    const seasonal = ["Perimeter treatment", "Mosquito programme", "Rodent inspection"];
    const steps: SeedRow[] = cycle === 1
      ? [
          { position: 1, month_offset: 0, anchor: "day_of_month", day_of_month: 1,
            week_of_month: null, weekday: null, service_type: null },
          { position: 2, month_offset: 0, anchor: "day_of_month", day_of_month: 15,
            week_of_month: null, weekday: null, service_type: null },
        ]
      : [
          { position: 1, month_offset: 0, anchor: "nth_weekday", day_of_month: null,
            week_of_month: 2, weekday: 2,
            service_type: seasonal[index % seasonal.length] },
          { position: 2, month_offset: 1, anchor: "day_of_month", day_of_month: 20,
            week_of_month: null, weekday: null, service_type: null },
        ];
    return steps.map((step) => ({
      organization_id: org, plan_id: planId, ...step, created_by: userId,
    }));
  });
  const planSteps = await insertAll(client, "crm_plan_steps", stepRows, "id");
  if ("error" in planSteps) return planSteps;

  // ADR-213: every lot arrives at a depot, and half of them go out on a truck.
  const branchIds = branches.data.map((row) => row.id as string);
  const vehicleIds = equipment.data.map((row) => row.id as string);
  const movementRows: SeedRow[] = lots.data.flatMap((lot, index) => {
    const lotId = lot.id as string;
    const received = lotRows[index]?.quantity_received as number | undefined;
    if (received === undefined || branchIds.length === 0) return [];
    const depot = branchIds[index % branchIds.length];
    const rows: SeedRow[] = [{
      organization_id: org, lot_id: lotId, kind: "receipt", quantity: received,
      to_branch_id: depot, occurred_at: daysAgoIso(120 - (index % 90)),
      recorded_by: userId,
    }];
    // A truck load is a quarter of the lot, so the depot keeps the rest and
    // neither side can go negative.
    const load = Math.max(1, Math.round((received / 4) * 1000) / 1000);
    if (index % 2 === 0 && vehicleIds.length > 0) {
      const truck = vehicleIds[index % vehicleIds.length];
      rows.push({
        organization_id: org, lot_id: lotId, kind: "transfer",
        quantity: load,
        from_branch_id: depot,
        to_equipment_id: truck,
        occurred_at: daysAgoIso(110 - (index % 80)),
        note: index % 6 === 0 ? "Loaded for the northern route" : null,
        recorded_by: userId,
      });
      // Every third truck load comes back at the end of a week, which is
      // the movement that fills the other direction.
      if (index % 6 === 0) {
        rows.push({
          organization_id: org, lot_id: lotId, kind: "transfer",
          quantity: Math.max(1, Math.round((load / 2) * 1000) / 1000),
          from_equipment_id: truck,
          to_branch_id: depot,
          occurred_at: daysAgoIso(100 - (index % 70)),
          note: "Returned to the shelf after the route",
          recorded_by: userId,
        });
      }
    }
    // A shelf count that found less than the ledger said. An adjustment
    // rather than an edit, because the ledger is append-only.
    if (index % 7 === 0) {
      rows.push({
        organization_id: org, lot_id: lotId, kind: "adjustment",
        quantity: 1,
        from_branch_id: depot,
        occurred_at: daysAgoIso(30 + (index % 20)),
        note: "Shelf count came up one short",
        recorded_by: userId,
      });
    }
    return rows;
  });
  /*
   * A treatment draws its material from somewhere, and the ledger says
   * where. One consumption per lot, from the depot, naming the application
   * it served — the quantities have to match exactly, which is the rule
   * `crm_stock_record_movement` enforces at runtime and the reason this
   * seed cannot simply pick a number.
   *
   * Only applications small enough to fit what the depot still holds after
   * its truck load and shelf adjustment are drawn, because seeding a
   * location into a negative balance would be seeding a lie about a
   * regulated chemical.
   */
  const depotByLot = new Map<string, { depot: string; received: number }>();
  lots.data.forEach((lot, index) => {
    const received = lotRows[index]?.quantity_received as number | undefined;
    if (received === undefined || branchIds.length === 0) return;
    depotByLot.set(lot.id as string, {
      depot: branchIds[index % branchIds.length],
      received,
    });
  });
  const drawnLots = new Set<string>();
  applications.data.forEach((application, index) => {
    const source = originalRows[index];
    const lotId = source?.lot_id as string | undefined;
    const quantity = source?.quantity as number | undefined;
    if (lotId === undefined || quantity === undefined || drawnLots.has(lotId)) return;
    const held = depotByLot.get(lotId);
    if (held === undefined || quantity > held.received / 4) return;
    drawnLots.add(lotId);
    movementRows.push({
      organization_id: org,
      lot_id: lotId,
      kind: "consumption",
      quantity,
      from_branch_id: held.depot,
      application_id: application.id as string,
      occurred_at: source?.applied_at as string,
      note: null,
      recorded_by: userId,
    });
  });

  const stockMovements = await insertAll(client, "crm_stock_movements", movementRows, "id");
  if ("error" in stockMovements) return stockMovements;

  // ADR-210: a completed visit that was synced from the field carries the
  // token the device minted, which is what makes a replay a no-op.
  const submissionRows: SeedRow[] = visits.data.flatMap((visit, index) => {
    if (!visitSources[index]?.statusPath.includes("completed")) return [];
    const day = visitRows[index]?.scheduled_start as string | undefined;
    if (day === undefined) return [];
    // A completion is the common case; a device scan and a customer-filed
    // sighting also arrive from the field, and a report that only ever saw
    // one kind would not prove the queue carries the others.
    const kind = index % 5 === 1
      ? "device_scan"
      : index % 5 === 3 ? "pest_sighting" : "complete_work_order";
    return [{
      organization_id: org,
      client_token: seedUuid("50000000", index),
      kind,
      // Only a completion's result is the work order itself; the other
      // kinds produced rows this seed does not track, and inventing an id
      // would be a reference to something that is not there.
      result_id: kind === "complete_work_order" ? (visit.id as string) : null,
      occurred_at: day,
      submitted_by: userId,
    }];
  });
  const fieldSubmissions = await insertAll(client, "crm_field_submissions", submissionRows, "id");
  if ("error" in fieldSubmissions) return fieldSubmissions;

  /*
   * Units inside a property (ADR-215). Commercial sites get doors; a
   * single-family home does not, which is the case the schema had to keep
   * working unchanged.
   */
  const unitRows: SeedRow[] = properties.data.flatMap((property, index) => {
    if (index % 3 !== 0) return [];
    const propertyId = property.id as string;
    // Six doors and a common area, which is what a small block looks like.
    return ["1A", "1B", "2A", "2B", "3A", "3B", "Common laundry"].map((label, door) => ({
      organization_id: org,
      property_id: propertyId,
      label,
      unit_type: label.startsWith("Common") ? "common area" : "apartment",
      occupant_name: label.startsWith("Common")
        ? null
        : `${["M.", "R.", "J.", "T.", "S.", "N."][door % 6]} ${
            ["Okafor", "Halvorsen", "Nakamura", "Delacroix", "Ferreira", "Adeyemi"][
              (index + door) % 6
            ]}`,
      access_notes: door % 4 === 0 ? "Buzzer is out; call from the lobby" : null,
      active: !(door === 5 && index % 9 === 0),
      created_by: userId,
    }));
  });
  const propertyUnits = await insertAll(client, "crm_property_units", unitRows, "id, property_id");
  if ("error" in propertyUnits) return propertyUnits;

  /*
   * A filed copy of a completed visit's report (ADR-216). The bytes are what
   * the report said on the day, which is what an auditor asks for.
   */
  const filedDocumentRows: SeedRow[] = visits.data.flatMap((visit, index) => {
    // One filed report per completed visit, which is what a service report is.
    if (!visitSources[index]?.statusPath.includes("completed")) return [];
    const order = visitRows[index];
    if (order === undefined) return [];
    const day = String(order.scheduled_start).slice(0, 10);
    const body = `<h1>Service report</h1><p>${order.service_type} on ${day}.</p>`
      + `<p>Findings and materials as recorded against this visit.</p>`;
    return [{
      organization_id: org,
      account_id: order.account_id as string,
      property_id: order.property_id as string,
      work_order_id: visit.id as string,
      kind: index % 11 === 0 ? "logbook_extract" : "service_report",
      title: `${order.service_type} — ${day}`,
      content_type: index % 13 === 0 ? "text/plain" : "text/html",
      byte_size: Buffer.byteLength(body, "utf8"),
      body,
      filed_by: userId,
    }];
  });
  const serviceDocuments = await insertAll(
    client, "crm_service_documents", filedDocumentRows, "id",
  );
  if ("error" in serviceDocuments) return serviceDocuments;

  /*
   * Some reports are corrected after filing. A correction is another filing
   * that names the one it replaces; the original stays, because a customer
   * may already hold it.
   */
  const documentCorrectionRows: SeedRow[] = serviceDocuments.data.flatMap((document, index) => {
    if (index % 8 !== 0) return [];
    const original = filedDocumentRows[index];
    if (original === undefined) return [];
    const corrected = `${original.body as string}<p>Corrected: material quantity restated.</p>`;
    return [{
      ...original,
      title: `${original.title as string} (corrected)`,
      byte_size: Buffer.byteLength(corrected, "utf8"),
      body: corrected,
      supersedes_id: document.id as string,
    }];
  });
  const documentCorrections = await insertAll(
    client, "crm_service_documents", documentCorrectionRows, "id",
  );
  if ("error" in documentCorrections) return documentCorrections;

  // An issued inspection is filed the same way, which is the copy a buyer's
  // lender asks for months later.
  const inspectionDocumentRows: SeedRow[] = wdoOriginals.data.flatMap((inspection, index) => {
    const source = wdoFirstPass[index];
    if (source === undefined) return [];
    const body = `<h1>Inspection report ${inspection.report_number as string}</h1>`
      + `<p>Findings as issued. This copy is what the report said on the day.</p>`;
    return [{
      organization_id: org,
      account_id: source.account_id as string,
      property_id: source.property_id as string,
      inspection_id: inspection.id as string,
      kind: "inspection_report",
      title: `Inspection ${inspection.report_number as string}`,
      content_type: "text/html",
      byte_size: Buffer.byteLength(body, "utf8"),
      body,
      filed_by: userId,
    }];
  });
  const inspectionDocuments = await insertAll(
    client, "crm_service_documents", inspectionDocumentRows, "id",
  );
  if ("error" in inspectionDocuments) return inspectionDocuments;

  /*
   * Contact preferences (ADR-217). Transactional permission is kept apart
   * from marketing permission on purpose: leaving a newsletter is not a
   * request to stop being told a technician is arriving tomorrow.
   */
  const preferenceRows: SeedRow[] = dataset.accounts.flatMap((account, index) => {
    const accountId = accountIdByName.get(account.name);
    if (accountId === undefined) return [];
    return (["email", "sms"] as const).map((channel, slot) => {
      const position = index * 2 + slot;
      // A small minority have asked to be left alone entirely, and a few
      // more want only the money conversations. Both are ordinary.
      const stopped = position % 17 === 0;
      const transactionalOff = !stopped && position % 23 === 0;
      return {
        organization_id: org,
        account_id: accountId,
        channel,
        transactional_allowed: !stopped && !transactionalOff,
        // A do-not-contact forces both false; the schema refuses any other
        // combination, so this cannot drift into a contradiction.
        marketing_allowed: !stopped && position % 5 !== 0,
        do_not_contact_at: stopped ? daysAgoIso(90 + (position % 120)) : null,
        do_not_contact_reason: stopped
          ? ["Asked by phone", "Written request", "Asked at the door"][position % 3]
            + " to stop all contact."
          : null,
        updated_by: userId,
      };
    });
  });
  const contactPreferences = await insertAll(
    client, "crm_contact_preferences", preferenceRows, "id",
  );
  if ("error" in contactPreferences) return contactPreferences;

  // Which (account, channel) pairs may not be written to, so the notices
  // below suppress for the SAME reason the composer would have.
  const noticeBlocked = new Set(
    preferenceRows
      .filter((row) => row.do_not_contact_at !== null || row.transactional_allowed === false)
      .map((row) => `${row.account_id as string}:${row.channel as string}`),
  );

  // Plainly synthetic on both channels: `example.test` is reserved and can
  // never route, and the number is inside the 555 range kept for fiction.
  const noticeDestination = (channel: string, index: number) =>
    channel === "email"
      ? `account${index}@example.test`
      : `+1555${String(100000 + (index % 899999)).slice(0, 6)}`;

  /*
   * Transactional notices (ADR-217).
   *
   * NOT ONE OF THESE IS `sent`, deliberately. No SMS or email provider is
   * connected in a seeded workspace, so a seeded `sent` row would be the
   * exact falsehood this increment exists to make impossible — and it
   * could not be written anyway: the state is reachable only through
   * crm_notice_mark_dispatched, which asks whether a provider is live.
   */
  const noticeRows: SeedRow[] = [];
  visits.data.forEach((visit, index) => {
    const order = visitRows[index];
    if (order === undefined) return;
    const accountId = order.account_id as string;
    const day = String(order.scheduled_start).slice(0, 10);
    const completed = visitSources[index]?.statusPath.includes("completed") ?? false;

    const reminderBlocked = noticeBlocked.has(`${accountId}:sms`);
    noticeRows.push({
      organization_id: org,
      account_id: accountId,
      kind: "visit_reminder",
      channel: "sms",
      state: reminderBlocked ? "suppressed" : index % 29 === 0 ? "cancelled" : "composed",
      work_order_id: visit.id as string,
      subject_line: null,
      body: `Your ${String(order.service_type)} is on ${day}. Reply to reschedule.`,
      destination: noticeDestination("sms", index),
      due_on: day,
      due_at: `${day}T16:00:00Z`,
      suppressed_at: reminderBlocked ? daysAgoIso(30) : null,
      suppression_reason: reminderBlocked
        ? "The customer asked not to be contacted on sms."
        : null,
      cancelled_at: !reminderBlocked && index % 29 === 0 ? daysAgoIso(20) : null,
      created_by: userId,
    });

    if (!completed) return;
    const followBlocked = noticeBlocked.has(`${accountId}:email`);
    noticeRows.push({
      organization_id: org,
      account_id: accountId,
      kind: "visit_completed",
      channel: "email",
      // A handful never left, and the reason is kept rather than guessed at.
      state: followBlocked ? "suppressed" : index % 37 === 0 ? "failed" : "composed",
      work_order_id: visit.id as string,
      subject_line: `Your ${String(order.service_type)} on ${day}`,
      body: `<p>Thank you — your ${String(order.service_type)} was completed on ${day}. `
        + `The service report is on your portal.</p>`,
      destination: noticeDestination("email", index),
      due_on: day,
      due_at: `${day}T18:00:00Z`,
      suppressed_at: followBlocked ? daysAgoIso(30) : null,
      suppression_reason: followBlocked
        ? "The customer asked not to be contacted on email."
        : null,
      failure_reason: !followBlocked && index % 37 === 0
        ? "The address on file bounced; no forwarding address."
        : null,
      created_by: userId,
    });
  });

  // Money notices, against the invoices that are actually outstanding.
  invoices.data.forEach((invoice, index) => {
    const source = invoiceRows[index];
    if (source === undefined || source.status !== "open") return;
    const accountId = source.account_id as string | undefined;
    if (accountId === undefined) return;
    const blocked = noticeBlocked.has(`${accountId}:email`);
    const dueOn = String(source.due_on);
    noticeRows.push({
      organization_id: org,
      account_id: accountId,
      kind: index % 3 === 0 ? "invoice_overdue" : "invoice_due",
      channel: "email",
      state: blocked ? "suppressed" : "composed",
      invoice_id: invoice.id as string,
      subject_line: `Invoice ${invoice.number as string}`,
      body: `<p>Invoice ${invoice.number as string} for `
        + `$${((source.total_cents as number) / 100).toFixed(2)} is due ${dueOn}.</p>`,
      destination: noticeDestination("email", index),
      due_on: dueOn,
      due_at: `${dueOn}T09:00:00Z`,
      suppressed_at: blocked ? daysAgoIso(30) : null,
      suppression_reason: blocked ? "The customer asked not to be contacted on email." : null,
      created_by: userId,
    });
  });
  const notices = await insertAll(client, "crm_notices", noticeRows, "id");
  if ("error" in notices) return notices;

  /*
   * The day route (ADR-221). A route is what a technician actually drives,
   * which is not the same as the order the appointments were booked in — so
   * the stops are grouped by technician and day and then SEQUENCED, and the
   * sequence is the dispatcher's own.
   *
   * Nothing here computes an order from geography. There are no coordinates
   * to compute one from, and inventing a plausible-looking optimisation
   * would be seeding a claim the product does not make.
   */
  const routeBranchIds = [...branchIdByCode.values()];
  const visitsByTechnicianDay = new Map<string, { technician: string; day: string; visits: string[] }>();
  visits.data.forEach((visit, index) => {
    const source = visitRows[index];
    if (source === undefined) return;
    const technician = source.technician_id as string | null;
    if (technician === null) return;
    const day = String(source.scheduled_start).slice(0, 10);
    const key = `${technician}|${day}`;
    const group = visitsByTechnicianDay.get(key);
    if (group === undefined) {
      visitsByTechnicianDay.set(key, { technician, day, visits: [visit.id as string] });
    } else {
      group.visits.push(visit.id as string);
    }
  });

  const routeGroups = [...visitsByTechnicianDay.values()];
  const routeRows: SeedRow[] = routeGroups.map((group, index) => {
    // A route in the past was driven; one in the future is still being
    // built. Only a released route has a released moment, and only a
    // completed one has both — the schema checks that pairing.
    const past = group.day < dateInDays(0);
    const status = past ? "completed" : index % 4 === 0 ? "released" : "planned";
    return {
      organization_id: org,
      technician_id: group.technician,
      branch_id: routeBranchIds[index % routeBranchIds.length],
      route_date: group.day,
      status,
      name: `${group.day} — ${["north", "harbour", "ridge", "valley"][index % 4]}`,
      note: index % 9 === 0 ? "Depot stock check before the first call." : null,
      released_at: status === "planned" ? null : `${group.day}T06:45:00Z`,
      completed_at: status === "completed" ? `${group.day}T17:20:00Z` : null,
      created_by: userId,
    };
  });
  const routes = await insertAll(client, "crm_routes", routeRows, "id");
  if ("error" in routes) return routes;

  const routeStopRows: SeedRow[] = routes.data.flatMap((route, index) => {
    const group = routeGroups[index];
    if (group === undefined) return [];
    return group.visits.map((visitId, position) => ({
      organization_id: org,
      route_id: route.id as string,
      work_order_id: visitId,
      position: position + 1,
      // What the dispatcher expects, half an hour apart from the depot —
      // an expectation, not the promise the customer holds, which lives on
      // the work order's own window.
      planned_arrival: `${group.day}T${String(8 + Math.min(position, 9)).padStart(2, "0")}:30:00Z`,
      note: position === 0 && index % 7 === 0
        ? "First call: site opens at eight, gate code at the kiosk."
        : null,
      created_by: userId,
    }));
  });
  const routeStops = await insertAll(client, "crm_route_stops", routeStopRows, "id");
  if ("error" in routeStops) return routeStops;

  /*
   * Autopay authorization (ADR-218). The instrument is metadata only — a
   * brand, four digits and the NAME of the vault purpose a processor token
   * would be filed under. Nothing here is or resembles a card number, and
   * the schema refuses one if it ever were.
   */
  const instrumentRows: SeedRow[] = dataset.accounts.flatMap((account, index) => {
    const accountId = accountIdByName.get(account.name);
    if (accountId === undefined) return [];
    // Roughly one household in six pays by bank debit rather than card.
    const bank = index % 6 === 0;
    return [{
      organization_id: org,
      account_id: accountId,
      kind: bank ? "bank_account" : "card",
      display_brand: bank
        ? ["Cascadia Credit Union", "Harbor Savings", "Mercantile Bank"][index % 3]
        : ["Visa", "Mastercard", "American Express", "Discover"][index % 4],
      last_four: String(1000 + (index * 7) % 9000),
      // Expiry belongs to a card and only to a card; the schema checks both
      // ways, so a bank account carrying one would be refused.
      expires_month: bank ? null : 1 + (index % 12),
      expires_year: bank ? null : 2027 + (index % 4),
      holder_name: account.name,
      vault_purpose: bank ? "crm_ach_processor_token" : "crm_card_processor_token",
      // A few were retired — a lost card, a closed account — and are kept
      // rather than deleted, because mandates and charges point at them.
      removed_at: index % 23 === 0 ? daysAgoIso(40 + (index % 90)) : null,
      removed_reason: index % 23 === 0
        ? ["Card reported lost", "Bank account closed", "Replaced by the customer"][index % 3]
        : null,
      created_by: userId,
    }];
  });
  const instruments = await insertAll(
    client, "crm_payment_instruments", instrumentRows, "id",
  );
  if ("error" in instruments) return instruments;

  /*
   * The mandate: what the customer agreed to, in the words they were shown,
   * frozen. This is the row that answers a bank's question months later,
   * and it is append-only for exactly that reason.
   */
  const AGREEMENT_TEXT =
    "I authorise this company to charge the payment method on file for each "
    + "invoice as it falls due, up to the limit recorded on my account, until "
    + "I withdraw this authorisation in writing or by telephone.";
  const mandateRows: SeedRow[] = instruments.data.map((instrument, index) => {
    const source = instrumentRows[index];
    return {
      organization_id: org,
      account_id: source.account_id as string,
      instrument_id: instrument.id as string,
      channel: (["web", "phone", "paper", "in_person"] as const)[index % 4],
      agreement_text: AGREEMENT_TEXT,
      // Two wordings in circulation, because a shop that revised its terms
      // needs to find every mandate taken under the old one.
      agreement_version: index % 5 === 0 ? "v2.0" : "v2.1",
      authorized_by_name: String(source.holder_name),
      authorized_at: daysAgoIso(120 + (index % 400)),
      recorded_by: userId,
    };
  });
  const mandates = await insertAll(client, "crm_payment_mandates", mandateRows, "id");
  if ("error" in mandates) return mandates;

  // One live enrollment per account, which the schema enforces: two would
  // race to charge the same invoice twice.
  const enrollmentRows: SeedRow[] = mandates.data.flatMap((mandate, index) => {
    const source = mandateRows[index];
    const instrumentSource = instrumentRows[index];
    // An instrument that was retired cannot carry a live enrollment; the
    // trigger refuses it, so the seed must not attempt one.
    if (instrumentSource.removed_at !== null) return [];
    return [{
      organization_id: org,
      account_id: source.account_id as string,
      instrument_id: source.instrument_id as string,
      mandate_id: mandate.id as string,
      plan_id: null,
      charge_offset_days: [0, 1, 3, 5, 7][index % 5],
      // The ceiling the customer authorized, comfortably above an ordinary
      // invoice so a routine charge fits and an unusual one does not.
      max_amount_cents: [50000, 120000, 250000, 500000][index % 4],
      revoked_at: index % 19 === 0 ? daysAgoIso(15 + (index % 60)) : null,
      revoke_reason: index % 19 === 0
        ? ["Customer asked to pay by cheque", "Card repeatedly declined",
           "Account moved to invoice terms"][index % 3]
        : null,
      created_by: userId,
    }];
  });
  const enrollments = await insertAll(
    client, "crm_autopay_enrollments", enrollmentRows, "id",
  );
  if ("error" in enrollments) return enrollments;

  const liveEnrollmentByAccount = new Map<string, { id: string; cap: number }>();
  enrollments.data.forEach((enrollment, index) => {
    const source = enrollmentRows[index];
    if (source.revoked_at !== null) return;
    liveEnrollmentByAccount.set(source.account_id as string, {
      id: enrollment.id as string,
      cap: source.max_amount_cents as number,
    });
  });

  /*
   * Charge attempts.
   *
   * NOT ONE IS `succeeded`, deliberately. No card processor is connected in
   * a seeded workspace, so a settled row would be the exact falsehood
   * ADR-218 exists to make impossible — and it could not be written anyway:
   * the state has no writer but crm_autopay_record_settlement, which asks
   * whether a processor is live before it acts.
   */
  /*
   * The balances are read BACK from the database rather than taken from the
   * rows this function built. `paid_cents` and `status` are maintained by
   * the payment triggers, so the objects assembled up in this file never
   * saw a payment land — computing an outstanding balance from them would
   * be arithmetic on a number that was always zero.
   */
  const invoiceState = await client
    .from("crm_invoices")
    .select("id, account_id, status, total_cents, paid_cents, due_on")
    .eq("organization_id", org);
  if (invoiceState.error) return { error: invoiceState.error };

  const chargeRows: SeedRow[] = [];
  (invoiceState.data ?? []).forEach((invoice, index) => {
    const accountId = invoice.account_id as string | null;
    if (accountId === null) return;
    const enrollment = liveEnrollmentByAccount.get(accountId);
    if (enrollment === undefined) return;
    if (invoice.due_on === null) return;

    const total = Number(invoice.total_cents);
    const outstanding = total - Number(invoice.paid_cents);

    /*
     * A SCHEDULED charge is still waiting, so it needs an invoice with
     * something outstanding. A FAILED or CANCELLED one is history, and
     * history sits on invoices settled some other way — a declined card
     * followed by a cheque. An `uncollectible` invoice is that story with a
     * worse ending, and a failed charge is usually how it got there.
     *
     * There is no "paid" status in this schema: an invoice is settled when
     * paid_cents reaches total_cents while the status stays `open`.
     */
    const waiting = invoice.status === "open" && outstanding > 0;
    const settled = invoice.status === "open" && outstanding <= 0;
    const writtenOff = invoice.status === "uncollectible";
    // A draft has not been issued and a void never existed; neither is
    // something a customer can be charged for.
    if (!waiting && !settled && !writtenOff) return;

    const amount = waiting ? outstanding : total;
    // A charge may never exceed the ceiling the customer authorised; the
    // trigger refuses it, so the seed does not attempt one.
    if (amount <= 0 || amount > enrollment.cap) return;

    const failed = writtenOff || (settled ? index % 2 === 0 : index % 11 === 0);
    const cancelled = !failed && (settled || index % 17 === 0);
    chargeRows.push({
      organization_id: org,
      enrollment_id: enrollment.id,
      invoice_id: invoice.id as string,
      amount_cents: amount,
      // A date column comes back as a Date, and String() on one yields
      // "Wed Jul 23 2025 ..." rather than a date literal Postgres accepts.
      scheduled_on: new Date(invoice.due_on as string).toISOString().slice(0, 10),
      state: failed ? "failed" : cancelled ? "cancelled" : "scheduled",
      failure_reason: failed
        ? ["The card was declined by the issuer", "Insufficient funds",
           "The card on file has expired"][index % 3]
        : null,
      cancelled_at: cancelled ? daysAgoIso(5 + (index % 30)) : null,
      created_by: userId,
    });
  });
  const chargeAttempts = await insertAll(client, "crm_charge_attempts", chargeRows, "id");
  if ("error" in chargeAttempts) return chargeAttempts;

  const timelineTotal = await client
    .from("crm_timeline_events")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org);
  if (timelineTotal.error) return { error: timelineTotal.error };

  return {
    seeded: {
      accounts: accounts.data.length,
      contacts: contacts.data.length,
      properties: properties.data.length,
      opportunities: opportunities.data.length,
      technicians: technicians.data.length,
      servicePlans: plans.data.length,
      workOrders: visits.data.length,
      devices: devices.data.length,
      // Every device's install scan is written by the database, plus the
      // hand-recorded scans above.
      deviceScans: devices.data.length + scans.data.length,
      sightings: sightings.data.length,
      customerReportedSightings,
      wdoInspections: wdoInspectionCount,
      wdoFindings: wdoFindings.data.length,
      products: products.data.length,
      lots: lots.data.length,
      applications: applications.data.length + corrections.data.length,
      complianceRules: rules.data.length,
      estimates: estimates.data.length,
      estimateLines: estimateLines.data.length,
      contracts: contracts.data.length,
      invoices: invoices.data.length,
      invoiceLines: invoiceLines.data.length,
      payments: payments.data.length,
      refunds: refunds.data.length,
      branches: branches.data.length,
      employees: employees.data.length,
      territories: territories.data.length,
      commissions: commissions.data.length,
      documents: documents.data.length,
      portalUsers: portalUsers.data.length,
      portalRequests: portalRequests.data.length,
      billingRuns: billingRuns.data.length,
      dunningNotices: dunningNotices.data.length,
      equipment: equipment.data.length,
      equipmentEvents: equipmentEvents.data.length,
      canvassRoutes: canvassRoutes.data.length,
      knocks: knocks.data.length,
      marketingLists: lists.data.length,
      listMembers: listMembers.data.length,
      campaigns: campaigns.data.length,
      messages: messages.data.length,
      automations: automations.data.length,
      attributions: attributions.data.length,
      formTemplates: formTemplates.data.length,
      formFields: formFields.data.length,
      formInstances: formInstances.data.length,
      formAnswers: formAnswers.data.length,
      timesheets: timesheets.data.length,
      timelineEvents: timelineTotal.count ?? 0,
      planSteps: planSteps.data.length,
      stockMovements: stockMovements.data.length,
      fieldSubmissions: fieldSubmissions.data.length,
      propertyUnits: propertyUnits.data.length,
      serviceDocuments: serviceDocuments.data.length + documentCorrections.data.length
        + inspectionDocuments.data.length,
    },
  };
}
