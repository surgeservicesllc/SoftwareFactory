import { describe, expect, it } from "vitest";

import { explainEmptyQueue, type QueueGraphRow } from "@/lib/worker/queue-diagnosis";

/**
 * The empty queue explains itself.
 *
 * These cases mirror `claim_planned_graph`'s filters one for one, because the
 * diagnosis is only useful while it agrees with the function it explains. The
 * one line it must never print wrongly is "looks claimable": that sentence
 * accuses the claim of a contradiction, so every excluded case above it has to
 * catch its own graphs first.
 */

const SUPPORTED = ["DETERMINISTIC", "MODEL", "ANCHOR"];

function graph(overrides: Partial<QueueGraphRow>): QueueGraphRow {
  return {
    id: "g-1",
    requires_owner_approval: false,
    is_lifecycle: false,
    created_at: "2026-08-23T20:00:00Z",
    withdrawn_at: null,
    pause_requested_at: null,
    repository_scope_matches: true,
    required_check_policy_matches: true,
    phase1c_resume_ready: true,
    graph_nodes: [{ executor: "MODEL" }],
    graph_runs: [],
    graph_gates: [],
    ...overrides,
  };
}

function reasonOf(lines: readonly string[]): string {
  expect(lines.length).toBe(2);
  return lines[1];
}

describe("the empty-queue diagnosis", () => {
  it("says plainly when nothing has ever been launched", () => {
    expect(explainEmptyQueue([], SUPPORTED)[0]).toContain("repository's newest bounded diagnostic sample");
    expect(explainEmptyQueue([], SUPPORTED, "g-target")[0]).toContain(
      "target graph g-target was not found in this repository scope",
    );
  });

  it.each([
    [{ repository_scope_matches: false }, "active primary repository"],
    [{ required_check_policy_matches: false }, "required-check policy differs"],
    [{ phase1c_resume_ready: false }, "pull-request bridge evidence"],
  ] as const)("reports the protocol-v2 scope filter %#", (overrides, expected) => {
    expect(reasonOf(explainEmptyQueue([graph(overrides)], SUPPORTED))).toContain(expected);
  });

  it("names owner approval first, because no worker can ever get past it", () => {
    const lines = explainEmptyQueue([graph({ requires_owner_approval: true })], SUPPORTED);
    expect(reasonOf(lines)).toContain("owner approval");
  });

  it("names the executors the worker does not declare", () => {
    const lines = explainEmptyQueue(
      [graph({ graph_nodes: [{ executor: "MODEL" }, { executor: "TELEPORT" }] })],
      SUPPORTED,
    );
    expect(reasonOf(lines)).toContain("TELEPORT");
    expect(reasonOf(lines)).not.toContain("MODEL,");
  });

  it("reports retirement by failures and by total runs", () => {
    const failed = { state: "FAILED", completed_at: "2026-08-23T20:10:00Z" };
    expect(
      reasonOf(explainEmptyQueue([graph({ graph_runs: [failed, failed, failed] })], SUPPORTED)),
    ).toContain("3 failed runs");

    const cancelled = { state: "CANCELLED", completed_at: "2026-08-23T20:10:00Z" };
    expect(
      reasonOf(explainEmptyQueue([graph({ graph_runs: Array(10).fill(cancelled) })], SUPPORTED)),
    ).toContain("10 runs");
  });

  it("treats a finished non-lifecycle run as the answer it is", () => {
    const lines = explainEmptyQueue(
      [graph({ graph_runs: [{ state: "PARTIAL", completed_at: "2026-08-23T21:00:00Z" }] })],
      SUPPORTED,
    );
    expect(reasonOf(lines)).toContain("already answered");
    expect(reasonOf(lines)).toContain("PARTIAL");
  });

  it("distinguishes a lifecycle waiting at an open gate from one waiting for a worker", () => {
    const halted = graph({
      is_lifecycle: true,
      graph_runs: [{ state: "PARTIAL", completed_at: "2026-08-23T21:00:00Z" }],
      graph_gates: [{ state: "OPEN", opened_at: "2026-08-23T20:59:00Z", decided_at: null }],
    });
    expect(reasonOf(explainEmptyQueue([halted], SUPPORTED))).toContain("waiting for a decision");
  });

  it("calls out the contradiction when a fresh gate approval should have reopened a lifecycle", () => {
    const reopened = graph({
      is_lifecycle: true,
      graph_runs: [{ state: "PARTIAL", completed_at: "2026-08-23T21:00:00Z" }],
      graph_gates: [
        { state: "APPROVED", opened_at: "2026-08-23T20:59:00Z", decided_at: "2026-08-23T21:30:00Z" },
      ],
    });
    expect(reasonOf(explainEmptyQueue([reopened], SUPPORTED))).toContain("contradicts");
  });

  it("keeps an approval fresh across a run that answered nothing", () => {
    // Live graph d7241cf4: halt (PARTIAL) → approval → capacity-voided run
    // (CANCELLED, closed after the approval). The void answers nothing, so
    // the approval still reopens the lifecycle.
    const voided = graph({
      is_lifecycle: true,
      graph_runs: [
        { state: "PARTIAL", completed_at: "2026-08-23T21:00:00Z" },
        { state: "CANCELLED", completed_at: "2026-08-23T22:00:00Z" },
      ],
      graph_gates: [
        { state: "APPROVED", opened_at: "2026-08-23T20:59:00Z", decided_at: "2026-08-23T21:30:00Z" },
      ],
    });
    expect(reasonOf(explainEmptyQueue([voided], SUPPORTED))).toContain("contradicts");
  });

  it("calls out the contradiction for a graph nothing excludes", () => {
    expect(reasonOf(explainEmptyQueue([graph({})], SUPPORTED))).toContain("contradicts");
  });

  it("names withdrawal instead of accusing the claim (20260831001100)", () => {
    const reason = reasonOf(explainEmptyQueue(
      [graph({ withdrawn_at: "2026-08-30T10:00:00Z" })], SUPPORTED));
    expect(reason).toContain("withdrawn by a member at 2026-08-30T10:00:00Z");
    expect(reason).not.toContain("contradicts");
  });

  it("names a requested pause as waiting for a resume, not a worker", () => {
    const reason = reasonOf(explainEmptyQueue(
      [graph({ pause_requested_at: "2026-08-30T11:00:00Z" })], SUPPORTED));
    expect(reason).toContain("waiting for a resume, not a worker");
    expect(reason).not.toContain("contradicts");
  });

  it("lets withdrawal outrank pause when both are set — withdrawn is final", () => {
    const reason = reasonOf(explainEmptyQueue(
      [graph({
        withdrawn_at: "2026-08-30T10:00:00Z",
        pause_requested_at: "2026-08-30T09:00:00Z",
      })], SUPPORTED));
    expect(reason).toContain("never be claimed");
  });

  it("never prints goal text, only ids and states", () => {
    const lines = explainEmptyQueue(
      [graph({ id: "aaaa-bbbb", requires_owner_approval: true })],
      SUPPORTED,
    );
    // The row type carries no goal field at all; the line is id + reason.
    expect(lines[1]).toContain("aaaa-bbbb");
  });
});
