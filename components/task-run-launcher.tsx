"use client";

import { CheckCircle2, Loader2, Route, ShieldAlert, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { StatusBadge } from "@/components/ui";

const TASK_KINDS = [
  { value: "plan", label: "Plan" },
  { value: "architecture_review", label: "Architecture review" },
  { value: "implementation_proposal", label: "Implementation proposal" },
  { value: "implementation_review", label: "Implementation review" },
  { value: "security_review", label: "Security review" },
  { value: "qa_assessment", label: "QA assessment" },
  { value: "status_report", label: "Status report" },
] as const;

const PROVIDER_REQUESTS = [
  { value: "AUTO", label: "Auto" },
  { value: "ANTHROPIC", label: "Claude" },
  { value: "OPENAI", label: "Codex" },
] as const;

type Agent = { id: string; name: string; role: string; provider: string | null; model: string | null };

type RoutingReason = { code: string; provider: string | null; detail: string };

type PreviewResponse = {
  executionEnabled: boolean;
  decision: {
    decision: string;
    provider: string | null;
    model: string | null;
    source: string | null;
    requiresOwnerApproval: boolean;
    reasons: RoutingReason[];
  };
};

type RunResponse = {
  outcome: string;
  runId: string | null;
  routing: { provider: string | null; model: string | null; source: string | null };
  fallback: { fromProvider: string; reason: string | null } | null;
  result: { summary: string; recommendations: string[] } | null;
};

/**
 * Route a persisted task to a provider and run it.
 *
 * Preview is always available and contacts nothing. Running is gated on the
 * owner having enabled outbound provider execution, and the result is an
 * advisory artifact recorded against the task.
 */
export function TaskRunLauncher({
  projectId,
  taskId,
  instructions,
}: {
  projectId: string;
  taskId: string;
  instructions: string;
}) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState("");
  const [taskKind, setTaskKind] = useState<(typeof TASK_KINDS)[number]["value"]>("plan");
  const [requestedProvider, setRequestedProvider] =
    useState<(typeof PROVIDER_REQUESTS)[number]["value"]>("AUTO");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [run, setRun] = useState<RunResponse | null>(null);
  const [pending, setPending] = useState<"preview" | "run" | null>(null);
  const [message, setMessage] = useState("");

  const loadAgents = useCallback(async () => {
    try {
      const response = await fetch("/api/agents", { cache: "no-store" });
      const body = (await response.json()) as { agents?: Agent[] };
      if (!response.ok) return;
      setAgents(body.agents ?? []);
      setAgentId(body.agents?.[0]?.id ?? "");
    } catch {
      // Agent selection stays empty; the panel explains what is missing.
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAgents(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAgents]);

  async function requestPreview() {
    setPending("preview");
    setMessage("");
    setRun(null);
    try {
      const response = await fetch("/api/runs/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, agentId: agentId || null, taskKind, requestedProvider }),
      });
      const body = (await response.json()) as PreviewResponse & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The routing preview failed.");
      setPreview(body);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The routing preview failed.");
    } finally {
      setPending(null);
    }
  }

  async function startRun() {
    if (!agentId) {
      setMessage("Choose an agent before running this task.");
      return;
    }
    setPending("run");
    setMessage("");
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, taskId, agentId, taskKind, instructions, requestedProvider }),
      });
      const body = (await response.json()) as RunResponse & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The provider run could not start.");
      setRun(body);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The provider run could not start.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-[#283341] bg-[#0b1017] p-4">
      <div className="flex items-center gap-2">
        <Route className="size-3.5 text-[#c6f135]" aria-hidden="true" />
        <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-[#819164]">
          Route this task
        </p>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <label>
          <span className="mb-1.5 block font-mono text-[8px] uppercase tracking-[0.12em] text-[#566270]">
            Agent
          </span>
          <select
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
            aria-label="Agent"
            className="h-8 w-full rounded-lg border border-[#2b3644] bg-[#0a0f16] px-2 text-[10px] text-[#d8dee5]"
          >
            {agents.length === 0 ? <option value="">No agents defined</option> : null}
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1.5 block font-mono text-[8px] uppercase tracking-[0.12em] text-[#566270]">
            Task kind
          </span>
          <select
            value={taskKind}
            onChange={(event) => setTaskKind(event.target.value as typeof taskKind)}
            aria-label="Task kind"
            className="h-8 w-full rounded-lg border border-[#2b3644] bg-[#0a0f16] px-2 text-[10px] text-[#d8dee5]"
          >
            {TASK_KINDS.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1.5 block font-mono text-[8px] uppercase tracking-[0.12em] text-[#566270]">
            Provider
          </span>
          <select
            value={requestedProvider}
            onChange={(event) => setRequestedProvider(event.target.value as typeof requestedProvider)}
            aria-label="Requested provider"
            className="h-8 w-full rounded-lg border border-[#2b3644] bg-[#0a0f16] px-2 text-[10px] text-[#d8dee5]"
          >
            {PROVIDER_REQUESTS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void requestPreview()}
          disabled={pending !== null}
          className="secondary-action"
        >
          {pending === "preview" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
          Preview routing
        </button>
        <button
          type="button"
          onClick={() => void startRun()}
          disabled={pending !== null || !preview?.executionEnabled}
          className="secondary-action border-[#35451d] text-[#c6f135] disabled:border-[#293442] disabled:text-[#627080]"
        >
          {pending === "run" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : (
            <Sparkles className="size-3.5" aria-hidden="true" />
          )}
          Run on provider
        </button>
      </div>

      {preview && !preview.executionEnabled ? (
        <p className="mt-3 text-[10px] leading-5 text-[#b6a77f]">
          Outbound provider execution is switched off, so only the preview is available. An owner
          enables it in Settings.
        </p>
      ) : null}

      {preview ? (
        <div className="mt-3 rounded-lg border border-[#283341] bg-[#0a0f16] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={preview.decision.decision === "ROUTED" ? "safe" : "warning"}>
              {preview.decision.decision}
            </StatusBadge>
            {preview.decision.provider ? (
              <span className="font-mono text-[9px] text-[#8c99a9]">
                {preview.decision.provider} · {preview.decision.model} · {preview.decision.source}
              </span>
            ) : null}
            {preview.decision.requiresOwnerApproval ? (
              <StatusBadge tone="danger">Owner approval required</StatusBadge>
            ) : null}
          </div>
          <ul className="mt-2 space-y-1">
            {preview.decision.reasons.slice(0, 4).map((reason, index) => (
              <li key={`${reason.code}-${index}`} className="text-[10px] leading-4 text-[#6a7787]">
                <span className="font-mono text-[#849528]">{reason.code}</span> — {reason.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {run ? (
        <div className="mt-3 rounded-lg border border-[#36491d] bg-[#18220f] p-3">
          <p className="flex items-center gap-2 text-[10px] font-semibold text-[#c5dd77]">
            <CheckCircle2 className="size-3.5 text-[#c6f135]" aria-hidden="true" />
            {run.outcome} · {run.routing.provider ?? "no provider"} {run.routing.model ?? ""}
          </p>
          {run.fallback ? (
            <p className="mt-1.5 text-[10px] text-[#d7b96d]">
              Fell back from {run.fallback.fromProvider}. {run.fallback.reason}
            </p>
          ) : null}
          {run.result ? (
            <p className="mt-2 text-[10px] leading-5 text-[#9bad64]">{run.result.summary}</p>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <p className="mt-3 flex items-start gap-2 text-[10px] leading-5 text-[#e59399]" aria-live="polite">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {message}
        </p>
      ) : null}
    </div>
  );
}
