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
  const contacts = await insertAll(client, "crm_contacts", contactRows, "id");
  if ("error" in contacts) return contacts;

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

  const planRows = dataset.accounts.flatMap((account) =>
    (operations.get(account.name)?.plans ?? []).map((plan) => ({
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
      created_by: userId,
    })),
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
  const sightings = await insertAll(client, "crm_pest_sightings", sightingRows, "id");
  if ("error" in sightings) return sightings;

  /* --------------------------------------------------------- applications */

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
    },
  };
}
