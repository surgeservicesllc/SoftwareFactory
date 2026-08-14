"use client";

import { Fingerprint, Inbox, ListChecks, Target, Webhook } from "lucide-react";

import {
  formatDateTime,
  TenantListShell,
  useTenantList,
} from "@/components/tenant-list";
import { StatusBadge } from "@/components/ui";

/**
 * AgentOS surfaces, reading the live safe projections.
 *
 * Each section states what is true rather than what is intended: an agent with
 * no grant row reads "Nothing granted", a goal shows which rail stopped it,
 * and a trigger shows how many deliveries were refused. None of these start
 * work — no runner is connected — so nothing here offers a Run button it
 * could not honour.
 */

type AgentGrant = {
  agentId: string;
  agentName: string;
  configured: boolean;
  inboxAccess: boolean;
  runnerPreference: string;
  environment: { name: string | null; networking: string; allowedHostCount: number };
  counts: {
    mcpConnections: number;
    skills: number;
    repos: number;
    filesystemGrants: number;
    collaborators: number;
  };
};

type InboxMessage = {
  id: string;
  author: string;
  kind: string;
  status: string;
  body: string;
  choices: string[];
  selectedChoice: string | null;
  answerBody: string | null;
  agentName: string | null;
  createdAt: string;
};

type Goal = {
  id: string;
  title: string;
  status: string;
  projectName: string;
  definitionOfDone: { total: number; satisfied: number };
  spend: { capUsd: string | null; spentUsd: string; uncappedAcknowledged: boolean };
  iterations: number;
  stoppedReason: string | null;
};

type Chain = {
  id: string;
  title: string;
  templateName: string;
  projectName: string;
  progress: { total: number; done: number };
  currentStep: { name: string; state: string | null; approvalGate: boolean } | null;
};

type Trigger = {
  id: string;
  displayName: string;
  agentName: string;
  projectName: string;
  enabled: boolean;
  secretConfigured: boolean;
  deliveries: { total: number; accepted: number; rejected: number };
  lastReceivedAt: string | null;
};

function goalTone(status: string) {
  if (status === "completed") return "safe" as const;
  if (status === "active") return "info" as const;
  if (status.startsWith("stopped")) return "danger" as const;
  return "neutral" as const;
}

