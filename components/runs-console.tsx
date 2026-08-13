"use client";

import { Clock3, Coins, Loader2, Play, RefreshCw, Route, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { EmptyState, Panel, StatusBadge } from "@/components/ui";

type RunRouting = {
  decision: string;
  source: string | null;
  requestedProvider: string;
  policyVersion: string;
  reasons: { code: string; detail: string }[];
};

type ProviderRun = {
  id: string;
  taskKind: string | null;
  status: string;
  provider: string | null;
  providerLabel: string | null;
  model: string | null;
  latencyMs: number | null;
  fallbackFromProvider: string | null;
  estimatedCostLabel: string;
  inputTokens: number | null;
  outputTokens: number | null;
  errorMessage: string | null;
  summary: string | null;
  createdAt: string;
  routing: RunRouting | null;
};

type LoadState = "loading" | "signed-out" | "ready" | "error";

function toneForStatus(status: string) {
  if (status === "succeeded") return "safe" as const;
  if (status === "failed") return "danger" as const;
  if (status === "cancelled") return "warning" as const;
  return "neutral" as const;
}

/**
 * Real provider run evidence. Every row is a persisted run; there is no
 * illustrative data on this surface.
 */
export function RunsConsole() {
  const [runs, setRuns] = useState<ProviderRun[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("");
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const response = await fetch("/api/runs", { cache: "no-store" });
      if (response.status === 401) {
        setLoadState("signed-out");
        return;
      }
      const body = (await response.json()) as { runs?: ProviderRun[]; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Runs could not be loaded.");
      setRuns(body.runs ?? []);
      setLoadState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Runs could not be loaded.");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    // Deferred a tick so the initial load does not set state synchronously
    // inside the effect body, matching the other consoles in this app.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (loadState === "loading") {
    return (
      <Panel className="grid min-h-64 place-items-center">
        <Loader2 className="size-6 animate-spin text-[#c6f135]" aria-label="Loading runs" />
      </Panel>
    );
  }

  if (loadState === "signed-out") {
    return (
      <EmptyState
        title="Authentication required"
        description="Sign in to see the recorded provider runs for your organization."
      />
    );
  }

  if (loadState === "error") {
    return (
      <Panel className="p-5">
        <p className="text-xs text-[#e59399]">{message}</p>
        <button type="button" onClick={() => void load()} className="secondary-action mt-4">
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Retry
        </button>
      </Panel>
    );
  }

  if (runs.length === 0) {
    return (
      <EmptyState
        title="No provider runs recorded"
        description="A run appears here after the Bot Manager routes a task to a provider. Nothing is shown until a real run produces evidence."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" onClick={() => void load()} className="secondary-action">
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Refresh
        </button>
      </div>

      {runs.map((run) => {
        const expanded = expandedRunId === run.id;
        return (
          <Panel key={run.id} className="p-4 sm:p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-[#2d3947] bg-[#151d27] text-[#8fa132]">
                  <Play className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[9px] text-[#596675]">{run.id.slice(0, 8)}</span>
                    <StatusBadge tone={toneForStatus(run.status)}>{run.status}</StatusBadge>
                    {run.fallbackFromProvider ? (
                      <StatusBadge tone="warning">
                        Fallback from {run.fallbackFromProvider}
                      </StatusBadge>
                    ) : null}
                  </div>
                  <h2 className="mt-1.5 truncate text-xs font-semibold text-[#dce2e8]">
                    {run.taskKind?.replace(/_/g, " ") ?? "provider run"}
                  </h2>
                  <p className="mt-1 text-[10px] text-[#687586]">
                    {run.providerLabel ?? "No provider"}
                    {run.model ? ` · ${run.model}` : ""}
                  </p>
                  {run.summary ? (
                    <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-[#8c99a9]">
                      {run.summary}
                    </p>
                  ) : null}
                  {run.errorMessage ? (
                    <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-5 text-[#e59399]">
                      <ShieldAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                      {run.errorMessage}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-5 md:min-w-[340px]">
                <Metric label="Duration" icon={<Clock3 className="size-3" aria-hidden="true" />}>
                  {run.latencyMs === null ? "—" : `${(run.latencyMs / 1000).toFixed(1)}s`}
                </Metric>
                <Metric label="Tokens">
                  {run.inputTokens === null && run.outputTokens === null
                    ? "—"
                    : `${run.inputTokens ?? 0} / ${run.outputTokens ?? 0}`}
                </Metric>
                <Metric label="Est. cost" icon={<Coins className="size-3" aria-hidden="true" />}>
                  {run.estimatedCostLabel}
                </Metric>
              </div>
            </div>

            {run.routing ? (
              <div className="mt-4 border-t border-[#202a36] pt-3">
                <button
                  type="button"
                  onClick={() => setExpandedRunId(expanded ? null : run.id)}
                  aria-expanded={expanded}
                  className="flex items-center gap-1.5 text-[10px] font-semibold text-[#849528]"
                >
                  <Route className="size-3" aria-hidden="true" />
                  {expanded ? "Hide routing decision" : "Why this provider?"}
                </button>

                {expanded ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-[10px] text-[#6a7787]">
                      Requested {run.routing.requestedProvider} · decided {run.routing.decision}
                      {run.routing.source ? ` via ${run.routing.source}` : ""} · policy{" "}
                      {run.routing.policyVersion}
                    </p>
                    <ul className="space-y-1.5">
                      {run.routing.reasons.map((reason, index) => (
                        <li
                          key={`${reason.code}-${index}`}
                          className="rounded-lg border border-[#283341] bg-[#0b1017] p-2.5"
                        >
                          <p className="font-mono text-[9px] text-[#849528]">{reason.code}</p>
                          <p className="mt-1 text-[10px] leading-4 text-[#8c99a9]">{reason.detail}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </Panel>
        );
      })}
    </div>
  );
}

function Metric({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#4f5b69]">{label}</p>
      <p className="mt-1 flex items-center gap-1 text-[10px] font-medium text-[#9ca8b6]">
        {icon}
        {children}
      </p>
    </div>
  );
}
