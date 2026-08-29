import {
  AUTOMATIC_ACTIONS,
  type AutomaticAction,
  type AutomaticActionFlags,
  type AutonomyControls,
  NO_AUTOMATIC_ACTIONS,
} from "@/lib/autonomy/controls";
import type { RiskLevel } from "@/lib/risk";

/**
 * The three autonomy modes, as one choice instead of nine switches.
 *
 * The control model underneath is already correct: nine per-action flags, a
 * risk ceiling, two scopes that intersect, and an envelope that overrides
 * everything. What it was not is *choosable*. A person who wants "build it and
 * ask me before anything risky" had to derive that from nine booleans, and the
 * odds of assembling an incoherent set were high.
 *
 * A mode is a **preset**, exactly as a role preset is over an assignment: it
 * produces an `AutonomyControls` value that then goes through
 * `resolveEffectiveControls` like any other. It is not a second path around
 * the envelope. A kill switch, an emergency stop, a release freeze or a
 * missing executor still forces every action off in Autonomous, because the
 * envelope is applied after this and does not consult it.
 *
 * **What no mode does.** `merge`, `deploy` and `rollback` are off in all
 * three, including Autonomous. That is not an oversight to be corrected later
 * by widening the preset — AGENTS.md forbids introducing an auto-merge or
 * production deployment workflow in this phase, and the goal's own rule is to
 * never bypass destructive, security or deployment approvals unless explicitly
 * configured. A mode is not that explicit configuration; it is a default. An
 * operator who genuinely wants one of those enables it deliberately on the
 * controls themselves, which is why `modeForControls` reports such a
 * configuration as custom rather than quietly calling it Autonomous.
 */

export const AUTONOMY_MODES = ["ask_me", "balanced", "autonomous"] as const;
export type AutonomyMode = (typeof AUTONOMY_MODES)[number];

/**
 * The three actions no preset turns on.
 *
 * Named as data rather than left implicit in each preset, so the rule is one
 * fact a test can hold every mode to instead of three separate omissions that
 * could each drift.
 */
export const NEVER_PRESET_ENABLED: readonly AutomaticAction[] = Object.freeze([
  "merge",
  "deploy",
  "rollback",
]);

export type AutonomyModeDefinition = Readonly<{
  mode: AutonomyMode;
  label: string;
  /** One line a nontechnical person can act on. */
  summary: string;
  /** What this mode will still stop and ask about, in plain words. */
  asksAbout: string;
  controls: AutonomyControls;
}>;

function flags(enabled: readonly AutomaticAction[]): AutomaticActionFlags {
  return Object.freeze(
    Object.fromEntries(
      AUTOMATIC_ACTIONS.map((action) => [action, enabled.includes(action)]),
    ),
  ) as AutomaticActionFlags;
}

function definition(
  mode: AutonomyMode,
  label: string,
  summary: string,
  asksAbout: string,
  autonomousMode: boolean,
  maximumAutonomousRisk: RiskLevel,
  enabled: readonly AutomaticAction[],
): AutonomyModeDefinition {
  return Object.freeze({
    mode,
    label,
    summary,
    asksAbout,
    controls: Object.freeze({
      autonomousMode,
      maximumAutonomousRisk,
      actions: enabled.length === 0 ? NO_AUTOMATIC_ACTIONS : flags(enabled),
    }),
  });
}

export const AUTONOMY_MODE_DEFINITIONS: readonly AutonomyModeDefinition[] = Object.freeze([
  /*
   * The Phase 1 default, and identical to DEFAULT_AUTONOMY_CONTROLS on
   * purpose: a new organization is already in Ask Me, so naming the mode
   * describes what is happening rather than changing it.
   */
  definition(
    "ask_me",
    "Ask Me",
    "Nothing runs until you say so. You will see the plan and approve each step.",
    "Every step, including planning.",
    false,
    "GREEN",
    [],
  ),
  /*
   * The work that produces something reviewable, and nothing that accepts it.
   * `approve` is deliberately absent: a run that both writes the code and
   * approves it has no independent check, and the goal is explicit that an
   * agent saying done is not done.
   */
  definition(
    "balanced",
    "Balanced",
    "Safe work runs on its own — planning, building, testing and review. You approve the rest.",
    "Accepting the work, merging it, and anything that reaches users.",
    true,
    "GREEN",
    ["plan", "code", "test", "repair", "review"],
  ),
  /*
   * `approve` joins the set here, and the ceiling rises to YELLOW. This is the
   * real difference between Balanced and Autonomous in this phase: the run can
   * accept its own verified work and carry on, rather than waiting at each
   * stage gate. It still cannot merge, deploy or roll back.
   */
  definition(
    "autonomous",
    "Autonomous",
    "The project runs end to end, stopping only at the safety gates.",
    "Merging, deploying, rolling back, and anything above medium risk.",
    true,
    "YELLOW",
    ["plan", "code", "test", "repair", "review", "approve"],
  ),
]);

const BY_MODE: ReadonlyMap<AutonomyMode, AutonomyModeDefinition> = new Map(
  AUTONOMY_MODE_DEFINITIONS.map((entry) => [entry.mode, entry]),
);

export function isAutonomyMode(value: unknown): value is AutonomyMode {
  return typeof value === "string" && (AUTONOMY_MODES as readonly string[]).includes(value);
}

/**
 * The definition for a mode, falling back to the most restrictive one.
 *
 * An unrecognised value resolves to Ask Me rather than throwing, for the same
 * reason `controlsFromRow` does: a malformed setting must never read as more
 * authority than intended.
 */
export function autonomyModeDefinition(value: unknown): AutonomyModeDefinition {
  return (isAutonomyMode(value) ? BY_MODE.get(value) : undefined) ?? BY_MODE.get("ask_me")!;
}

export function controlsForMode(value: unknown): AutonomyControls {
  return autonomyModeDefinition(value).controls;
}

/**
 * Which mode a stored configuration corresponds to, or `null` for custom.
 *
 * Returning null matters more than matching does. An operator who enabled
 * `deploy` by hand is in a configuration no preset produces, and reporting
 * that as "Autonomous" would tell them the platform's safety story applies
 * when they have deliberately stepped outside it. The interface should say
 * Custom and list what is on.
 */
export function modeForControls(controls: AutonomyControls): AutonomyMode | null {
  for (const entry of AUTONOMY_MODE_DEFINITIONS) {
    const sameMode = entry.controls.autonomousMode === controls.autonomousMode;
    const sameCeiling =
      entry.controls.maximumAutonomousRisk === controls.maximumAutonomousRisk;
    const sameActions = AUTOMATIC_ACTIONS.every(
      (action) => entry.controls.actions[action] === controls.actions[action],
    );
    if (sameMode && sameCeiling && sameActions) return entry.mode;
  }
  return null;
}
