import type { ProductionSignalKind } from "@/lib/operations/types";

/**
 * Deduplication identity for a production signal.
 *
 * The same failing thing must fold into one incident no matter how many times
 * it is observed. The fingerprint therefore describes *what is broken*, never
 * *when it was seen* — including a timestamp or an observation id here would
 * silently reintroduce incident storms.
 */

export interface FingerprintInput {
  readonly signalKind: ProductionSignalKind;
  /** Stable identity of the failing check, usually the monitor id. */
  readonly subject: string;
  /** Optional narrower discriminator, e.g. an HTTP status class or route. */
  readonly detail?: string | null;
}

const MAX_FINGERPRINT_LENGTH = 128;

function normalizeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Produce a fingerprint matching the database's
 * `^[a-z0-9]([a-z0-9:._-]{6,126})[a-z0-9]$` constraint, or null when the input
 * cannot form a stable identity. A null fingerprint must never be treated as
 * "no duplicate" — the caller should refuse to auto-create the incident.
 */
export function buildIncidentFingerprint(input: FingerprintInput): string | null {
  const subject = normalizeSegment(input.subject);
  if (!subject) return null;

  const detail = input.detail ? normalizeSegment(input.detail) : "";
  const parts = [normalizeSegment(input.signalKind), subject, detail].filter(Boolean);
  const candidate = parts.join(":").slice(0, MAX_FINGERPRINT_LENGTH);

  // The database requires alphanumeric boundaries at both ends.
  const trimmed = candidate.replace(/^[^a-z0-9]+/, "").replace(/[^a-z0-9]+$/, "");
  if (trimmed.length < 8) return null;

  return trimmed;
}

/** Stable dedupe key for the durable event queue. */
export function buildEventDedupeKey(
  eventType: string,
  entityId: string,
  discriminator?: string | number | null,
): string {
  const parts = [eventType, entityId];
  if (discriminator !== undefined && discriminator !== null) {
    parts.push(String(discriminator));
  }
  return parts.join(":").slice(0, 200);
}
