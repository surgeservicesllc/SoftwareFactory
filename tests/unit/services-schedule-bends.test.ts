import { describe, expect, it } from "vitest";

import { projectDayLabel, summarizeBulkEdit, toProjectProgressView } from "@/lib/services/schedule-bends";

describe("a bulk edit's one sentence", () => {
  it("counts what changed and groups what did not by the reason", () => {
    expect(summarizeBulkEdit([])).toEqual({ applied: 0, refused: 0, sentence: "Nothing was selected." });
    const ok = (id: string) => ({ workOrderId: id, applied: true, reason: null, technicianId: null, scheduledStart: null, status: null });
    const no = (id: string, reason: string) => ({ workOrderId: id, applied: false, reason, technicianId: null, scheduledStart: null, status: null });
    expect(summarizeBulkEdit([ok("a"), ok("b")]).sentence).toBe("2 of 2 changed.");
    expect(summarizeBulkEdit([
      ok("a"), no("b", "completed; not changed"), no("c", 'on route "Tuesday north" for 2026-10-06; take it off the route first'), no("d", "not found in this workspace"), no("e", "completed; not changed"),
    ])).toEqual({ applied: 1, refused: 4, sentence: "1 of 5 changed; 4 not: 2 completed, 1 on a route, 1 not found." });
  });
});

describe("a project's day label and progress", () => {
  it("numbers a visit within its project's distinct days, and nothing for an ordinary visit", () => {
    const visits = [
      { projectId: "p", scheduledStart: "2026-10-13T07:00:00Z" },
      { projectId: "p", scheduledStart: "2026-10-12T07:00:00Z" },
      { projectId: "p", scheduledStart: "2026-10-14T07:00:00Z" },
      { projectId: null, scheduledStart: "2026-10-12T09:00:00Z" },
    ];
    expect(projectDayLabel(visits[0], visits)).toBe("Day 2 of 3");
    expect(projectDayLabel(visits[2], visits)).toBe("Day 3 of 3");
    expect(projectDayLabel(visits[3], visits)).toBeNull();
  });

  it("maps a progress row with numbers as numbers and an unknown state as planned", () => {
    expect(toProjectProgressView({
      project_id: "p", name: "Plant fumigation", account_id: "a", account_name: "Harborview", property_id: "s", property_label: "Plant",
      technician_id: null, technician_name: null, service_type: "Fumigation", starts_on: "2026-10-12", ends_on: "2026-10-16", status: "planned", note: null,
      days: "5" as unknown as number, completed: 1, cancelled: 0, remaining: 4, next_day: "2026-10-13", state: "active",
    })).toMatchObject({ days: 5, completed: 1, remaining: 4, nextDay: "2026-10-13", state: "active", technicianName: null });
    expect(toProjectProgressView({
      project_id: "p", name: "x", account_id: "a", account_name: "A", property_id: "s", property_label: null, technician_id: null, technician_name: null,
      service_type: "x", starts_on: "2026-10-12", ends_on: "2026-10-12", status: "planned", note: null, days: 1, completed: 0, cancelled: 0, remaining: 1, next_day: null, state: "weird",
    }).state).toBe("planned");
  });
});
