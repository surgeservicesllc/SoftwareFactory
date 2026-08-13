"use client";

import { Bot, BrainCircuit, ClipboardCheck, Inbox, Loader2, PlayCircle, RefreshCw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { CommandComposer } from "@/components/command-composer";
import { EmptyPanel, TenantStateGate, formatDateTime, riskTone } from "@/components/tenant-states";
import { Panel, SectionTitle, StatusBadge } from "@/components/ui";
import { useTenantResource } from "@/lib/client/use-tenant-resource";

type CommandRow = {
  id: string;
  prompt: string;
  requestedRisk: string;
  status: string;
  submittedAt: string;
  completedAt: string | null;
  project: { id: string; name: string };
  planSummary: string | null;
  taskCount: number;
  completedTaskCount: number;
  failedTaskCount: number;
};

type ConnectionsPayload = {
  providerStatus: {
    workers: Array<{ key: string; label: string; state: string; detail: string; ownerAction: string | null }>;
  };
};

/**
 * Command lifecycle states, in the order they can occur. Showing the full set
 * makes it clear where a command actually is rather than implying that a
 * persisted record means work happened.
 */
const LIFECYCLE: Record<string, { label: string; tone: "safe" | "info" | "warning" | "danger" | "neutral" }> = {
  submitted: { label: "Submitted", tone: "neutral" },
  planning: { label: "Planning", tone: "info" },
  queued: { label: "Queued", tone: "info" },
  running: { label: "Running", tone: "info" },
  validating: { label: "Validating", tone: "info" },
  awaiting_review: { label: "Awaiting review", tone: "warning" },
  awaiting_approval: { label: "Awaiting owner approval", tone: "warning" },
  owner_action_required: { label: "Owner action required", tone: "warning" },
  succeeded: { label: "Completed", tone: "safe" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function BotManagerConsole() {
  const [reloadKey, setReloadKey] = useState(0);
  const commands = useTenantResource<{ commands: CommandRow[] }>(
    `/api/commands?limit=25&_=${reloadKey}`,
    { pollMs: 20_000 },
  );
  const connections = useTenantResource<ConnectionsPayload>("/api/connections");

  const refresh = useCallback(() => setReloadKey((key) => key + 1), []);

  const worker = connections.data?.providerStatus.workers[0];
  const workerStatusLabel =
    worker?.state === "connected" ? "Connected" : worker?.state === "configured" ? "Configured" : "Not Connected";

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div>
        <CommandComposer workerStatusLabel={workerStatusLabel} onSubmitted={refresh} />

        <Panel className="mt-5 overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-[#212b37] p-4 sm:flex-row sm:items-center sm:justify-between">
            <SectionTitle
              title="Recent commands"
              description="Durable records that survive a refresh, a sign-out, and a server restart."
            />
            <button
              type="button"
              onClick={commands.reload}
              disabled={commands.refreshing}
              className="secondary-action"
              aria-label="Refresh recent commands"
            >
              {commands.refreshing ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-3.5" aria-hidden="true" />
              )}
              Refresh
            </button>
          </div>

          {commands.state !== "ready" ? (
            <div className="p-4">
              <TenantStateGate
                state={commands.state}
                message={commands.message}
                subject="commands"
                next="/bot-manager"
              />
            </div>
          ) : (commands.data?.commands.length ?? 0) === 0 ? (
            <EmptyPanel
              title="No commands submitted yet"
              description="Submit a command above. It is planned, persisted, and visible here immediately."
              icon={Inbox}
            />
          ) : (
            <ul className="divide-y divide-[#202a36]">
              {commands.data?.commands.map((command) => {
                const lifecycle = LIFECYCLE[command.status] ?? { label: command.status, tone: "neutral" as const };
                return (
                  <li key={command.id} className="p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold leading-5 text-[#dce2e8]">{command.prompt}</p>
                        {command.planSummary ? (
                          <p className="mt-1 text-[10px] leading-4 text-[#6f7d8d]">{command.planSummary}</p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[8px] uppercase tracking-[0.1em] text-[#4f5b69]">
                          <span>{command.project.name}</span>
                          <span>{formatDateTime(command.submittedAt)}</span>
                          {command.taskCount > 0 ? (
                            <span>
                              {command.completedTaskCount}/{command.taskCount} tasks
                              {command.failedTaskCount > 0 ? ` · ${command.failedTaskCount} failed` : ""}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <StatusBadge tone={lifecycle.tone}>{lifecycle.label}</StatusBadge>
                        <StatusBadge tone={riskTone(command.requestedRisk)} dot={false}>
                          {command.requestedRisk.toUpperCase()}
                        </StatusBadge>
                      </div>
                    </div>
                    {command.taskCount > 0 ? (
                      <Link
                        href={`/runs?commandId=${command.id}`}
                        className="mt-3 inline-flex text-[10px] font-semibold text-[#a9be59] hover:text-[#dffb7b]"
                      >
                        View runs for this command
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel className="p-5">
          <SectionTitle title="Command lifecycle" description="Where a command can actually be." />
          <ol className="mt-5 space-y-4">
            {(
              [
                [BrainCircuit, "1", "Plan", "The orchestrator classifies intent, risk, and required agents."],
                [ShieldCheck, "2", "Authorize", "Policy, RED approval, and protected-resource rules are checked."],
                [PlayCircle, "3", "Execute", "A durable worker advances leased runs one bounded step at a time."],
                [ClipboardCheck, "4", "Review", "Work ends at a draft pull request that a human must review."],
              ] as const
            ).map(([Icon, number, title, description]) => (
              <li key={title} className="flex gap-3">
                <span className="relative grid size-8 shrink-0 place-items-center rounded-lg border border-[#2b3745] bg-[#131a24] text-[#829328]">
                  <Icon className="size-4" aria-hidden="true" />
                  <span className="absolute -left-1 -top-1 grid size-3.5 place-items-center rounded-full bg-[#202a36] font-mono text-[7px] text-[#99a5b3]">
                    {number}
                  </span>
                </span>
                <span>
                  <span className="block text-xs font-semibold text-[#d5dbe2]">{title}</span>
                  <span className="mt-1 block text-[10px] leading-4 text-[#6c7989]">{description}</span>
                </span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel className="p-5">
          <SectionTitle title="Worker provider" description="Execution needs a connected provider." />
          <div className="mt-4 space-y-3">
            {connections.state !== "ready" ? (
              <p className="text-[10px] text-[#667485]">Loading provider status…</p>
            ) : (
              connections.data?.providerStatus.workers.map((provider) => (
                <div key={provider.key} className="rounded-lg border border-[#293442] bg-[#0a0f16] p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-xs font-semibold text-[#d5dbe2]">
                      <Bot className="size-3.5 text-[#8b9d2e]" aria-hidden="true" />
                      {provider.label}
                    </span>
                    <StatusBadge tone={provider.state === "connected" ? "safe" : provider.state === "configured" ? "warning" : "neutral"}>
                      {provider.state === "connected"
                        ? "Connected"
                        : provider.state === "configured"
                          ? "Configured"
                          : "Not Connected"}
                    </StatusBadge>
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-[#6a7787]">{provider.detail}</p>
                  {provider.ownerAction ? (
                    <p className="mt-2 rounded border border-[#423824] bg-[#221c11] p-2 text-[10px] leading-4 text-[#b6a77f]">
                      Owner action: {provider.ownerAction}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </div>
          <Link href="/connections" className="mt-4 inline-flex text-[10px] font-semibold text-[#a9be59] hover:text-[#dffb7b]">
            Manage connections
          </Link>
        </Panel>

        <Panel className="border-[#3d3422] bg-[#17130d] p-5">
          <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-[#b7995e]">Trust rule</p>
          <p className="mt-3 text-xs leading-5 text-[#a99979]">
            A persisted command is intent. A queued run is intent plus a plan. Only a recorded result with
            real validation evidence is a claim about completed work.
          </p>
        </Panel>
      </div>
    </div>
  );
}
