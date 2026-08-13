/**
 * Monitor target validation.
 *
 * A monitor makes the server issue an outbound request to an address the
 * operator chose, so the target is validated before any probe runs. Only
 * public HTTPS origins are probeable: loopback, link-local, private ranges,
 * and cloud metadata addresses are rejected so a monitor cannot be used to
 * reach inside the deployment's own network.
 */

export type TargetRejection =
  | "NOT_HTTPS"
  | "INVALID_URL"
  | "CREDENTIALS_IN_URL"
  | "PRIVATE_OR_LOOPBACK_HOST"
  | "NON_STANDARD_PORT"
  | "TOO_LONG";

export interface TargetValidation {
  readonly valid: boolean;
  readonly rejection: TargetRejection | null;
  readonly detail: string;
}

const MAX_TARGET_LENGTH = 208;
const ALLOWED_PORTS = new Set(["", "443"]);

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^\[?::1\]?$/,
  /^\[?fc[0-9a-f]{2}:/i,
  /^\[?fd[0-9a-f]{2}:/i,
  /^\[?fe80:/i,
];

function isBlockedIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;

  const [first, second] = octets as [number, number, number, number];
  if (first === 10) return true;
  if (first === 127) return true;
  if (first === 0) return true;
  if (first === 169 && second === 254) return true; // link-local and cloud metadata
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 100 && second >= 64 && second <= 127) return true; // carrier-grade NAT
  return false;
}

export function validateMonitorTarget(rawUrl: string): TargetValidation {
  if (rawUrl.length > MAX_TARGET_LENGTH) {
    return { valid: false, rejection: "TOO_LONG", detail: "The target URL is too long." };
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { valid: false, rejection: "INVALID_URL", detail: "The target is not a valid URL." };
  }

  if (url.protocol !== "https:") {
    return { valid: false, rejection: "NOT_HTTPS", detail: "Monitors may only probe HTTPS targets." };
  }
  if (url.username || url.password) {
    return {
      valid: false,
      rejection: "CREDENTIALS_IN_URL",
      detail: "Credentials must never appear in a monitor target.",
    };
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    return { valid: false, rejection: "NON_STANDARD_PORT", detail: "Only the standard HTTPS port is probeable." };
  }

  const hostname = url.hostname;
  if (BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(hostname)) || isBlockedIpv4(hostname)) {
    return {
      valid: false,
      rejection: "PRIVATE_OR_LOOPBACK_HOST",
      detail: "Private, loopback, and link-local addresses cannot be probed.",
    };
  }

  return { valid: true, rejection: null, detail: "The target is probeable." };
}
