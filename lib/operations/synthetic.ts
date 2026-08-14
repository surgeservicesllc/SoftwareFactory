import type { SyntheticProfile } from "@/lib/operations/types";

/**
 * Synthetic production journeys.
 *
 * A synthetic check runs against real production, so a careless step can do
 * real damage. Destructive verbs are rejected outright rather than warned
 * about, and a "safe write" must declare how it cleans up after itself.
 */

export type SyntheticStepKind =
  | "app_shell"
  | "login"
  | "critical_read"
  | "safe_write"
  | "api"
  | "workflow";

export interface SyntheticStep {
  readonly kind: SyntheticStepKind;
  readonly name: string;
  readonly path: string;
  readonly method: "GET" | "HEAD" | "POST";
  readonly expectedStatus: number;
  /** Required for safe_write: how the check leaves no residue in production. */
  readonly reversalNote?: string;
}

export interface SyntheticJourney {
  readonly profile: SyntheticProfile;
  readonly steps: readonly SyntheticStep[];
}

export type SyntheticRejection =
  | "DESTRUCTIVE_METHOD"
  | "DESTRUCTIVE_PATH"
  | "SAFE_WRITE_WITHOUT_REVERSAL"
  | "PROFILE_REQUIRES_MORE_COVERAGE"
  | "EMPTY_JOURNEY"
  | "TOO_MANY_STEPS";

export const MAX_SYNTHETIC_STEPS = 12;

const DESTRUCTIVE_PATH_PATTERN =
  /(delete|destroy|purge|drop|truncate|wipe|reset|revoke|deactivate|cancel-account|close-account)/i;

const REQUIRED_KINDS: Record<SyntheticProfile, readonly SyntheticStepKind[]> = {
  basic: ["app_shell"],
  standard: ["app_shell", "critical_read"],
  critical: ["app_shell", "login", "critical_read", "workflow"],
};

export interface SyntheticValidation {
  readonly valid: boolean;
  readonly rejections: readonly { code: SyntheticRejection; detail: string }[];
}

export function validateSyntheticJourney(journey: SyntheticJourney): SyntheticValidation {
  const rejections: { code: SyntheticRejection; detail: string }[] = [];

  if (journey.steps.length === 0) {
    rejections.push({ code: "EMPTY_JOURNEY", detail: "A journey needs at least one step." });
  }
  if (journey.steps.length > MAX_SYNTHETIC_STEPS) {
    rejections.push({
      code: "TOO_MANY_STEPS",
      detail: `A journey may contain at most ${MAX_SYNTHETIC_STEPS} steps.`,
    });
  }

  for (const step of journey.steps) {
    // Only GET, HEAD, and an explicitly declared safe POST are permitted.
    // PUT, PATCH, and DELETE are not modelled at all, so they cannot be used.
    if (step.method === "POST" && step.kind !== "safe_write" && step.kind !== "login") {
      rejections.push({
        code: "DESTRUCTIVE_METHOD",
        detail: `Step "${step.name}" uses POST without declaring itself a safe write.`,
      });
    }
    if (DESTRUCTIVE_PATH_PATTERN.test(step.path)) {
      rejections.push({
        code: "DESTRUCTIVE_PATH",
        detail: `Step "${step.name}" targets a destructive-looking path.`,
      });
    }
    if (step.kind === "safe_write" && !step.reversalNote?.trim()) {
      rejections.push({
        code: "SAFE_WRITE_WITHOUT_REVERSAL",
        detail: `Step "${step.name}" must describe how it avoids leaving production residue.`,
      });
    }
  }

  const presentKinds = new Set(journey.steps.map((step) => step.kind));
  const missing = REQUIRED_KINDS[journey.profile].filter((kind) => !presentKinds.has(kind));
  if (missing.length > 0) {
    rejections.push({
      code: "PROFILE_REQUIRES_MORE_COVERAGE",
      detail: `The ${journey.profile} profile also requires: ${missing.join(", ")}.`,
    });
  }

  return Object.freeze({ valid: rejections.length === 0, rejections: Object.freeze(rejections) });
}

export const SYNTHETIC_PROFILE_DESCRIPTIONS: Record<SyntheticProfile, string> = {
  basic: "Confirms the application shell loads.",
  standard: "Confirms the shell loads and a critical read returns real data.",
  critical: "Confirms shell, sign-in, a critical read, and one business-critical workflow.",
};
