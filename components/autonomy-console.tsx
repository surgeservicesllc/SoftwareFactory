"use client";

import { Gauge, ScrollText } from "lucide-react";

import {
  formatDateTime,
  TenantListShell,
  useTenantList,
} from "@/components/tenant-list";
import { StatusBadge } from "@/components/ui";

/**
 * The autonomous loop, made legible.
 *
 * Two questions a person actually has: what is the loop allowed to do right
 * now, and what has it decided. The second half existed in the database since
 * the decision-audit migration and had no reader at all.
 *
 * Nothing here changes an interlock. Enabling an automatic action is a RED
 * action requiring an owner-approved migration, so this surface reports and
 * never offers a switch it must not have.
 */

type AutonomyStatus = {
  projectId: string;
  projectName: string;
  autonomousMode: boolean;
  riskCeiling: string;
  riskCeilingSource: string;
  killSwitchActive: boolean;
  releaseFrozen: boolean;
  executorConnected: boolean;
  actions: { enabled: number; total: number };
  decisionsRecorded: number;
  lastDecisionAt: string | null;
};

type AutonomyDecision = {
  id: string;
  projectName: string;
  action: string;
  decision: string;
  risk: string;
  riskEscalated: boolean;
  headSha: string | null;
  blockers: string[];
  reachedStage: string | null;
  policyVersion: string;
  hadAuthor: boolean;
  hadApprover: boolean;
  independentApproval: boolean;
  decidedAt: string;
};

function decisionTone(decision: string) {
  if (decision === "APPROVED_AUTOMATICALLY") return "safe" as const;
  if (decision === "OWNER_APPROVAL_REQUIRED") return "warning" as const;
  return "danger" as const;
}

function AutonomyStatusList() {
  const { state, reload } = useTenantList<AutonomyStatus>(
    "/api/autonomy/status",
    (body) => (body.status as AutonomyStatus[]) ?? [],
    "Autonomy status could not be loaded.",
  );

  return (
    <TenantListShell
      state={state}
      reload={reload}
      title="What the loop may do"
      icon={Gauge}
      signedOutTitle="Sign in to see autonomy status"
      signedOutDescription="Autonomy controls are scoped to your workspace."
      returnPath="/solutions/autonomy"
      emptyTitle="No projects yet"
      emptyDescription="This page shows what each project is allowed to do on its own. Add a project first and its permissions appear here."
      emptyActionHref="/solutions/projects"
      emptyActionLabel="Add a project"
    >
      {(items) => (
        <ul className="divide-y divide-line">
          {items.map((project) => (
            <li key={project.projectId} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-foreground">{project.projectName}</span>
                {/* The kill switch outranks everything, so it is said first. */}
                <StatusBadge tone={project.killSwitchActive ? "safe" : "warning"}>
                  {project.killSwitchActive ? "Kill switch ON" : "Kill switch OFF"}
                </StatusBadge>
              </div>
              <p className="mt-2 text-sm text-muted">
                {project.actions.enabled} of {project.actions.total} automatic actions enabled ·
                ceiling {project.riskCeiling.toUpperCase()} (from {project.riskCeilingSource}) ·
                autonomous mode {project.autonomousMode ? "on" : "off"}
              </p>
              <p className="mt-2 text-sm text-muted">
                {/* Without this line, nine OFF flags could read as "ready but
                    idle" rather than "nothing could run even if enabled". */}
                {project.executorConnected
                  ? "An executor is connected."
                  : "No executor is connected, so no action could run even if enabled."}
                {project.releaseFrozen ? " Releases are frozen." : ""}
              </p>
              <p className="mt-2 text-xs text-faint">
                {project.decisionsRecorded} decision
                {project.decisionsRecorded === 1 ? "" : "s"} recorded
                {project.lastDecisionAt
                  ? ` · last ${formatDateTime(project.lastDecisionAt)}`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </TenantListShell>
  );
}

function AutonomyDecisions() {
  const { state, reload } = useTenantList<AutonomyDecision>(
    "/api/autonomy/decisions",
    (body) => (body.decisions as AutonomyDecision[]) ?? [],
    "Autonomy decisions could not be loaded.",
  );

  return (
    <TenantListShell
      state={state}
      reload={reload}
      title="What the loop decided"
      icon={ScrollText}
      signedOutTitle="Sign in to see autonomy decisions"
      signedOutDescription="The decision trail is scoped to your workspace."
      returnPath="/solutions/autonomy"
      emptyTitle="No decisions yet"
      emptyDescription="When work is proposed, the decision to allow or refuse it is recorded here — refusals included. Ask a bot for something to see the first one."
      emptyActionHref="/solutions/bot-manager"
      emptyActionLabel="Give a bot something to do"
    >
      {(items) => (
        <ul className="divide-y divide-line">
          {items.map((decision) => (
            <li key={decision.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-foreground">
                  {decision.action} · {decision.projectName}
                </span>
                <StatusBadge tone={decisionTone(decision.decision)}>
                  {decision.decision.replace(/_/g, " ").toLowerCase()}
                </StatusBadge>
              </div>
              <p className="mt-2 text-sm text-muted">
                Risk {decision.risk.toUpperCase()}
                {decision.riskEscalated ? " (escalated past the declaration)" : ""}
                {decision.reachedStage ? ` · reached ${decision.reachedStage}` : ""}
                {decision.headSha ? ` · ${decision.headSha.slice(0, 7)}` : ""}
              </p>
              {decision.blockers.length > 0 ? (
                <p className="mt-2 text-sm text-[var(--danger)]">
                  Blocked by {decision.blockers.join(", ")}
                </p>
              ) : null}
              {/* The rule the phase turns on: an approval is only meaningful
                  if someone other than the author gave it. */}
              {decision.hadApprover ? (
                <p className="mt-2 text-xs text-faint">
                  {decision.independentApproval
                    ? "Approved by someone other than the author."
                    : "Approver and author are the same person."}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-faint">
                {formatDateTime(decision.decidedAt)} · policy {decision.policyVersion}
              </p>
            </li>
          ))}
        </ul>
      )}
    </TenantListShell>
  );
}

export function AutonomyConsole() {
  return (
    <div className="mt-4 space-y-4">
      <AutonomyStatusList />
      <AutonomyDecisions />
    </div>
  );
}