function AgentGrants() {
  const { state, reload } = useTenantList<AgentGrant>(
    "/api/agentos/grants",
    (body) => (body.agentGrants as AgentGrant[]) ?? [],
    "Agent permissions could not be loaded.",
  );

  return (
    <TenantListShell
      state={state}
      reload={reload}
      title="Agent permissions"
      icon={Fingerprint}
      signedOutTitle="Sign in to see agent permissions"
      signedOutDescription="Permissions are scoped to your workspace."
      returnPath="/solutions/agentos"
      emptyTitle="No agents yet"
      emptyDescription="Agents appear here with everything they are allowed to reach."
    >
      {(items) => (
        <ul className="divide-y divide-line">
          {items.map((grant) => (
            <li key={grant.agentId} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-foreground">{grant.agentName}</span>
                {grant.configured ? (
                  <StatusBadge tone={grant.environment.networking === "open" ? "warning" : "safe"}>
                    {grant.environment.networking === "open"
                      ? "Open network"
                      : `Limited · ${grant.environment.allowedHostCount} host${grant.environment.allowedHostCount === 1 ? "" : "s"}`}
                  </StatusBadge>
                ) : (
                  // Default deny is the real state, not a gap in the display.
                  <StatusBadge tone="neutral">Nothing granted</StatusBadge>
                )}
              </div>
              <p className="mt-2 text-sm text-muted">
                {grant.counts.mcpConnections} tools · {grant.counts.repos} repos ·{" "}
                {grant.counts.filesystemGrants} folders · {grant.counts.skills} skills ·{" "}
                {grant.counts.collaborators} collaborators
                {grant.inboxAccess ? " · can use the inbox" : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </TenantListShell>
  );
}

function InboxMessages() {
  const { state, reload } = useTenantList<InboxMessage>(
    "/api/agentos/inbox",
    (body) => (body.messages as InboxMessage[]) ?? [],
    "The inbox could not be loaded.",
  );

  return (
    <TenantListShell
      state={state}
      reload={reload}
      title="Inbox"
      icon={Inbox}
      signedOutTitle="Sign in to see the inbox"
      signedOutDescription="Agents message you here when they need a decision."
      returnPath="/solutions/agentos"
      emptyTitle="Nothing needs you"
      emptyDescription="Agents message here only when they are stuck or need a decision."
    >
      {(items) => (
        <ul className="divide-y divide-line">
          {items.map((message) => (
            <li key={message.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">
                  {message.agentName ?? "Agent"}
                </span>
                <StatusBadge tone={message.status === "open" ? "warning" : "safe"}>
                  {message.status === "open" ? "Waiting on you" : "Answered"}
                </StatusBadge>
              </div>
              <p className="mt-2 text-sm text-muted">{message.body}</p>
              {message.kind === "multiple_choice" && message.choices.length > 0 ? (
                <p className="mt-2 text-xs text-faint">
                  Options: {message.choices.join(" · ")}
                  {message.selectedChoice ? ` — chose ${message.selectedChoice}` : ""}
                </p>
              ) : null}
              {message.answerBody ? (
                <p className="mt-2 text-sm text-foreground">You said: {message.answerBody}</p>
              ) : null}
              <p className="mt-2 text-xs text-faint">{formatDateTime(message.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </TenantListShell>
  );
}

function Goals() {
  const { state, reload } = useTenantList<Goal>(
    "/api/agentos/goals",
    (body) => (body.goals as Goal[]) ?? [],
    "Goals could not be loaded.",
  );

  return (
    <TenantListShell
      state={state}
      reload={reload}
      title="Goals"
      icon={Target}
      signedOutTitle="Sign in to see goals"
      signedOutDescription="Goals are scoped to your workspace."
      returnPath="/solutions/agentos"
      emptyTitle="No goals yet"
      emptyDescription="A goal runs until its definition of done is met, or a rail stops it."
    >
      {(items) => (
        <ul className="divide-y divide-line">
          {items.map((goal) => (
            <li key={goal.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-foreground">{goal.title}</span>
                <StatusBadge tone={goalTone(goal.status)}>
                  {goal.status.replace(/_/g, " ")}
                </StatusBadge>
              </div>
              <p className="mt-2 text-sm text-muted">
                {goal.projectName} · {goal.definitionOfDone.satisfied} of{" "}
                {goal.definitionOfDone.total} done · {goal.iterations} iteration
                {goal.iterations === 1 ? "" : "s"} · spent ${goal.spend.spentUsd}
                {goal.spend.capUsd ? ` of $${goal.spend.capUsd}` : ""}
              </p>
              {/* An uncapped goal is worth saying out loud, not just omitting. */}
              {goal.spend.capUsd === null && goal.spend.uncappedAcknowledged ? (
                <p className="mt-2 text-xs text-[var(--warning)]">
                  Running without a spend cap, accepted by an owner.
                </p>
              ) : null}
              {goal.stoppedReason ? (
                <p className="mt-2 text-sm text-[var(--danger)]">{goal.stoppedReason}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </TenantListShell>
  );
}

function Chains() {
  const { state, reload } = useTenantList<Chain>(
    "/api/agentos/chains",
    (body) => (body.chains as Chain[]) ?? [],
    "Task chains could not be loaded.",
  );

  return (
    <TenantListShell
      state={state}
      reload={reload}
      title="Task chains"
      icon={ListChecks}
      signedOutTitle="Sign in to see task chains"
      signedOutDescription="Chains are scoped to your workspace."
      returnPath="/solutions/agentos"
      emptyTitle="No chains yet"
      emptyDescription="Starting a template creates a chain where each step waits for the one before it."
    >
      {(items) => (
        <ul className="divide-y divide-line">
          {items.map((chain) => (
            <li key={chain.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-foreground">{chain.title}</span>
                <StatusBadge tone={chain.currentStep ? "info" : "safe"}>
                  {chain.progress.done} of {chain.progress.total}
                </StatusBadge>
              </div>
              <p className="mt-2 text-sm text-muted">
                {chain.templateName} · {chain.projectName}
              </p>
              {chain.currentStep ? (
                <p className="mt-2 text-sm text-foreground">
                  Next: {chain.currentStep.name}
                  {/* A gated step is the one a person has to act on. */}
                  {chain.currentStep.approvalGate ? " — needs your approval" : ""}
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted">Every step is done.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </TenantListShell>
  );
}

function Triggers() {
  const { state, reload } = useTenantList<Trigger>(
    "/api/agentos/triggers",
    (body) => (body.triggers as Trigger[]) ?? [],
    "Triggers could not be loaded.",
  );

  return (
    <TenantListShell
      state={state}
      reload={reload}
      title="Triggers"
      icon={Webhook}
      signedOutTitle="Sign in to see triggers"
      signedOutDescription="Triggers are scoped to your workspace."
      returnPath="/solutions/agentos"
      emptyTitle="No triggers yet"
      emptyDescription="A trigger turns a signed inbound request into work for one scoped agent."
    >
      {(items) => (
        <ul className="divide-y divide-line">
          {items.map((trigger) => (
            <li key={trigger.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-foreground">{trigger.displayName}</span>
                <StatusBadge tone={trigger.enabled ? "safe" : "neutral"}>
                  {trigger.enabled ? "Enabled" : "Disabled"}
                </StatusBadge>
              </div>
              <p className="mt-2 text-sm text-muted">
                Runs as {trigger.agentName} on {trigger.projectName} ·{" "}
                {trigger.deliveries.accepted} accepted
                {trigger.deliveries.rejected > 0
                  ? `, ${trigger.deliveries.rejected} refused`
                  : ""}
              </p>
              {!trigger.secretConfigured ? (
                <p className="mt-2 text-xs text-[var(--warning)]">
                  No signing secret configured, so no delivery can be accepted.
                </p>
              ) : null}
              {trigger.lastReceivedAt ? (
                <p className="mt-2 text-xs text-faint">
                  Last delivery {formatDateTime(trigger.lastReceivedAt)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </TenantListShell>
  );
}

export function AgentOsConsole() {
  return (
    <div className="mt-4 space-y-4">
      <AgentGrants />
      <InboxMessages />
      <Goals />
      <Chains />
      <Triggers />
    </div>
  );
}
