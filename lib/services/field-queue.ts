/**
 * The offline write queue for the technician field app.
 *
 * This module is deliberately storage-agnostic and free of network calls:
 * it is the DECISION layer, and the decisions are the part where a bug
 * costs somebody a visit that never got recorded. Kept pure, it can be
 * tested directly rather than through a service worker and a fake browser.
 *
 * The contract it exists to keep:
 *
 *   1. A write is never removed from the queue until the SERVER confirms
 *      it. Not on optimistic success, not on a 2xx the client guessed at.
 *   2. A write's token is minted once, before the first attempt, and never
 *      changes. Retrying with a fresh token is how a queue turns one visit
 *      into six.
 *   3. A permanent refusal stops being retried, and stays visible. A queue
 *      that retries a refusal forever never drains, and one that silently
 *      discards it loses the work.
 *   4. The technician is never shown "saved" for something still queued.
 */

import type { CrmFieldSubmissionKind, FieldQueueState } from "@/lib/services/crm";

export type QueuedWrite = {
  clientToken: string;
  kind: CrmFieldSubmissionKind;
  /** The technician's own clock, at the moment they acted. */
  occurredAt: string;
  body: Record<string, unknown>;
  state: FieldQueueState;
  attempts: number;
  /** Set only once the server has confirmed. */
  settledAt: string | null;
  /** Why it will never be retried, when that is the case. */
  refusedReason: string | null;
};

/** Retry backoff in seconds, by attempt count. The last value repeats. */
const BACKOFF_SECONDS = [0, 5, 15, 60, 300, 900] as const;

export function backoffFor(attempts: number): number {
  const index = Math.min(Math.max(attempts, 0), BACKOFF_SECONDS.length - 1);
  return BACKOFF_SECONDS[index];
}

export function newWrite(
  kind: CrmFieldSubmissionKind,
  body: Record<string, unknown>,
  token: string,
  occurredAt: string,
): QueuedWrite {
  return {
    clientToken: token,
    kind,
    occurredAt,
    body,
    state: "queued",
    attempts: 0,
    settledAt: null,
    refusedReason: null,
  };
}

export type SubmitOutcome =
  | { settled: true; replayed: boolean }
  | { settled: false; permanent: true; reason: string }
  | { settled: false; permanent: false };

/**
 * Fold one attempt's outcome into the write.
 *
 * A REPLAY settles it exactly as a fresh write does. That is the whole
 * point of the token: the server telling us "already had this" is
 * confirmation, not an error, and treating it as failure would leave the
 * write queued forever.
 */
export function applyOutcome(write: QueuedWrite, outcome: SubmitOutcome, at: string): QueuedWrite {
  if (outcome.settled) {
    return { ...write, state: "settled", settledAt: at, attempts: write.attempts + 1 };
  }
  if (outcome.permanent) {
    /*
     * Refused for good — a job that is not on this account, a malformed
     * body, a device clock in the future. It stops being retried but is
     * NOT removed: the technician has to see that this one did not go, or
     * the work is silently lost.
     */
    return {
      ...write,
      state: "refused",
      refusedReason: outcome.reason,
      attempts: write.attempts + 1,
    };
  }
  return { ...write, state: "queued", attempts: write.attempts + 1 };
}

/** Writes that should be attempted now, oldest first. */
export function dueWrites(queue: readonly QueuedWrite[]): QueuedWrite[] {
  return queue
    .filter((write) => write.state === "queued" || write.state === "sending")
    .slice()
    .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
}

/**
 * What the technician is shown.
 *
 * `unsent` counts everything the server has not confirmed, INCLUDING
 * refusals. A refused write is not sent, and folding it out of this number
 * to make the badge read zero would be the exact lie this queue exists to
 * prevent.
 */
export function queueSummary(queue: readonly QueuedWrite[]) {
  const queued = queue.filter((write) => write.state === "queued" || write.state === "sending");
  const refused = queue.filter((write) => write.state === "refused");
  const settled = queue.filter((write) => write.state === "settled");
  return {
    unsent: queued.length + refused.length,
    waiting: queued.length,
    refused: refused.length,
    settled: settled.length,
    /* The oldest thing still owed, so the page can say "since 09:12"
     * rather than a count with no shape to it. */
    oldestUnsentAt:
      [...queued, ...refused]
        .map((write) => write.occurredAt)
        .sort()[0] ?? null,
  };
}

/**
 * Reconcile the device's queue against the server's answer.
 *
 * The server is the authority. A write the device thinks is queued but the
 * server already has is settled — that is the tunnel case, where the
 * request arrived and the response never came back. Resolving it the other
 * way (trusting the device) is what produces a duplicate.
 */
export function reconcile(
  queue: readonly QueuedWrite[],
  settledTokens: readonly string[],
  at: string,
): QueuedWrite[] {
  const settled = new Set(settledTokens);
  return queue.map((write) =>
    settled.has(write.clientToken) && write.state !== "settled"
      ? { ...write, state: "settled" as const, settledAt: at, refusedReason: null }
      : write,
  );
}

/**
 * What may be dropped from storage.
 *
 * Only settled writes, and only after a grace period — long enough that a
 * technician can still see "sent" for the work they just did rather than
 * watching it vanish. Nothing unsent is ever pruned, whatever its age.
 */
export function prunable(
  queue: readonly QueuedWrite[],
  now: number,
  graceSeconds = 86_400,
): QueuedWrite[] {
  return queue.filter(
    (write) =>
      write.state === "settled" &&
      write.settledAt !== null &&
      now - Date.parse(write.settledAt) > graceSeconds * 1000,
  );
}
