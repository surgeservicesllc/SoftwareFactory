/**
 * The zero-token cost policy.
 *
 * SoftwareFactory must be able to run without a funded OpenAI or Anthropic API
 * account and without incurring per-token charges. That is a hard operating
 * constraint, not a preference, so it is enforced in code rather than left to
 * whoever is configuring the environment.
 *
 * The failure this exists to prevent is specific and easy to commit by
 * accident: an agent hits a blocker, notices that setting an API key would
 * clear it, and sets one. The result is a system that quietly bills per token
 * while everyone believes it does not. So the check is not "is a key present"
 * but "is this execution path allowed to spend", and the default answer is no.
 *
 * **A subscription is not the same thing as API billing.** A ChatGPT or Codex
 * subscription is a flat product entitlement; the OpenAI API is metered per
 * token. This module blocks the second. It makes no claim that the first is
 * free — only that SoftwareFactory itself is not the thing buying tokens.
 */

/** Execution mechanisms, classified by whether SoftwareFactory pays per token. */
export const EXECUTION_MECHANISMS = [
  /** Deterministic TypeScript. No model, no spend. */
  "DETERMINISTIC",
  /** A work package handed to a subscription-authenticated Codex session. */
  "CODEX_HANDOFF",
  /** GitHub Actions, GitHub App, Supabase, Vercel. Not AI, not per-token. */
  "PLATFORM_AUTOMATION",
  /** A metered provider API call billed per token. */
  "METERED_API",
] as const;
export type ExecutionMechanism = (typeof EXECUTION_MECHANISMS)[number];

/** Mechanisms that bill SoftwareFactory per token. */
const METERED: readonly ExecutionMechanism[] = ["METERED_API"];

/**
 * Environment variables whose presence indicates a metered provider path.
 *
 * Named explicitly rather than pattern-matched on "KEY": the point is to
 * recognise the specific credentials that unlock per-token billing, and a
 * pattern would both miss renames and catch unrelated secrets.
 */
export const METERED_CREDENTIAL_NAMES = [
  "OPENAI_API_KEY",
  "SOFTWAREFACTORY_OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "SOFTWAREFACTORY_ANTHROPIC_API_KEY",
  "CODEX_API_KEY",
] as const;

export class CostPolicyViolationError extends Error {
  readonly code = "paid_ai_api_blocked";

  constructor(
    readonly mechanism: ExecutionMechanism,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "CostPolicyViolationError";
  }
}

export type CostPolicy = {
  /** Whether metered provider calls are permitted at all. */
  readonly paidApiCallsAllowed: boolean;
  readonly reason: string;
};

/**
 * Read the policy from the environment.
 *
 * Fails closed in the strong sense: anything other than the exact string
 * `"true"` leaves paid calls disallowed. An unset variable, a typo, an empty
 * string and `"TRUE"` all mean no — because the expensive mistake is reading an
 * ambiguous value as permission.
 */
export function readCostPolicy(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CostPolicy {
  const raw = environment.PAID_AI_API_CALLS_ALLOWED;
  if (raw === "true") {
    return {
      paidApiCallsAllowed: true,
      reason:
        "PAID_AI_API_CALLS_ALLOWED is explicitly true, so metered provider calls are permitted.",
    };
  }

  return {
    paidApiCallsAllowed: false,
    reason:
      raw === undefined
        ? "PAID_AI_API_CALLS_ALLOWED is unset, so metered provider calls are refused."
        : `PAID_AI_API_CALLS_ALLOWED is ${JSON.stringify(raw)} rather than "true", so metered provider calls are refused.`,
  };
}

export type CostAssessment = {
  readonly allowed: boolean;
  readonly mechanism: ExecutionMechanism;
  readonly metered: boolean;
  readonly detail: string;
};

/** Would this mechanism bill SoftwareFactory per token? */
export function isMetered(mechanism: ExecutionMechanism): boolean {
  return METERED.includes(mechanism);
}

/**
 * Decide whether a mechanism may run under the policy.
 *
 * Returns an assessment rather than throwing, so a caller can record the
 * refusal as evidence before acting on it. `assertExecutionAllowed` is the
 * throwing form for the places that must simply stop.
 */
export function assessExecution(
  mechanism: ExecutionMechanism,
  policy: CostPolicy = readCostPolicy(),
): CostAssessment {
  const metered = isMetered(mechanism);

  if (!metered) {
    return {
      allowed: true,
      mechanism,
      metered: false,
      detail: `${mechanism} does not bill per token, so the cost policy does not restrict it.`,
    };
  }

  if (policy.paidApiCallsAllowed) {
    return {
      allowed: true,
      mechanism,
      metered: true,
      detail: `${mechanism} bills per token and the policy explicitly permits it.`,
    };
  }

  return {
    allowed: false,
    mechanism,
    metered: true,
    detail:
      `${mechanism} bills per token and is refused. ${policy.reason} ` +
      "Use CODEX_HANDOFF or DETERMINISTIC execution instead of enabling metered calls.",
  };
}

/** Stop outright when a metered path is attempted under a zero-token policy. */
export function assertExecutionAllowed(
  mechanism: ExecutionMechanism,
  policy: CostPolicy = readCostPolicy(),
): void {
  const assessment = assessExecution(mechanism, policy);
  if (!assessment.allowed) {
    throw new CostPolicyViolationError(mechanism, assessment.detail);
  }
}

/**
 * Metered credentials visible in an environment.
 *
 * Reported by *name only* — never the value — so the zero-cost status surface
 * can say "a metered credential is configured" without becoming a place
 * secrets leak. A present credential is not itself a violation: it becomes one
 * only when something tries to spend against it.
 */
export function meteredCredentialsPresent(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): readonly string[] {
  return METERED_CREDENTIAL_NAMES.filter((name) => {
    const value = environment[name];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export type ZeroCostStatus = {
  readonly zeroCostEnforced: boolean;
  /** Names only. Never values. */
  readonly meteredCredentialsConfigured: readonly string[];
  readonly summary: string;
};

/**
 * What to show an owner in Settings and Connections.
 *
 * Deliberately distinguishes three states rather than two, because "no key is
 * set" and "a key is set but nothing may spend it" have different follow-ups
 * and collapsing them would hide a real configuration.
 */
export function zeroCostStatus(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ZeroCostStatus {
  const policy = readCostPolicy(environment);
  const configured = meteredCredentialsPresent(environment);

  if (!policy.paidApiCallsAllowed && configured.length === 0) {
    return {
      zeroCostEnforced: true,
      meteredCredentialsConfigured: [],
      summary:
        "Zero AI API cost enforced. No metered provider credential is configured and metered calls are refused.",
    };
  }

  if (!policy.paidApiCallsAllowed) {
    return {
      zeroCostEnforced: true,
      meteredCredentialsConfigured: configured,
      summary:
        `Zero AI API cost enforced, but ${configured.length} metered credential(s) are configured ` +
        `(${configured.join(", ")}). Nothing may spend against them while the policy refuses metered calls, ` +
        "and they should be removed if they are not needed for another purpose.",
    };
  }

  return {
    zeroCostEnforced: false,
    meteredCredentialsConfigured: configured,
    summary:
      "Metered provider calls are explicitly permitted, so SoftwareFactory may incur per-token charges.",
  };
}
