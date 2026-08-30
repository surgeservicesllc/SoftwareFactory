import type { SupabaseClient } from "@supabase/supabase-js";

import { DEMO_BOOK, DEMO_SOURCE, DEMO_TECHNICIANS, demoBookTotals } from "@/lib/services/demo-data";

/**
 * Seed the Demo Data book of business into one organization, through the
 * same RLS-scoped client every live write uses. Statuses and stages are
 * walked one move at a time so the database triggers write the history —
 * nothing here forges a system timeline row, and everything a seeded
 * account shows is a row the machinery really recorded.
 *
 * The route guards that the book is empty before calling this; the seeder
 * itself only ever adds rows for the given organization.
 */

type SeedError = { message: string; code?: string };

export type SeedOutcome =
  | { error: SeedError }
  | {
      seeded: {
        accounts: number;
        contacts: number;
        properties: number;
        opportunities: number;
        technicians: number;
        servicePlans: number;
        workOrders: number;
        timelineEvents: number;
      };
    };

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function isoAtHour(daysFromNow: number, hour: number): string {
  const day = new Date(Date.now() + daysFromNow * 86_400_000).toISOString().slice(0, 10);
  return `${day}T${String(hour).padStart(2, "0")}:00:00Z`;
}

function isoDateInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

export async function seedDemoData(
  client: SupabaseClient,
  organizationId: string,
  userId: string,
): Promise<SeedOutcome> {
  const accounts = await client
    .from("crm_accounts")
    .insert(
      DEMO_BOOK.map((account) => ({
        organization_id: organizationId,
        name: account.name,
        kind: account.kind,
        status: "lead",
        email: account.email,
        phone: account.phone,
        source: DEMO_SOURCE,
        billing_address: account.billingAddress,
        notes: account.notes ?? null,
        created_by: userId,
      })),
    )
    .select("id, name");
  if (accounts.error) return { error: accounts.error };
  const accountIds = new Map(
    ((accounts.data ?? []) as { id: string; name: string }[]).map((row) => [row.name, row.id]),
  );

  // Status history, written by the trigger one real move at a time.
  for (const account of DEMO_BOOK) {
    const accountId = accountIds.get(account.name);
    if (!accountId) return { error: { message: `Seeded account missing: ${account.name}` } };
    for (const status of account.statusPath) {
      const moved = await client
        .from("crm_accounts")
        .update({ status })
        .eq("organization_id", organizationId)
        .eq("id", accountId);
      if (moved.error) return { error: moved.error };
    }
  }

  const contacts = await client.from("crm_contacts").insert(
    DEMO_BOOK.flatMap((account) =>
      account.contacts.map((contact, index) => ({
        organization_id: organizationId,
        account_id: accountIds.get(account.name),
        first_name: contact.firstName,
        last_name: contact.lastName,
        role: contact.role ?? null,
        email: contact.email ?? null,
        phone: contact.phone ?? null,
        is_primary: index === 0,
      })),
    ),
  );
  if (contacts.error) return { error: contacts.error };

  const properties = await client
    .from("crm_properties")
    .insert(
      DEMO_BOOK.flatMap((account) =>
        account.properties.map((property) => ({
          organization_id: organizationId,
          account_id: accountIds.get(account.name),
          label: property.label,
          address: property.address,
          property_type: property.propertyType ?? null,
          access_notes: property.accessNotes ?? null,
        })),
      ),
    )
    .select("id, account_id, label");
  if (properties.error) return { error: properties.error };
  const propertyIds = new Map(
    ((properties.data ?? []) as { id: string; account_id: string; label: string }[]).map((row) => [
      `${row.account_id}:${row.label}`,
      row.id,
    ]),
  );

  const opportunities = await client
    .from("crm_opportunities")
    .insert(
      DEMO_BOOK.flatMap((account) =>
        account.opportunities.map((opportunity) => ({
          organization_id: organizationId,
          account_id: accountIds.get(account.name),
          name: opportunity.name,
          stage: "new",
          value_cents: opportunity.valueCents,
          expected_close_date:
            opportunity.expectedInDays === undefined ? null : isoDateInDays(opportunity.expectedInDays),
          created_by: userId,
        })),
      ),
    )
    .select("id, account_id, name");
  if (opportunities.error) return { error: opportunities.error };
  const opportunityIds = new Map(
    ((opportunities.data ?? []) as { id: string; account_id: string; name: string }[]).map((row) => [
      `${row.account_id}:${row.name}`,
      row.id,
    ]),
  );

  // Stage history — each move a real update, each history line a trigger's.
  for (const account of DEMO_BOOK) {
    const accountId = accountIds.get(account.name);
    for (const opportunity of account.opportunities) {
      const opportunityId = opportunityIds.get(`${accountId}:${opportunity.name}`);
      if (!opportunityId) return { error: { message: `Seeded opportunity missing: ${opportunity.name}` } };
      for (const stage of opportunity.stagePath) {
        const moved = await client
          .from("crm_opportunities")
          .update({
            stage,
            ...(stage === "lost" && opportunity.lostReason ? { lost_reason: opportunity.lostReason } : {}),
          })
          .eq("organization_id", organizationId)
          .eq("id", opportunityId);
        if (moved.error) return { error: moved.error };
      }
    }
  }

  // The field-service layer: roster, recurring plans, and visits whose
  // completions the database itself writes onto the timeline.
  const technicians = await client
    .from("crm_technicians")
    .insert(
      DEMO_TECHNICIANS.map((technician) => ({
        organization_id: organizationId,
        first_name: technician.firstName,
        last_name: technician.lastName,
        phone: technician.phone,
        license_number: technician.licenseNumber,
        created_by: userId,
      })),
    )
    .select("id, license_number");
  if (technicians.error) return { error: technicians.error };
  const technicianIds = new Map(
    ((technicians.data ?? []) as { id: string; license_number: string }[]).map((row) => [
      row.license_number,
      row.id,
    ]),
  );
  const technicianByIndex = (index: number | undefined) =>
    index === undefined ? null : technicianIds.get(DEMO_TECHNICIANS[index].licenseNumber) ?? null;

  const planRows = DEMO_BOOK.flatMap((account) =>
    (account.plans ?? []).map((plan) => ({
      organization_id: organizationId,
      account_id: accountIds.get(account.name),
      property_id: propertyIds.get(`${accountIds.get(account.name)}:${plan.propertyLabel}`),
      service_type: plan.serviceType,
      recurrence: plan.recurrence,
      next_due: new Date(Date.now() + plan.dueInDays * 86_400_000).toISOString().slice(0, 10),
      technician_id: technicianByIndex(plan.technicianIndex),
      value_cents: plan.valueCents ?? null,
      created_by: userId,
    })),
  );
  if (planRows.length > 0) {
    const plans = await client.from("crm_service_plans").insert(planRows);
    if (plans.error) return { error: plans.error };
  }

  for (const account of DEMO_BOOK) {
    const accountId = accountIds.get(account.name);
    for (const visit of account.visits ?? []) {
      const propertyId = propertyIds.get(`${accountId}:${visit.propertyLabel}`);
      if (!propertyId) return { error: { message: `Seeded property missing: ${visit.propertyLabel}` } };
      const inserted = await client
        .from("crm_work_orders")
        .insert({
          organization_id: organizationId,
          account_id: accountId,
          property_id: propertyId,
          technician_id: technicianByIndex(visit.technicianIndex),
          service_type: visit.serviceType,
          scheduled_start: isoAtHour(visit.inDays, 9),
          scheduled_end: isoAtHour(visit.inDays, 9 + visit.durationHours),
          created_by: userId,
        })
        .select("id")
        .single();
      if (inserted.error) return { error: inserted.error };
      for (const status of visit.statusPath) {
        const moved = await client
          .from("crm_work_orders")
          .update({
            status,
            ...(status === "completed" && visit.completionNotes
              ? { completion_notes: visit.completionNotes }
              : {}),
          })
          .eq("organization_id", organizationId)
          .eq("id", (inserted.data as { id: string }).id);
        if (moved.error) return { error: moved.error };
      }
    }
  }

  const events = await client.from("crm_timeline_events").insert(
    DEMO_BOOK.flatMap((account) =>
      account.events.map((event) => ({
        organization_id: organizationId,
        account_id: accountIds.get(account.name),
        kind: event.kind,
        summary: event.summary,
        detail: event.detail ?? null,
        occurred_at: isoDaysAgo(event.daysAgo),
        actor_user_id: userId,
      })),
    ),
  );
  if (events.error) return { error: events.error };

  const totals = demoBookTotals();
  return {
    seeded: {
      accounts: totals.accounts,
      contacts: totals.contacts,
      properties: totals.properties,
      opportunities: totals.opportunities,
      technicians: DEMO_TECHNICIANS.length,
      servicePlans: totals.plans,
      workOrders: totals.workOrders,
      // Hand-recorded events plus every trigger-written status move, stage
      // move, and visit outcome (completion or cancellation).
      timelineEvents:
        totals.manualEvents + totals.statusMoves + totals.stageMoves + totals.visitOutcomes,
    },
  };
}
