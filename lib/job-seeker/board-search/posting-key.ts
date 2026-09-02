import { createHash } from "node:crypto";

/**
 * The exact key the sightings ledger uses: md5 of the URL as the board
 * returned it, trimmed (ADR-241). Server-only by construction — it imports
 * node:crypto — and kept apart from the pure freshness evaluator so the
 * browser bundle can render verdicts without carrying a hash library.
 */
export function postingUrlKey(url: string): string {
  return createHash("md5").update(url.trim()).digest("hex");
}
