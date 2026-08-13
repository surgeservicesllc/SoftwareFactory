import { compareRisk, type RiskLevel } from "@/lib/risk";

/**
 * The Phase 1D control model.
 *
 * Two scopes carry the same shape: an organization sets the ceiling, a project
 * may only narrow it. Resolution is deliberately one-directional — a project can
 * never widen what its organization allows — so an operator reading the project
 * page cannot be shown authority the organization has withdrawn.
 *
 * Nothing here executes. These values decide whether a stage of the loop is
 * *permitted* to proceed; the stage itself still has to satisfy its gates,
 * its approval, and the hard interlocks.
 */

/**
 * The nine automatic actions, in loop order.
 *
 * Order matters: it is the order the orchestrator advances through, and the
 * order the UI lists them in, so a reader sees the pipeline rather than an
 * alphabetised set of switches.
 */
export const AUTOMATIC_ACTIONS = [
  "plan",
  "code",
  "test",
  "repair",
  "review",
  "approve",
  "merge",
  "deploy",
  "rollback",
] as const;

export type AutomaticAction = (typeof AUTOMATIC_ACTIONS)[number];

export type AutomaticActionFlags = Readonly<Record<AutomaticAction, boolean>>;

export interface AutonomyControls {
  readonly autonomousMode: boolean;
  readonly maximumAutonomousRisk: RiskLevel;
  readonly actions: AutomaticActionFlags;
}

/**
 * Interlocks that sit outside either scope's preferences.
 *
 * These are not settings a tenant negotiates. Each one, when engaged, forces
 * every automatic action off regardless of what the two scopes say.
 */
export interface AutonomyEnvelope {
  /** `organizations.autonomy_kill_switch_active`, locked ON by migration 010. */
  readonly killSwitchActive: boolean;
  /** Set by the owner-only `stop_autonomous_operations` emergency STOP. */
  readonly emergencyStopActive: boolean;
  /** An active release freeze on the project, automatic on SEV1/SEV2. */
  readonly releaseFrozen: boolean;
  /** True only once a real execution worker is bound. Phase 1C is not started. */
  readonly executorConnected: boolean;
}

export type AutonomyRestriction =
  | "GLOBAL_KILL_SWITCH_ACTIVE"
  | "EMERGENCY_STOP_ACTIVE"
  | "RELEASE_FROZEN"
  | "EXECUTOR_NOT_CONNECTED"
  | "AUTONOMOUS_MODE_OFF_ORGANIZATION"
  | "AUTONOMOUS_MODE_OFF_PROJECT";

export interface EffectiveAutonomyControls extends AutonomyControls {
  /** Which side supplied the ceiling, so the UI can explain the number. */
  readonly riskCeilingSource: "organization" | "project";
  /** Envelope conditions currently forcing actions off, in severity order. */
  readonly restrictions: readonly AutonomyRestriction[];
}

/** Every action off. The safe value to fall back to whenever context is missing. */
export const NO_AUTOMATIC_ACTIONS: AutomaticActionFlags = Object.freeze(
  Object.fromEntries(AUTOMATIC_ACTIONS.map((action) => [action, false])),
) as AutomaticActionFlags;

/**
 * The Phase 1 default for both scopes: mode off, GREEN ceiling, nothing automatic.
 * A new organization or project starts here and can only be widened deliberately.
 */
export const DEFAULT_AUTONOMY_CONTROLS: AutonomyControls = Object.freeze({
  autonomousMode: false,
  maximumAutonomousRisk: "GREEN",
  actions: NO_AUTOMATIC_ACTIONS,
});

export function isAutomaticAction(value: unknown): value is AutomaticAction {
  return typeof value === "string" && (AUTOMATIC_ACTIONS as readonly string[]).includes(value);
}

/** An action is enabled only where both scopes enable it. */
function intersectActions(
  organization: AutomaticActionFlags,
  project: AutomaticActionFlags,
): AutomaticActionFlags {
  return Object.freeze(
    Object.fromEntries(
      AUTOMATIC_ACTIONS.map((action) => [action, organization[action] && project[action]]),
    ),
  ) as AutomaticActionFlags;
}

/**
 * Resolve the controls that actually apply, most restrictive wins.
 *
 * The envelope is applied last and unconditionally: a kill switch, an emergency
 * stop, a release freeze, or a missing executor forces every action off no
 * matter what either scope configured. `autonomousMode` is reported honestly —
 * it stays whatever the two scopes agreed — so the interface can say "mode is
 * on, but everything is held off because X" rather than silently rewriting the
 * operator's setting.
 */
export function resolveEffectiveControls(
  organization: AutonomyControls,
  project: AutonomyControls,
  envelope: AutonomyEnvelope,
): EffectiveAutonomyControls {
  const autonomousMode = organization.autonomousMode && project.autonomousMode;

  const organizationIsLower =
    compareRisk(organization.maximumAutonomousRisk, project.maximumAutonomousRisk) <= 0;
  const maximumAutonomousRisk = organizationIsLower
    ? organization.maximumAutonomousRisk
    : project.maximumAutonomousRisk;

  const restrictions: AutonomyRestriction[] = [];
  if (envelope.killSwitchActive) restrictions.push("GLOBAL_KILL_SWITCH_ACTIVE");
  if (envelope.emergencyStopActive) restrictions.push("EMERGENCY_STOP_ACTIVE");
  if (envelope.releaseFrozen) restrictions.push("RELEASE_FROZEN");
  if (!envelope.executorConnected) restrictions.push("EXECUTOR_NOT_CONNECTED");
  if (!organization.autonomousMode) restrictions.push("AUTONOMOUS_MODE_OFF_ORGANIZATION");
  if (!project.autonomousMode) restrictions.push("AUTONOMOUS_MODE_OFF_PROJECT");

  const actions = restrictions.length
    ? NO_AUTOMATIC_ACTIONS
    : intersectActions(organization.actions, project.actions);

  return Object.freeze({
    autonomousMode,
    maximumAutonomousRisk,
    actions,
    riskCeilingSource: organizationIsLower ? "organization" : "project",
    restrictions: Object.freeze(restrictions),
  });
}

/**
 * Whether one specific action may run at a given risk level.
 *
 * Both conditions have to hold: the action is enabled after resolution, and the
 * work's risk sits within the resolved ceiling. Callers still owe the gates and
 * the approval decision — this only answers "is it permitted to try".
 */
export function isActionPermitted(
  controls: EffectiveAutonomyControls,
  action: AutomaticAction,
  risk: RiskLevel,
): boolean {
  if (!controls.actions[action]) return false;
  return compareRisk(risk, controls.maximumAutonomousRisk) <= 0;
}

/**
 * Parse a persisted control row into the model.
 *
 * Unknown or missing values resolve to the safe default rather than throwing:
 * a malformed row must never read as *more* authority than intended.
 */
export function controlsFromRow(row: Record<string, unknown> | null | undefined): AutonomyControls {
  if (!row) return DEFAULT_AUTONOMY_CONTROLS;

  const ceiling = String(row.maximum_autonomous_risk ?? "").toUpperCase();
  const maximumAutonomousRisk: RiskLevel =
    ceiling === "YELLOW" || ceiling === "RED" ? (ceiling as RiskLevel) : "GREEN";

  return Object.freeze({
    autonomousMode: row.autonomous_mode === true,
    maximumAutonomousRisk,
    actions: Object.freeze(
      Object.fromEntries(
        AUTOMATIC_ACTIONS.map((action) => [action, row[`auto_${action}`] === true]),
      ),
    ) as AutomaticActionFlags,
  });
}
