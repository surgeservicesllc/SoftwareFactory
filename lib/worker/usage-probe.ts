import { createClient } from "@supabase/supabase-js";

import { openSecret } from "@/lib/security/secret-box-core";

/**
 * The usage side of the auth-broker sweep: for every connected subscription
 * account, ask the provider how much of the plan's rate windows are used and
 * record the answer — or the named failure — as append-only evidence.
 *
 * Truthfulness rules, matching the rest of the repository:
 *
 *  - A number is stored only when the provider returned it. A probe that
 *    fails records `unavailable` with a bounded human reason; a provider we
 *    have no proven endpoint for records `unsupported`. The console renders
 *    exactly what is recorded, so "no data" is visible instead of silent.
 *  - The probe never demotes an account. Connectivity verdicts belong to the
 *    verification sweep and to real use; a usage endpoint refusing a token is
 *    recorded as an unavailable *observation*, not treated as proof the
 *    credential is dead.
 *  - Plaintext credentials exist only inside `captureUsageForAccounts`, the
 *    same containment `verifyStoredAccounts` keeps. Nothing the provider
 *    responds with is persisted beyond the allowlisted numeric windows and a
 *    sanitized reason string.
 */

export type UsageWindow = Readonly<{
  window_key: string;
  label: string;
  used_percent: number;
  resets_at?: string | null;
}>;

export type UsageProbeResult = Readonly<{
  status: "measured" | "unavailable" | "unsupported";
  windows: readonly UsageWindow[];
  detail?: string;
}>;

/** Bounded, secret-free failure text; the database shape-checks it again. */
function reason(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 380);
}

function clampPercent(value: number): number {
  const bounded = Math.min(100, Math.max(0, value));
  return Math.round(bounded * 10) / 10;
}

