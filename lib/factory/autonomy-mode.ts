/**
 * The directive's autonomy modes, mapped onto the controls that exist.
 *
 * `projects` has carried the real autonomy controls since Phase 1D:
 * autonomous_mode, maximum_autonomous_risk, and the four auto_* switches,
 * owner-writable through `update_project_controls` and fenced by
 * `enforce_safe_project_controls` — which in this phase refuses any state
 * other than everything-off with a GREEN ceiling, because
 * `policies/RISK_CLASSIFICATION.md` classifies enabling or widening
 * autonomous approval authority as RED, and Phase 1A executes no RED action
 * autonomously. This module names the three modes over those records. It
 * derives, it never overrides: the stored controls are the truth, the fence
 * has the last word, and no mode ever bypasses a destructive, security, or
 * deployment approval.
 */

export type AutonomyMode = "ask_me" | "balanced" | "autonomous";

export type AutonomyControls = Readonly<{
  autonomousMode: boolean;
  maximumAutonomousRisk: string;
  autoApprove: boolean;
  autoMerge: boolean;
  autoDeploy: boolean;
  autoRollback: boolean;
}>;

/** The exact PATCH body a mode asks the real controls route for. */
export type AutonomyModeDefinition = Readonly<{
  key: AutonomyMode;
  name: string;
  /** What the mode means, in the directive's own framing. */
  promise: string;
  /** What never changes, whatever the mode. */
  invariant: string;
  patch: Readonly<{
    autonomousMode: boolean;
    maximumAutonomousRisk: "green" | "yellow";
  }>;
}>;

export const AUTONOMY_MODES: readonly AutonomyModeDefinition[] = Object.freeze([
  {
    key: "ask_me",
    name: "Ask Me",
    promise: "Every important action waits for your approval: the plan before launch, and every human gate inside the run.",
    invariant: "This is the only mode Phase 1A permits; it is every project's stored state.",
    patch: { autonomousMode: false, maximumAutonomousRisk: "green" },
  },
  {
    key: "balanced",
    name: "Balanced",
    promise: "Safe (GREEN-classified) work would run without extra friction; gates on meaningful decisions would still wait for you.",
    invariant: "Merge, deployment and destructive approvals stay owner-approved. Enabling this is a RED policy change an owner must authorize outside this panel.",
    patch: { autonomousMode: true, maximumAutonomousRisk: "green" },
  },
  {
    key: "autonomous",
    name: "Autonomous",
    promise: "The factory would drive work to completion within defined safety gates, up to a YELLOW risk ceiling.",
    invariant: "RED actions are never autonomous, in any phase, under any mode. Enabling this is a RED policy change an owner must authorize outside this panel.",
    patch: { autonomousMode: true, maximumAutonomousRisk: "yellow" },
  },
]);

/**
 * Which mode the stored controls express. Derived, never guessed: today
 * every project derives ask_me because the fence admits nothing else, and
 * the day the policy opens, this same read reports the new truth.
 */
export function deriveAutonomyMode(controls: AutonomyControls): AutonomyMode {
  if (!controls.autonomousMode) return "ask_me";
  return controls.maximumAutonomousRisk === "green" ? "balanced" : "autonomous";
}
