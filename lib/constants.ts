import type { RiskLevel } from "@/lib/risk";

export const DEMO_DATA_LABEL = "Demo Data";
export const NOT_CONNECTED_LABEL = "Not Connected";

/**
 * Safety-sensitive automation is opt-in. Keep these defaults aligned with the
 * Phase 1 requirement whenever a project or settings form is initialized.
 */
export const AUTOMATION_DEFAULTS = Object.freeze({
  autonomousMode: false,
  maximumAutonomousRisk: "GREEN" as RiskLevel,
  autoApprove: false,
  autoMerge: false,
  autoDeploy: false,
  autoRollback: false,
});
