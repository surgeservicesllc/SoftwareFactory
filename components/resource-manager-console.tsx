"use client";

import {
  AlertTriangle,
  CircuitBoard,
  Cpu,
  Gauge,
  History,
  PlugZap,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { BlockedState, Card, EmptyState, MetricCard, SectionTitle, StatusBadge } from "@/components/ui";
import { NOT_CONNECTED_LABEL } from "@/lib/constants";
import { isBrowserSupabaseConfigured } from "@/lib/supabase/browser-config";

/**
 * What the Resource Manager knows, and — more often — what it does not.
 *
 * The hard part of this console is that almost everything in it is legitimately
 * empty. No provider run has executed, so no worker has been routed and no
 * performance has been observed. Every empty panel therefore says which kind of
 * empty it is: "nothing has failed here" is not "this is healthy", and "no
 * recorded decisions" is not "routing is working and quiet".
 */

type Breaker = {
  target: string;
  state: "closed" | "open" | "half_open";
  fault: string | null;
  faultExplanation: string | null;
  consecutiveFaults: number;
  openedAt: string | null;
  cooldownMs: number | null;
  reason: string | null;
  updatedAt: string;
};

type Transition = {
  target: string;
  fromState: string;
  toState: string;
  fault: string | null;
  reason: string | null;
  occurredAt: string;
};

type Candidate = {
  agentId?: string;
  provider?: string;
  model?: string;
  eligible?: boolean;
  score?: number;
  rejections?: string[];
  notes?: string[];
};

type Assignment = {
  id: string;
  projectId: string;
  nodeId: string;
  decision: string;
  objective: string;
  mode: string;
  agentId: string | null;
  provider: string | null;
  model: string | null;
  reason: string;
  policyVersion: string;
  candidates: Candidate[];
  predictedSuccessRate: number | null;
  predictionEvidenced: boolean;
  decidedAt: string;
};

type ModelDeclaration = {
  provider: string;
  model: string;
  enabled: boolean;
  strengthTier: string | null;
  contextLimitTokens: number | null;
  fullyDeclared: boolean;
};

type Overview = {
  policyVersion: string;
  capabilities: string[];
  executionState: string;
  executionLabel: string;
  executionReason: string;
  breakers: Breaker[];
  transitions: Transition[];
  assignments: Assignment[];
};

type State = "loading" | "ready" | "signed-out" | "setup" | "error";

const BREAKER_STATE_LABELS: Record<Breaker["state"], string> = {
  closed: "Closed",
  open: "Open",
  half_open: "Half open",
};

const DECISION_LABELS: Record<string, string> = {
  ASSIGNED: "Assigned",
  DETERMINISTIC_NO_MODEL_REQUIRED: "No model needed",
  NO_ELIGIBLE_WORKER: "No eligible worker",
  REQUESTED_WORKER_INELIGIBLE: "Requested worker ineligible",
};

function breakerTone(state: Breaker["state"]): "safe" | "warning" | "danger" {
  if (state === "open") return "danger";
  if (state === "half_open") return "warning";
  return "safe";
}

function formatWhen(value: string | null): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "—";
  return new Date(parsed).toLocaleString();
}

