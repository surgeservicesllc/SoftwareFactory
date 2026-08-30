// @vitest-environment node

import { describe, expect, it } from "vitest";

import { DEMO_BOOK, DEMO_SOURCE, DEMO_TECHNICIANS, demoBookTotals } from "@/lib/services/demo-data";

/**
 * The Demo Data book's honesty and shape, pinned. The seeded book must be
 * rich enough to present the CRM, incapable of reaching a real person, and
 * within every bound the schema CHECKs enforce — the chain suite proves the
 * database accepts it; this file proves the dataset means what the Demo
 * Data label promises.
 */

describe("the Demo Data book", () => {
  it("is a substantial clientele across kinds, lifecycles and pipeline stages", () => {
    const totals = demoBookTotals();
    expect(totals.accounts).toBeGreaterThanOrEqual(12);
    expect(totals.contacts).toBeGreaterThanOrEqual(totals.accounts);
    expect(totals.properties).toBeGreaterThanOrEqual(totals.accounts);
    expect(totals.opportunities).toBeGreaterThanOrEqual(10);
    expect(totals.manualEvents).toBeGreaterThanOrEqual(30);

    expect(DEMO_BOOK.some((account) => account.kind === "commercial")).toBe(true);
    expect(DEMO_BOOK.some((account) => account.kind === "residential")).toBe(true);
    // Every lifecycle status is represented, including a full journey to inactive.
    expect(DEMO_BOOK.some((account) => account.statusPath.length === 0)).toBe(true);
    expect(DEMO_BOOK.some((account) => account.statusPath.at(-1) === "customer")).toBe(true);
    expect(DEMO_BOOK.some((account) => account.statusPath.at(-1) === "inactive")).toBe(true);

    const finalStages = DEMO_BOOK.flatMap((account) =>
      account.opportunities.map((opportunity) => opportunity.stagePath.at(-1) ?? "new"),
    );
    expect(finalStages).toContain("won");
    expect(finalStages).toContain("lost");
    // Open deals remain on the board in several stages.
    expect(new Set(finalStages).size).toBeGreaterThanOrEqual(5);
  });

  it("cannot reach a real person: reserved domains, fictional phones, fictional companies", () => {
    for (const account of DEMO_BOOK) {
      expect(account.email, account.name).toMatch(/@[a-z0-9.-]+\.example$/);
      expect(account.phone, account.name).toMatch(/^\(555\) /);
      for (const contact of account.contacts) {
        if (contact.email) expect(contact.email, account.name).toMatch(/@[a-z0-9.-]+\.example$/);
        if (contact.phone) expect(contact.phone, account.name).toMatch(/^\(555\) /);
      }
    }
    expect(DEMO_SOURCE).toBe("Demo Data");
  });

  it("stays inside every bound the schema CHECKs enforce", () => {
    for (const account of DEMO_BOOK) {
      expect(account.name.length, account.name).toBeLessThanOrEqual(200);
      expect(account.billingAddress.length, account.name).toBeLessThanOrEqual(500);
      if (account.notes) expect(account.notes.length, account.name).toBeLessThanOrEqual(4000);
      expect(account.phone).toMatch(/^[0-9+() .\-]{7,32}$/);
      for (const contact of account.contacts) {
        expect(contact.firstName.length).toBeLessThanOrEqual(100);
        expect(contact.lastName.length).toBeLessThanOrEqual(100);
        if (contact.phone) expect(contact.phone).toMatch(/^[0-9+() .\-]{7,32}$/);
        if (contact.role) expect(contact.role.length).toBeLessThanOrEqual(120);
      }
      for (const property of account.properties) {
        expect(property.label.length).toBeLessThanOrEqual(200);
        expect(property.address.length).toBeLessThanOrEqual(500);
        if (property.accessNotes) expect(property.accessNotes.length).toBeLessThanOrEqual(2000);
      }
      for (const opportunity of account.opportunities) {
        expect(opportunity.name.length).toBeLessThanOrEqual(200);
        expect(opportunity.valueCents).toBeGreaterThan(0);
        expect(opportunity.valueCents).toBeLessThanOrEqual(100_000_000_000);
        if (opportunity.stagePath.at(-1) === "lost") {
          // A seeded loss always explains itself.
          expect(opportunity.lostReason, opportunity.name).toBeTruthy();
          expect(opportunity.lostReason!.length).toBeLessThanOrEqual(300);
        } else {
          expect(opportunity.lostReason, opportunity.name).toBeUndefined();
        }
      }
      for (const event of account.events) {
        expect(event.summary.length, account.name).toBeLessThanOrEqual(300);
        if (event.detail) expect(event.detail.length).toBeLessThanOrEqual(4000);
        expect(event.daysAgo).toBeGreaterThan(0);
      }
    }
  });

  it("fields a real service operation: roster, plans, visits with earned history", () => {
    const totals = demoBookTotals();
    expect(DEMO_TECHNICIANS.length).toBeGreaterThanOrEqual(3);
    for (const technician of DEMO_TECHNICIANS) {
      expect(technician.phone).toMatch(/^\(555\) /);
      expect(technician.licenseNumber).toMatch(/^DEMO-/);
    }
    expect(totals.plans).toBeGreaterThanOrEqual(5);
    expect(totals.workOrders).toBeGreaterThanOrEqual(6);
    // The seeded schedule shows the whole story: due plans, upcoming
    // visits, completed history, and a cancellation.
    expect(DEMO_BOOK.some((account) => (account.plans ?? []).some((plan) => plan.dueInDays <= 0))).toBe(true);
    expect(DEMO_BOOK.some((account) => (account.visits ?? []).some((visit) => visit.inDays > 0 && visit.statusPath.length === 0))).toBe(true);
    expect(DEMO_BOOK.some((account) => (account.visits ?? []).some((visit) => visit.statusPath.includes("cancelled")))).toBe(true);
    for (const account of DEMO_BOOK) {
      const propertyLabels = new Set(account.properties.map((property) => property.label));
      for (const plan of account.plans ?? []) {
        // A typo'd label would cross-wire the seed silently.
        expect(propertyLabels.has(plan.propertyLabel), `${account.name}: ${plan.propertyLabel}`).toBe(true);
        expect(plan.serviceType.length).toBeLessThanOrEqual(120);
        if (plan.technicianIndex !== undefined) {
          expect(plan.technicianIndex).toBeLessThan(DEMO_TECHNICIANS.length);
        }
      }
      for (const visit of account.visits ?? []) {
        expect(propertyLabels.has(visit.propertyLabel), `${account.name}: ${visit.propertyLabel}`).toBe(true);
        expect(visit.serviceType.length).toBeLessThanOrEqual(120);
        expect(visit.durationHours).toBeGreaterThanOrEqual(1);
        expect(visit.durationHours).toBeLessThanOrEqual(14);
        expect(visit.technicianIndex).toBeLessThan(DEMO_TECHNICIANS.length);
        if (visit.completionNotes) expect(visit.completionNotes.length).toBeLessThanOrEqual(3500);
        // A completed visit always tells the field story.
        if (visit.statusPath.includes("completed")) {
          expect(visit.completionNotes, `${account.name}: ${visit.serviceType}`).toBeTruthy();
        }
      }
    }
  });

  it("keeps the seeder's lookup keys unambiguous", () => {
    // The seeder maps inserted ids back by account name, and opportunities by
    // account + name — duplicates would silently cross-wire the seed.
    const names = DEMO_BOOK.map((account) => account.name);
    expect(new Set(names).size).toBe(names.length);
    for (const account of DEMO_BOOK) {
      const opportunityNames = account.opportunities.map((opportunity) => opportunity.name);
      expect(new Set(opportunityNames).size, account.name).toBe(opportunityNames.length);
    }
  });
});