function readResetsAt(candidate: unknown): string | null {
  if (typeof candidate === "string" && candidate.length > 0 && candidate.length <= 64) {
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
    // Seconds-since-epoch is the other shape rate-limit APIs use.
    const parsed = new Date(candidate < 10_000_000_000 ? candidate * 1000 : candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

/**
 * The window vocabulary this probe understands from the Claude subscription
 * usage payload, in display order. Unknown keys in the payload are ignored
 * rather than guessed at.
 */
const ANTHROPIC_WINDOWS: ReadonlyArray<Readonly<{ payloadKey: string; key: string; label: string }>> = [
  { payloadKey: "five_hour", key: "session_5h", label: "Session (5h)" },
  { payloadKey: "seven_day", key: "week_all_models", label: "Week (all models)" },
  { payloadKey: "seven_day_opus", key: "week_opus", label: "Week (Opus)" },
  { payloadKey: "seven_day_sonnet", key: "week_sonnet", label: "Week (Sonnet)" },
];

/**
 * Reads the Claude subscription usage payload into bounded windows. Shape
 * observed from the OAuth usage endpoint the Claude Code client itself polls:
 * top-level window objects carrying a 0-100 `utilization` and a reset
 * timestamp. Anything else is `unavailable`, never a guessed number.
 */
export function parseAnthropicUsage(payload: unknown): UsageProbeResult {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      status: "unavailable",
      windows: [],
      detail: reason("The provider returned an unrecognized usage payload."),
    };
  }
  const record = payload as Record<string, unknown>;
  const windows: UsageWindow[] = [];

  for (const mapping of ANTHROPIC_WINDOWS) {
    const candidate = record[mapping.payloadKey];
    if (candidate === null || candidate === undefined) continue;
    if (typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const windowRecord = candidate as Record<string, unknown>;
    const utilization = windowRecord.utilization;
    if (typeof utilization !== "number" || !Number.isFinite(utilization)) continue;
    windows.push({
      window_key: mapping.key,
      label: mapping.label,
      used_percent: clampPercent(utilization),
      resets_at: readResetsAt(windowRecord.resets_at),
    });
  }

  if (windows.length === 0) {
    return {
      status: "unavailable",
      windows: [],
      detail: reason("The provider's usage payload carried no recognizable windows."),
    };
  }
  return { status: "measured", windows };
}

/** The endpoint the Claude Code client polls for subscription usage. */
const ANTHROPIC_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const PROBE_TIMEOUT_MS = 15_000;

export async function probeAnthropicUsage(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UsageProbeResult> {
  let response: Response;
  try {
    response = await fetchImpl(ANTHROPIC_USAGE_URL, {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        accept: "application/json",
      },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    return {
      status: "unavailable",
      windows: [],
      detail: reason("The usage endpoint could not be reached."),
    };
  }

  if (!response.ok) {
    // The status class only — nothing the provider said travels further.
    return {
      status: "unavailable",
      windows: [],
      detail: reason(
        response.status === 401 || response.status === 403
          ? `The provider refused the stored credential (HTTP ${response.status}).`
          : `The usage endpoint answered HTTP ${response.status}.`,
      ),
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      status: "unavailable",
      windows: [],
      detail: reason("The usage endpoint did not return JSON."),
    };
  }
  return parseAnthropicUsage(payload);
}

/**
 * Routes one account's credential to its provider's probe. OpenAI/Codex
 * subscriptions have no proven usage endpoint in this repository yet; saying
 * so durably is the truthful alternative to inventing one.
 */
export async function probeAccountUsage(
  provider: string,
  plaintextCredential: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UsageProbeResult> {
  if (provider === "anthropic") {
    return probeAnthropicUsage(plaintextCredential.trim(), fetchImpl);
  }
  return {
    status: "unsupported",
    windows: [],
    detail: reason(
      "No proven usage endpoint exists for this provider's subscription accounts yet.",
    ),
  };
}

// ---------------------------------------------------------------------------
// Capture sweep
// ---------------------------------------------------------------------------

/** The slice of the auth-broker store the capture sweep needs. */
export type UsageCaptureSource = Readonly<{
  listAccountsForVerification: () => Promise<ReadonlyArray<Readonly<{
    organizationId: string;
    accountId: string;
    provider: string;
    purpose: string;
  }>>>;
  readStoredCredential: (organizationId: string, purpose: string) => Promise<string | null>;
}>;

export type UsageRecorder = Readonly<{
  recordUsage: (input: Readonly<{
    organizationId: string;
    accountId: string;
    status: UsageProbeResult["status"];
    windows: readonly UsageWindow[];
    detail?: string;
  }>) => Promise<void>;
}>;

type SupabaseRpc = {
  rpc: (fn: string, args?: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export class SupabaseUsageRecorder implements UsageRecorder {
  private constructor(private readonly client: SupabaseRpc) {}

  static create(input: { url: string; serviceRoleKey: string }) {
    return new SupabaseUsageRecorder(createClient(input.url, input.serviceRoleKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    }));
  }

  static forClient(client: SupabaseRpc) {
    return new SupabaseUsageRecorder(client);
  }

  recordUsage = async (input: Parameters<UsageRecorder["recordUsage"]>[0]): Promise<void> => {
    const { error } = await this.client.rpc("record_ai_account_usage", {
      p_organization_id: input.organizationId,
      p_ai_account_id: input.accountId,
      p_status: input.status,
      p_windows: input.windows,
      p_detail: input.detail ?? null,
    });
    if (error) {
      // The code (never the message) names the failure class in the run log —
      // a database that predates the usage migration reads PGRST202.
      throw new Error(
        `Recording the usage observation failed (${(error as { code?: string }).code ?? "unknown"}).`,
      );
    }
  };
}

export type UsageCaptureResult = Readonly<{
  measured: number;
  unavailable: number;
  unsupported: number;
  errors: number;
}>;

/**
 * One capture pass over every connected subscription account. Never throws
 * for a single account: each account's outcome is recorded (or counted as an
 * error) independently, so one refused token cannot hide another account's
 * numbers.
 */
export async function captureUsageForAccounts(
  source: UsageCaptureSource,
  recorder: UsageRecorder,
  options?: Readonly<{
    fetchImpl?: typeof fetch;
    open?: (sealed: string, context: { organizationId: string; purpose: string }) => string;
  }>,
): Promise<UsageCaptureResult> {
  const open = options?.open
    ?? ((sealed: string, context: { organizationId: string; purpose: string }) =>
      openSecret(sealed, context));
  let measured = 0;
  let unavailable = 0;
  let unsupported = 0;
  let errors = 0;

  for (const account of await source.listAccountsForVerification()) {
    try {
      let result: UsageProbeResult;
      const sealed = await source.readStoredCredential(account.organizationId, account.purpose);
      if (!sealed) {
        result = {
          status: "unavailable",
          windows: [],
          detail: "No stored credential exists to probe usage with.",
        };
      } else {
        let plaintext: string | null = null;
        try {
          plaintext = open(sealed, {
            organizationId: account.organizationId,
            purpose: account.purpose,
          });
        } catch {
          // Recorded below as an unavailable observation; the verification
          // sweep owns demotion for an unopenable seal.
        }
        result = plaintext === null
          ? {
            status: "unavailable",
            windows: [],
            detail: "The stored credential could not be opened for a usage probe.",
          }
          : await probeAccountUsage(account.provider, plaintext, options?.fetchImpl ?? fetch);
      }

      await recorder.recordUsage({
        organizationId: account.organizationId,
        accountId: account.accountId,
        status: result.status,
        windows: result.windows,
        detail: result.detail,
      });
      if (result.status === "measured") measured += 1;
      else if (result.status === "unavailable") unavailable += 1;
      else unsupported += 1;
    } catch {
      errors += 1;
    }
  }

  return { measured, unavailable, unsupported, errors };
}
