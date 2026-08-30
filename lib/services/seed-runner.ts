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

  /* ---------------------------------------------------------- independents */

  const technicianRows = dataset.technicians.map((technician) => ({
    organization_id: org,
    first_name: technician.firstName,
    last_name: technician.lastName,
    email: technician.email,
    phone: technician.phone,
    license_number: technician.licenseNumber,
    active: technician.active,
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
      timelineEvents: timelineTotal.count ?? 0,
    },
  };
}
