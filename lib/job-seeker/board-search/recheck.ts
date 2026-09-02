import "server-only";

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

import { USER_AGENT } from "@/lib/job-seeker/board-search/http";
import { htmlToText } from "@/lib/job-seeker/import-adapters";

/**
 * Still open? (ADR-249): one bounded read of a posting's own URL, on a
 * person's request, answering whether the page is still there and whether
 * it says the position is closed. The answer is derived from the HTTP
 * status and a fixed list of closure phrases; the page itself is read up
 * to a cap and never stored.
 *
 * ## Owner-safe by construction
 *
 * A server that fetches a URL a browser supplied is a request forger
 * unless it refuses everything but the public web. So: https only, no
 * credentials or port in the URL, a real hostname rather than an address,
 * no local or internal names, and the name must resolve to public
 * addresses only — every address, not just the first — before a byte is
 * sent. Redirects are not followed (a redirect to a private address is
 * the classic bypass); a 3xx is reported as "moved" and left there.
 */

export const RECHECK_TIMEOUT_MS = 6_000;
export const RECHECK_MAX_BODY_BYTES = 262_144;
/** A check under this age is reused rather than repeated. */
export const RECHECK_REUSE_MINUTES = 10;

export type RecheckStatus = "open" | "gone" | "moved" | "blocked" | "unreachable";

export type RecheckOutcome = Readonly<{
  status: RecheckStatus;
  httpStatus: number | null;
  /** One sentence naming the status and, for a closed page, the phrase. */
  note: string;
}>;

export class RecheckRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecheckRefusedError";
  }
}

export const CLOSED_PHRASES: readonly string[] = [
  "no longer accepting applications",
  "no longer available",
  "this job has expired",
  "this posting has expired",
  "job has been closed",
  "this position has been filled",
  "position is no longer open",
  "this job is closed",
  "applications are closed",
  "this vacancy has closed",
  "ansøgningsfristen er udløbet",
  "stillingen er besat",
];

const LOCAL_NAME = /(^|\.)(localhost|local|internal|localdomain|home|lan|corp|intranet|arpa|test|example|invalid)$/i;

/** Why a URL may not be fetched, or null when it may. */
export function refuseUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "The URL could not be parsed.";
  }
  if (url.protocol !== "https:") return "Only https URLs are rechecked.";
  if (url.username || url.password) return "A URL with credentials is not rechecked.";
  if (url.port && url.port !== "443") return "A URL with a port is not rechecked.";
  const host = url.hostname.replace(/\.$/, "").toLowerCase();
  if (host.length === 0) return "The URL has no host.";
  if (isIP(host.replace(/^\[|\]$/g, "")) !== 0) return "A URL that names an address rather than a host is not rechecked.";
  if (!host.includes(".")) return "A single-label host is not rechecked.";
  if (LOCAL_NAME.test(host)) return "A local or internal host is not rechecked.";
  return null;
}

function v4Parts(address: string): number[] | null {
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}

/** True only for an address on the public internet. */
export function isPublicAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) {
    const parts = v4Parts(address);
    if (parts === null) return false;
    const [a, b] = parts as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a >= 224) return false;
    return true;
  }
  if (kind === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (lower === "::" || lower === "::1") return false;
    if (/^f[cd]/.test(lower)) return false; // fc00::/7 unique local
    if (/^fe[89ab]/.test(lower)) return false; // fe80::/10 link local
    if (/^ff/.test(lower)) return false; // multicast
    if (lower.startsWith("2001:db8")) return false; // documentation
    return true;
  }
  return false;
}

export type RecheckDependencies = Readonly<{
  fetchImpl?: typeof fetch;
  lookup?: (host: string) => Promise<ReadonlyArray<{ address: string }>>;
}>;

const defaultLookup = async (host: string) => dnsLookup(host, { all: true });

async function readBounded(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < RECHECK_MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.byteLength;
  }
  try {
    await reader.cancel();
  } catch {
    // The stream is finished with either way.
  }
  const joined = new Uint8Array(Math.min(total, RECHECK_MAX_BODY_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.subarray(0, Math.max(0, joined.length - offset));
    joined.set(slice, offset);
    offset += slice.length;
    if (offset >= joined.length) break;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(joined);
}

export function classifyPage(httpStatus: number, text: string): RecheckOutcome {
  if (httpStatus === 404 || httpStatus === 410) {
    return { status: "gone", httpStatus, note: `HTTP ${httpStatus} — the page is gone.` };
  }
  if (httpStatus >= 300 && httpStatus < 400) {
    return {
      status: "moved",
      httpStatus,
      note: `HTTP ${httpStatus} — the posting redirected elsewhere; boards often redirect an expired posting to a search page.`,
    };
  }
  if (httpStatus >= 200 && httpStatus < 300) {
    const lower = text.toLowerCase();
    const phrase = CLOSED_PHRASES.find((candidate) => lower.includes(candidate));
    if (phrase !== undefined) {
      return { status: "gone", httpStatus, note: `HTTP ${httpStatus} — the page says “${phrase}”.` };
    }
    return { status: "open", httpStatus, note: `HTTP ${httpStatus} — the page is up and does not say the position is closed.` };
  }
  return {
    status: "blocked",
    httpStatus,
    note: `HTTP ${httpStatus} — the site refused an automated read; that says nothing about the posting.`,
  };
}

/**
 * Fetch the URL once, within the bounds above, and classify the answer.
 * Throws RecheckRefusedError before any byte is sent when the URL or its
 * addresses are not the public web.
 */
export async function recheckPosting(raw: string, deps: RecheckDependencies = {}): Promise<RecheckOutcome> {
  const refusal = refuseUrl(raw);
  if (refusal !== null) throw new RecheckRefusedError(refusal);
  const url = new URL(raw);
  const lookup = deps.lookup ?? defaultLookup;
  let addresses: ReadonlyArray<{ address: string }>;
  try {
    addresses = await lookup(url.hostname);
  } catch {
    return { status: "unreachable", httpStatus: null, note: "The host could not be resolved." };
  }
  if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw new RecheckRefusedError("The host does not resolve to a public address, so it is not rechecked.");
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RECHECK_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" },
    });
    const text = response.status >= 200 && response.status < 300 ? htmlToText(await readBounded(response)) : "";
    return classifyPage(response.status, text);
  } catch {
    return { status: "unreachable", httpStatus: null, note: `The site did not answer within ${RECHECK_TIMEOUT_MS / 1000} seconds.` };
  } finally {
    clearTimeout(timer);
  }
}
