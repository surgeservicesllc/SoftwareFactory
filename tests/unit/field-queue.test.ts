// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  applyOutcome,
  backoffFor,
  dueWrites,
  newWrite,
  prunable,
  queueSummary,
  reconcile,
  type QueuedWrite,
} from "@/lib/services/field-queue";

/**
 * The offline queue's decisions.
 *
 * Every test here is a way a technician's completed visit could disappear.
 * The queue is the one place in this product where being wrong is silent
 * by default — the tap looked like it worked, the van drove away, and
 * nobody finds out until a customer disputes an invoice.
 */

const at = (iso: string) => iso;
const NOON = "2026-08-31T12:00:00.000Z";

function write(overrides: Partial<QueuedWrite> = {}): QueuedWrite {
  return {
    ...newWrite("complete_work_order", { workOrderId: "w1" }, "t1", "2026-08-31T09:12:00.000Z"),
    ...overrides,
  };
}

describe("the offline field queue", () => {
  it("treats a replay as confirmation, not as failure", () => {
    // The tunnel case: the request arrived, the response did not. The
    // server says "already had this". If the queue read that as an error
    // the write would sit unsent forever while the work was recorded.
    const settled = applyOutcome(write(), { settled: true, replayed: true }, at(NOON));
    expect(settled.state).toBe("settled");
    expect(settled.settledAt).toBe(NOON);
  });

  it("keeps a write queued until the server confirms, never on optimism", () => {
    let entry = write();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      entry = applyOutcome(entry, { settled: false, permanent: false }, at(NOON));
      expect(entry.state).toBe("queued");
      expect(entry.settledAt).toBeNull();
    }
    expect(entry.attempts).toBe(4);
    // And the token never changed across those attempts. A fresh token per
    // retry is how one visit becomes four.
    expect(entry.clientToken).toBe("t1");
  });

  it("stops retrying a permanent refusal but does not hide it", () => {
    const refused = applyOutcome(
      write(),
      { settled: false, permanent: true, reason: "That job is not on this account." },
      at(NOON),
    );
    expect(refused.state).toBe("refused");
    expect(refused.refusedReason).toMatch(/not on this account/);
    // Not retried...
    expect(dueWrites([refused])).toHaveLength(0);
    // ...and NOT counted as sent. Folding a refusal out of `unsent` to
    // make the badge read zero is the exact lie this queue prevents.
    expect(queueSummary([refused]).unsent).toBe(1);
    expect(queueSummary([refused]).refused).toBe(1);
  });

  it("counts everything the server has not confirmed as unsent", () => {
    const summary = queueSummary([
      write({ clientToken: "a", state: "queued", occurredAt: "2026-08-31T09:12:00.000Z" }),
      write({ clientToken: "b", state: "sending", occurredAt: "2026-08-31T10:00:00.000Z" }),
      write({ clientToken: "c", state: "refused", refusedReason: "x", occurredAt: "2026-08-31T08:00:00.000Z" }),
      write({ clientToken: "d", state: "settled", settledAt: NOON }),
    ]);
    expect(summary.unsent).toBe(3);
    expect(summary.waiting).toBe(2);
    expect(summary.refused).toBe(1);
    expect(summary.settled).toBe(1);
    // The oldest thing still owed, so a page can say "since 08:00" rather
    // than only a count.
    expect(summary.oldestUnsentAt).toBe("2026-08-31T08:00:00.000Z");
  });

  it("lets the server settle a write the device still thinks is queued", () => {
    // This is the tunnel again, from the reconcile side. Resolving it the
    // other way — trusting the device over the server — is what produces
    // the duplicate.
    const queue = [
      write({ clientToken: "a", state: "queued" }),
      write({ clientToken: "b", state: "queued" }),
    ];
    const after = reconcile(queue, ["a"], at(NOON));
    expect(after[0].state).toBe("settled");
    expect(after[0].settledAt).toBe(NOON);
    expect(after[1].state).toBe("queued");
  });

  it("clears a refusal when the server turns out to have the write after all", () => {
    // A refusal is the client's reading of one response. If the server
    // later says it holds that token, the server wins and the stale
    // reason must not linger on a settled row.
    const queue = [write({ clientToken: "a", state: "refused", refusedReason: "clock ahead" })];
    const after = reconcile(queue, ["a"], at(NOON));
    expect(after[0].state).toBe("settled");
    expect(after[0].refusedReason).toBeNull();
  });

  it("sends oldest first, so a day's work lands in the order it happened", () => {
    const order = dueWrites([
      write({ clientToken: "late", occurredAt: "2026-08-31T15:00:00.000Z" }),
      write({ clientToken: "early", occurredAt: "2026-08-31T08:00:00.000Z" }),
      write({ clientToken: "mid", occurredAt: "2026-08-31T11:00:00.000Z" }),
      write({ clientToken: "done", state: "settled", occurredAt: "2026-08-31T07:00:00.000Z" }),
    ]);
    expect(order.map((entry) => entry.clientToken)).toEqual(["early", "mid", "late"]);
  });

  it("never prunes anything the server has not confirmed, however old", () => {
    const ancient = "2020-01-01T00:00:00.000Z";
    const now = Date.parse("2026-08-31T12:00:00.000Z");
    const queue = [
      write({ clientToken: "a", state: "queued", occurredAt: ancient }),
      write({ clientToken: "b", state: "refused", refusedReason: "x", occurredAt: ancient }),
      write({ clientToken: "c", state: "settled", settledAt: ancient }),
      write({ clientToken: "d", state: "settled", settledAt: "2026-08-31T11:59:00.000Z" }),
    ];
    const dropped = prunable(queue, now).map((entry) => entry.clientToken);
    // Only the long-settled one. A six-year-old unsent write is still the
    // technician's work and still owed.
    expect(dropped).toEqual(["c"]);
  });

  it("backs off, and stops growing the delay rather than growing it forever", () => {
    expect(backoffFor(0)).toBe(0);
    expect(backoffFor(1)).toBeGreaterThan(0);
    // Monotonic up to the ceiling...
    for (let attempt = 1; attempt < 5; attempt += 1) {
      expect(backoffFor(attempt + 1)).toBeGreaterThanOrEqual(backoffFor(attempt));
    }
    // ...then flat, so a device that has been offline for a day still
    // retries every fifteen minutes rather than once a week.
    expect(backoffFor(50)).toBe(backoffFor(5));
    expect(backoffFor(50)).toBeLessThanOrEqual(900);
  });

  it("mints a token once, at creation, before the first attempt", () => {
    const entry = newWrite("device_scan", { deviceId: "d1" }, "token-1", "2026-08-31T09:12:00.000Z");
    expect(entry.clientToken).toBe("token-1");
    expect(entry.state).toBe("queued");
    expect(entry.attempts).toBe(0);
    expect(entry.settledAt).toBeNull();
    // The technician's clock is carried with the write, not stamped at
    // send time — that is what keeps an offline visit's real moment.
    expect(entry.occurredAt).toBe("2026-08-31T09:12:00.000Z");
  });
});
