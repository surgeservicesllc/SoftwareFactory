/**
 * What a one-shot worker invocation actually did, in one line.
 *
 * The Codex worker used to end its log at "is ready." A green job that claimed
 * a run and a green job that found nothing to claim were indistinguishable
 * without querying the database, which is the shape of green that teaches a
 * reader to trust a job that did no work.
 */
export function describeClaimOutcome(processed: number): string {
  if (processed === 0) return "No claimable run was available; nothing was executed.";
  const runs = processed === 1 ? "run" : "runs";
  // "finished", not "succeeded": a claimed run that failed is still a run this
  // worker took to a terminal state, and the run record carries which one.
  return `Claimed and finished ${processed} durable ${runs}; see the run record for the terminal state.`;
}
