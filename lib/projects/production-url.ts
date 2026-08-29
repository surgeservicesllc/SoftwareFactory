import { validateMonitorTarget } from "@/lib/operations/target";

/**
 * A project's production URL is the public address the lifecycle monitor
 * observes after an exact deployment. It is configuration, not a credential
 * carrier or a general-purpose request URL.
 */

export const MAX_PROJECT_PRODUCTION_URL_LENGTH = 208;

export type ProjectProductionUrlValidation = Readonly<{
  error: string | null;
  productionUrl: string | null;
}>;

const INVALID_PRODUCTION_URL_MESSAGE =
  "Use a public HTTPS URL without credentials, query parameters, fragments, private hosts, localhost, or non-standard ports.";

function isAdditionalReservedIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => !Number.isInteger(octet))) return false;
  const [first, second] = octets as [number, number, number, number];
  return (first === 198 && (second === 18 || second === 19)) || first >= 224;
}

export function normalizeProjectProductionUrl(
  rawValue: string | null | undefined,
): ProjectProductionUrlValidation {
  const candidate = rawValue?.trim() ?? "";
  if (!candidate) return { error: null, productionUrl: null };

  // URL.search is empty for a trailing bare `?`, and URL.hash is empty for a
  // trailing bare `#`. Reject the delimiters themselves so those ambiguous
  // spellings cannot enter durable configuration.
  if (candidate.includes("?") || candidate.includes("#")) {
    return { error: INVALID_PRODUCTION_URL_MESSAGE, productionUrl: null };
  }

  const target = validateMonitorTarget(candidate);
  if (!target.valid) {
    return { error: INVALID_PRODUCTION_URL_MESSAGE, productionUrl: null };
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { error: INVALID_PRODUCTION_URL_MESSAGE, productionUrl: null };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname.startsWith("[")
    || !hostname.includes(".")
    || hostname.endsWith(".lan")
    || hostname.endsWith(".home")
    || isAdditionalReservedIpv4(hostname)
  ) {
    return { error: INVALID_PRODUCTION_URL_MESSAGE, productionUrl: null };
  }

  // Durable configuration is canonical and slash-stable. The monitor builds
  // absolute health/auth paths from this value, so a terminal slash has no
  // semantic meaning and should not create two identities for one target.
  const productionUrl = parsed.toString().replace(/\/+$/, "");
  return { error: null, productionUrl };
}