function formatCooldown(ms: number | null): string {
  if (ms === null) return "—";
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)}s`;
}

export function ResourceManagerConsole({ authenticated }: { authenticated: boolean }) {
  const supabaseConfigured = isBrowserSupabaseConfigured();
  const canLoad = supabaseConfigured && authenticated;
  const [state, setState] = useState<State>(() => (canLoad ? "loading" : "signed-out"));
  const [overview, setOverview] = useState<Overview | null>(null);
  const [models, setModels] = useState<ModelDeclaration[] | null>(null);

  const load = useCallback(async () => {
    if (!canLoad) {
      setState("signed-out");
      return;
    }
    setState("loading");
    try {
      const response = await fetch("/api/resources/overview", { cache: "no-store" });
      if (response.status === 401) {
        setState("signed-out");
        return;
      }
      if (response.status === 409) {
        setState("setup");
        return;
      }
      const body = (await response.json()) as Overview & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Resource manager state could not be loaded.");
      setOverview(body);

      // Declarations load separately and are allowed to fail without taking the
      // page down: not knowing which models are declared is worse than the rest
      // of the console being unavailable, but it is not the same failure.
      try {
        const modelResponse = await fetch("/api/resources/models", { cache: "no-store" });
        if (modelResponse.ok) {
          const modelBody = (await modelResponse.json()) as { models?: ModelDeclaration[] };
          setModels(modelBody.models ?? []);
        } else {
          setModels(null);
        }
      } catch {
        setModels(null);
      }

      setState("ready");
    } catch {
      setState("error");
    }
  }, [canLoad]);

  useEffect(() => {
    if (!canLoad) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [canLoad, load]);

  if (state === "signed-out") {
    return (
      <BlockedState
        title="Sign in to see routing state"
        description="Routing decisions and circuit breakers are read from your own tenant records and are never shown to a signed-out visitor."
        href="/auth/sign-in"
        label="Sign in"
        icon={ShieldCheck}
      />
    );
  }

  if (state === "setup") {
    return (
      <BlockedState
        title="Finish setting up your organization"
        description="Create an organization before routing work to agents and models."
        href="/auth/onboarding"
        label="Continue setup"
        icon={Cpu}
      />
    );
  }

  if (state === "error") {
    return (
      <BlockedState
        title="Resource manager state is unavailable"
        description="The live source could not be read. Nothing is inferred in its place."
        icon={AlertTriangle}
      />
    );
  }

  const openBreakers = (overview?.breakers ?? []).filter((breaker) => breaker.state !== "closed");
  const assignments = overview?.assignments ?? [];
  const capabilities = overview?.capabilities ?? [];

  return (
    <div className="space-y-8">
      <section aria-labelledby="routing-summary-title">
        <h2 id="routing-summary-title" className="sr-only">
          Routing summary
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Recorded decisions"
            value={state === "loading" ? "—" : String(assignments.length)}
            detail={
              assignments.length === 0
                ? "No work has been routed yet."
                : "Most recent routing decisions, newest first."
            }
            icon={Sparkles}
            tone={assignments.length === 0 ? "neutral" : "info"}
          />
          <MetricCard
            label="Open circuit breakers"
            value={state === "loading" ? "—" : String(openBreakers.length)}
            detail={
              (overview?.breakers ?? []).length === 0
                ? "Nothing has failed here. That is not the same as proven healthy."
                : "A provider or model currently suppressed after repeated faults."
            }
            icon={CircuitBoard}
            tone={openBreakers.length > 0 ? "danger" : "safe"}
          />
          <MetricCard
            label="Declared capabilities"
            value={state === "loading" ? "—" : String(capabilities.length)}
            detail="Declared per agent and per model. A declaration is not a measurement."
            icon={Gauge}
          />
          <MetricCard
            label="Execution"
            // "Not Connected" is a state we read, not a default to fall back
            // to. Showing it before the response lands would state a fact we
            // have not established yet, and would be indistinguishable from
            // having established it.
            value={state === "loading" ? "—" : (overview?.executionLabel ?? NOT_CONNECTED_LABEL)}
            detail={
              state === "loading"
                ? "Reading recorded routing state."
                : (overview?.executionReason ?? "No provider run has executed.")
            }
            icon={PlugZap}
            tone={state === "loading" ? "neutral" : "warning"}
          />
        </div>
      </section>

      <Card className="p-5">
        <SectionTitle
          title="Circuit breakers"
          description="Only observed failures open a breaker. A target with no row has never failed here."
        />
        <div className="mt-4">
          {(overview?.breakers ?? []).length === 0 ? (
            <EmptyState
              icon={CircuitBoard}
              title="No observed provider faults"
              description="No fault has been recorded for any provider or model. This means nothing has failed here, not that any provider has been proven healthy."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-faint">
                  <tr>
                    <th scope="col" className="py-2 pr-4 font-medium">Target</th>
                    <th scope="col" className="py-2 pr-4 font-medium">State</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Fault</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Consecutive</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Cooldown</th>
                    <th scope="col" className="py-2 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(overview?.breakers ?? []).map((breaker) => (
                    <tr key={breaker.target}>
                      <th scope="row" className="py-3 pr-4 font-medium text-foreground">{breaker.target}</th>
                      <td className="py-3 pr-4">
                        <StatusBadge tone={breakerTone(breaker.state)}>
                          {BREAKER_STATE_LABELS[breaker.state]}
                        </StatusBadge>
                      </td>
                      <td className="py-3 pr-4 text-muted">
                        {breaker.faultExplanation ?? breaker.fault ?? "—"}
                      </td>
                      <td className="tabular py-3 pr-4 text-muted">{breaker.consecutiveFaults}</td>
                      <td className="py-3 pr-4 text-muted">{formatCooldown(breaker.cooldownMs)}</td>
                      <td className="py-3 text-muted">{formatWhen(breaker.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle
          title="Why this worker was selected"
          description="Each decision records the objective, the mode, the named reason, and every candidate that was considered."
        />
        <div className="mt-4 space-y-4">
          {assignments.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="No routing decisions recorded"
              description="No provider run has executed, so nothing has been routed. This panel fills in once real work passes through the resource manager."
            />
          ) : (
            assignments.map((assignment) => (
              <article key={assignment.id} className="rounded-lg border border-line p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">
                      {assignment.decision === "ASSIGNED"
                        ? `${assignment.agentId} · ${assignment.provider}/${assignment.model}`
                        : (DECISION_LABELS[assignment.decision] ?? assignment.decision)}
                    </p>
                    <p className="mt-1 text-sm text-muted">{assignment.reason}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <StatusBadge tone={assignment.decision === "ASSIGNED" ? "safe" : "neutral"}>
                      {DECISION_LABELS[assignment.decision] ?? assignment.decision}
                    </StatusBadge>
                    <StatusBadge tone="info" dot={false}>{assignment.objective}</StatusBadge>
                    <StatusBadge tone="neutral" dot={false}>{assignment.mode}</StatusBadge>
                  </div>
                </div>

                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-faint">Predicted success</dt>
                    {/* An unevidenced prediction shows no number at all. Zero
                        would read as a measurement nobody made. */}
                    <dd className="tabular mt-1 text-foreground">
                      {assignment.predictionEvidenced && assignment.predictedSuccessRate !== null
                        ? `${Math.round(assignment.predictedSuccessRate * 100)}%`
                        : "No recorded history"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-faint">Candidates considered</dt>
                    <dd className="tabular mt-1 text-foreground">{assignment.candidates.length}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-faint">Decided</dt>
                    <dd className="mt-1 text-foreground">{formatWhen(assignment.decidedAt)}</dd>
                  </div>
                </dl>

                {assignment.candidates.length > 0 ? (
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {assignment.candidates.map((candidate, index) => (
                      <li
                        key={`${assignment.id}-${candidate.agentId ?? index}-${candidate.model ?? index}`}
                        className="flex flex-wrap items-center gap-2 text-muted"
                      >
                        <StatusBadge tone={candidate.eligible ? "safe" : "neutral"} dot={false}>
                          {candidate.eligible ? "Eligible" : "Ineligible"}
                        </StatusBadge>
                        <span className="text-foreground">
                          {candidate.agentId} · {candidate.provider}/{candidate.model}
                        </span>
                        {typeof candidate.score === "number" ? (
                          <span className="tabular text-faint">score {candidate.score.toFixed(3)}</span>
                        ) : null}
                        {(candidate.rejections ?? []).length > 0 ? (
                          <span className="text-faint">{(candidate.rejections ?? []).join(", ")}</span>
                        ) : null}
                        {(candidate.notes ?? []).length > 0 ? (
                          <span className="text-faint">{(candidate.notes ?? []).join(", ")}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))
          )}
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle
          title="Breaker transitions"
          description="Only real state changes are recorded. A fault below its threshold changes nothing and is deliberately not listed."
        />
        <div className="mt-4">
          {(overview?.transitions ?? []).length === 0 ? (
            <EmptyState
              icon={History}
              title="No breaker has changed state"
              description="No provider or model has crossed a fault threshold or recovered from one."
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {(overview?.transitions ?? []).map((transition, index) => (
                <li
                  key={`${transition.target}-${transition.occurredAt}-${index}`}
                  className="flex flex-wrap items-center gap-2"
                >
                  <span className="font-medium text-foreground">{transition.target}</span>
                  <span className="text-faint">
                    {transition.fromState} → {transition.toState}
                  </span>
                  {transition.reason ? <span className="text-muted">{transition.reason}</span> : null}
                  <span className="ml-auto text-faint">{formatWhen(transition.occurredAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle
          title="Model declarations"
          description="Routing refuses a model until an owner declares its strength and context limit. Undeclared is not assumed capable."
        />
        <div className="mt-4">
          {models === null ? (
            <EmptyState
              icon={Cpu}
              title="Model declarations could not be read"
              description="The rest of this page loaded. Nothing is inferred about which models are declared."
            />
          ) : models.length === 0 ? (
            <EmptyState
              icon={Cpu}
              title="No models configured"
              description="This organization has no model catalogue yet, so there is nothing to route work onto."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[38rem] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-faint">
                  <tr>
                    <th scope="col" className="py-2 pr-4 font-medium">Model</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Strength</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Context limit</th>
                    <th scope="col" className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {models.map((entry) => (
                    <tr key={`${entry.provider}/${entry.model}`}>
                      <th scope="row" className="py-3 pr-4 font-medium text-foreground">
                        {entry.provider}/{entry.model}
                      </th>
                      {/* Undeclared shows as "Undeclared", never as a guessed
                          default — that distinction is the whole reason routing
                          refuses these. */}
                      <td className="py-3 pr-4 text-muted">{entry.strengthTier ?? "Undeclared"}</td>
                      <td className="tabular py-3 pr-4 text-muted">
                        {entry.contextLimitTokens === null
                          ? "Undeclared"
                          : entry.contextLimitTokens.toLocaleString()}
                      </td>
                      <td className="py-3">
                        <StatusBadge tone={entry.fullyDeclared && entry.enabled ? "safe" : "warning"}>
                          {!entry.enabled
                            ? "Disabled"
                            : entry.fullyDeclared
                              ? "Routable"
                              : "Refused until declared"}
                        </StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle
          title="Capability vocabulary"
          description={`Declared work capabilities matched per agent and per model. Policy ${overview?.policyVersion ?? "—"}.`}
        />
        <ul className="mt-4 flex flex-wrap gap-2">
          {capabilities.map((capability) => (
            <li key={capability}>
              <StatusBadge tone="neutral" dot={false}>{capability.replace(/_/g, " ")}</StatusBadge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
