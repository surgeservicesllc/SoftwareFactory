"use client";

import { AlertTriangle, Ban, CheckCircle2, CircleDotDashed, GitBranch, Loader2, RotateCcw } from "lucide-react";
import { Children, useState } from "react";

import {
  ControlPlaneDetail,
  DetailFacts,
  ExternalEvidenceLink,
  useControlPlaneDetail,
} from "@/components/control-plane-detail";
import { TenantListShell, formatDateTime, formatDuration, riskTone, useTenantList } from "@/components/tenant-list";
import { StatusBadge } from "@/components/ui";

type Run = {
  id: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  durationMs: number | null;
  risk?: string | null;
  provider?: string | null;
  model?: string | null;
  branch?: string | null;
  project?: { id: string; name: string } | null;
  task: { id: string; title: string } | null;
  agent: { id: string; name: string } | null;
};

type RunEvent = { id?: string; stage?: string; status?: string; message?: string | null; occurredAt?: string; createdAt?: string };
type RunFile = string | { path: string; status?: string; additions?: number; deletions?: number };
type RunCommit = { sha: string; message?: string; url?: string | null };
type RunValidation = { id?: string; name?: string; kind?: string; status: string; summary?: string | null; durationMs?: number | null };
type RunCheck = { id?: string | number; name: string; status: string; conclusion?: string | null; url?: string | null };
type RunRouting = {
  source: string | null;
  policyVersion: string;
  reasons: { code: string; provider: "openai" | "anthropic" | null; detail: string }[];
  candidates: {
    provider: "openai" | "anthropic";
    model: string | null;
    eligible: boolean;
    score: number | null;
    ineligibleReasons: string[];
  }[];
};

type RunDetail = Run & {
  command?: { id: string; prompt?: string } | null;
  providerRunReference?: string | null;
  routing?: RunRouting | null;
  agent?: ({ id: string; name: string; role?: string | null } | null);
  baseBranch?: string | null;
  baseSha?: string | null;
  headBranch?: string | null;
  headSha?: string | null;
  attempt?: number | null;
  maxAttempts?: number | null;
  cancellationRequestedAt?: string | null;
  cancellable?: boolean;
  retryable?: boolean;
  summary?: string | null;
  blocker?: string | null;
  errorMessage?: string | null;
  events?: RunEvent[];
  timeline?: RunEvent[];
  files?: RunFile[];
  changedFiles?: RunFile[];
  commits?: RunCommit[];
  validations?: RunValidation[];
  pullRequest?: { number: number; title?: string; state?: string; draft?: boolean; url?: string | null } | null;
  checks?: RunCheck[];
  ci?: { status?: string; conclusion?: string | null; checks?: RunCheck[] } | null;
};

function statusTone(status: string) {
  if (["succeeded", "passed", "completed", "success"].includes(status)) return "safe";
  if (["failed", "cancelled", "blocked", "failure"].includes(status)) return "danger";
  if (["running", "in_progress"].includes(status)) return "info";
  return "neutral";
}

export function RunsConsole() {
  const { state, reload } = useTenantList<Run>(
    "/api/runs",
    (body) => (body.runs as Run[]) ?? [],
    "Runs could not be loaded.",
  );
  const detail = useControlPlaneDetail<RunDetail>("runs", "run");
  const [cancelState, setCancelState] = useState<"idle" | "pending" | "error">("idle");
  const [cancelMessage, setCancelMessage] = useState("");
  const [retryState, setRetryState] = useState<"idle" | "pending" | "error">("idle");
  const [retryMessage, setRetryMessage] = useState("");

  function openRun(runId: string) {
    setCancelState("idle");
    setCancelMessage("");
    setRetryState("idle");
    setRetryMessage("");
    void detail.open(runId);
  }

  async function requestCancellation(runId: string) {
    setCancelState("pending");
    setCancelMessage("");
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Owner requested cancellation from the SoftwareFactory Runs page." }),
      });
      const body = (await response.json()) as { error?: { message?: string }; message?: string };
      if (!response.ok) throw new Error(body.error?.message ?? "Cancellation could not be requested.");
      setCancelState("idle");
      setCancelMessage(body.message ?? "Cancellation requested. The worker will stop at the next safe boundary.");
      await Promise.all([detail.open(runId), Promise.resolve(reload())]);
    } catch (error) {
      setCancelState("error");
      setCancelMessage(error instanceof Error ? error.message : "Cancellation could not be requested.");
    }
  }

  async function requestRetry(runId: string) {
    setRetryState("pending");
    setRetryMessage("");
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Owner requested a bounded retry from the SoftwareFactory Runs page." }),
      });
      const body = await response.json() as {
        error?: { message?: string };
        message?: string;
        run?: { id?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "The run could not be retried.");
      setRetryState("idle");
      setRetryMessage(body.message ?? "Retry queued within the run's bounded attempt limit.");
      await Promise.all([detail.open(body.run?.id ?? runId), Promise.resolve(reload())]);
    } catch (error) {
      setRetryState("error");
      setRetryMessage(error instanceof Error ? error.message : "The run could not be retried.");
    }
  }

  return (
    <div className="space-y-4">
      <TenantListShell
        state={state}
        reload={reload}
        title="Runs"
        icon={GitBranch}
        signedOutTitle="Sign in to see your runs"
        signedOutDescription="Run history belongs to your workspace."
        returnPath="/solutions/runs"
        emptyTitle="Nothing has run yet"
        emptyDescription="A connected worker creates a durable run here after the orchestrator resolves a command to one exact repository."
      >
        {(runs) => (
          <ul className="divide-y divide-[var(--border)]">
            {runs.map((run) => (
              <li key={run.id} className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{run.task?.title ?? "Untitled work"}</p>
                  <p className="mt-0.5 text-sm text-muted">
                    {run.project?.name ?? "Project unavailable"} · {run.agent?.name ?? "Unassigned"} · {formatDateTime(run.startedAt ?? run.createdAt)}
                  </p>
                  <p className="mt-1 break-words text-xs text-muted">
                    {run.provider
                      ? <>Recorded target: {providerDisplayName(run.provider)}{run.model ? ` / ${run.model}` : " / model chosen at execution"}</>
                      : "No provider/model routing target is recorded for this run."}
                  </p>
                  <p className="mt-1 truncate font-mono text-xs text-faint">{run.branch ?? run.id}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 md:shrink-0">
                  {run.risk ? <StatusBadge tone={riskTone(run.risk)}>{run.risk.toUpperCase()}</StatusBadge> : null}
                  <StatusBadge tone={statusTone(run.status)}>{run.status.replace(/_/g, " ")}</StatusBadge>
                  <span className="text-sm text-muted">{formatDuration(run.durationMs)}</span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => openRun(run.id)}>
                    View run
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </TenantListShell>

      <ControlPlaneDetail
        state={detail.state}
        title="Run evidence"
        onClose={detail.close}
        onRetry={() => void detail.reload()}
      >
        {(run) => {
          const events = run.timeline ?? run.events ?? [];
          const changedFiles = run.changedFiles?.length ? run.changedFiles : run.files ?? [];
          const files = changedFiles.map((file) =>
            typeof file === "string" ? { path: file } : file,
          );
          const checks = run.ci?.checks ?? run.checks ?? [];
          const canCancel = run.cancellable === true && ["queued", "running"].includes(run.status);
          const canRetry = run.retryable === true && run.status === "failed";
          return (
            <div className="space-y-6 p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-foreground">{run.task?.title ?? "Run"}</p>
                  <p className="mt-1 text-sm text-muted">{run.command?.prompt ?? run.summary ?? "No bounded summary has been recorded yet."}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <StatusBadge tone={statusTone(run.status)}>{run.status.replace(/_/g, " ")}</StatusBadge>
                  {canCancel ? (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={cancelState === "pending"}
                      onClick={() => void requestCancellation(run.id)}
                    >
                      {cancelState === "pending" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Ban className="size-4" aria-hidden="true" />}
                      Request stop
                    </button>
                  ) : null}
                  {canRetry ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={retryState === "pending"}
                      onClick={() => void requestRetry(run.id)}
                    >
                      {retryState === "pending" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />}
                      Retry run
                    </button>
                  ) : null}
                </div>
              </div>

              {cancelMessage ? (
                <p className={`rounded-lg border p-3 text-sm ${cancelState === "error" ? "border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger)]" : "border-[var(--warning-border)] bg-[var(--warning-surface)] text-[var(--warning)]"}`} aria-live="polite">
                  {cancelMessage}
                </p>
              ) : null}

              {retryMessage ? (
                <p className={`rounded-lg border p-3 text-sm ${retryState === "error" ? "border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger)]" : "border-[var(--info-border)] bg-[var(--info-surface)] text-[var(--info)]"}`} aria-live="polite">
                  {retryMessage}
                </p>
              ) : null}

              <DetailFacts facts={[
                { label: "Project", value: run.project?.name ?? "—" },
                { label: "Agent", value: run.agent ? `${run.agent.name}${run.agent.role ? ` · ${run.agent.role}` : ""}` : "—" },
                { label: "Provider / model", value: [run.provider ? providerDisplayName(run.provider) : null, run.model].filter(Boolean).join(" / ") || "—" },
                { label: "Risk", value: run.risk?.toUpperCase() ?? "—" },
                { label: "Base", value: [run.baseBranch, shortSha(run.baseSha)].filter(Boolean).join(" @ ") || "—" },
                { label: "Branch", value: run.headBranch ?? run.branch ?? "—" },
                { label: "Attempt", value: run.attempt !== null && run.attempt !== undefined ? `${run.attempt}${run.maxAttempts ? ` of ${run.maxAttempts}` : ""}` : "—" },
                { label: "Duration", value: formatDuration(run.durationMs) },
              ]} />

              <RunRoutingEvidence run={run} />

              {(run.blocker || run.errorMessage) ? (
                <div className="flex items-start gap-2 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-surface)] p-3 text-sm text-[var(--danger)]">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <p>{run.blocker ?? run.errorMessage}</p>
                </div>
              ) : null}

              <EvidenceSection title="Timeline" empty="No run events have been recorded yet.">
                {events.map((event, index) => (
                  <li key={event.id ?? `${event.stage}-${index}`} className="flex gap-3 py-2">
                    <CircleDotDashed className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{event.stage ?? "Run event"} {event.status ? `· ${event.status}` : ""}</p>
                      {event.message ? <p className="mt-0.5 text-sm text-muted">{event.message}</p> : null}
                    </div>
                    <time className="shrink-0 text-xs text-faint" dateTime={event.occurredAt ?? event.createdAt}>{formatDateTime(event.occurredAt ?? event.createdAt ?? null)}</time>
                  </li>
                ))}
              </EvidenceSection>

              <div className="grid gap-4 lg:grid-cols-2">
                <EvidenceSection title="Validation" empty="No validation evidence has been recorded.">
                  {(run.validations ?? []).map((validation, index) => (
                    <li key={validation.id ?? `${validation.name}-${index}`} className="flex items-start justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground">{validation.name ?? validation.kind ?? "Validation"}</span>
                        {validation.summary ? <span className="mt-0.5 block text-muted">{validation.summary}</span> : null}
                      </span>
                      <StatusBadge tone={statusTone(validation.status)}>{validation.status}</StatusBadge>
                    </li>
                  ))}
                </EvidenceSection>
                <EvidenceSection title="Changed files" empty="No changed-file evidence has been recorded.">
                  {files.map((file) => (
                    <li key={file.path} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0 break-all font-mono text-foreground">{file.path}</span>
                      <span className="shrink-0 text-faint">{file.status ?? `${file.additions ?? 0}+ / ${file.deletions ?? 0}-`}</span>
                    </li>
                  ))}
                </EvidenceSection>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <EvidenceSection title="Commits" empty="No commit evidence has been recorded.">
                  {(run.commits ?? []).map((commit) => (
                    <li key={commit.sha} className="py-2 text-sm">
                      <ExternalEvidenceLink href={commit.url}>{shortSha(commit.sha) ?? commit.sha}</ExternalEvidenceLink>
                      {commit.message ? <span className="ml-2 text-muted">{commit.message}</span> : null}
                    </li>
                  ))}
                </EvidenceSection>
                <EvidenceSection title="Pull request and CI" empty="No pull request or CI evidence has been recorded.">
                  {run.pullRequest ? (
                    <li className="py-2 text-sm">
                      <ExternalEvidenceLink href={run.pullRequest.url}>PR #{run.pullRequest.number}</ExternalEvidenceLink>
                      <span className="ml-2 text-muted">{run.pullRequest.draft ? "Draft" : run.pullRequest.state ?? "Open"}</span>
                    </li>
                  ) : null}
                  {checks.map((check) => (
                    <li key={String(check.id ?? check.name)} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <ExternalEvidenceLink href={check.url}>{check.name}</ExternalEvidenceLink>
                      <span className="flex shrink-0 items-center gap-1 text-muted">
                        {check.conclusion === "success" ? <CheckCircle2 className="size-4 text-accent" aria-hidden="true" /> : null}
                        {check.status} / {check.conclusion ?? "—"}
                      </span>
                    </li>
                  ))}
                </EvidenceSection>
              </div>
            </div>
          );
        }}
      </ControlPlaneDetail>
    </div>
  );
}

function RunRoutingEvidence({ run }: { run: RunDetail }) {
  return (
    <section className="rounded-lg border border-line p-4" aria-labelledby={`run-routing-${run.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`run-routing-${run.id}`} className="font-semibold text-foreground">
          Why this provider?
        </h3>
        <StatusBadge tone={run.provider ? "info" : "neutral"}>
          {run.provider ? "Recorded" : "Not recorded"}
        </StatusBadge>
      </div>
      {run.provider ? (
        <>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="card-inset min-w-0 p-3">
              <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-faint">Selected provider</dt>
              <dd className="mt-1 break-words text-sm text-foreground">{providerDisplayName(run.provider)}</dd>
            </div>
            <div className="card-inset min-w-0 p-3">
              <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-faint">Selected model</dt>
              <dd className="mt-1 break-all text-sm text-foreground">{run.model ?? "Chosen by the provider at execution"}</dd>
            </div>
          </dl>
          {run.routing ? (
            <div className="mt-4 space-y-4">
              <p className="min-w-0 break-words text-sm text-muted">
                Source <span className="break-all font-mono text-foreground">{routingLabel(run.routing.source)}</span>
                {" · "}policy <span className="break-all font-mono text-foreground">{run.routing.policyVersion}</span>
              </p>
              <ul className="space-y-2" aria-label="Provider selection reasons">
                {run.routing.reasons.map((reason, index) => (
                  <li key={`${reason.code}-${index}`} className="card-inset min-w-0 p-3 text-sm">
                    <p className="break-words font-medium text-foreground">{reason.detail}</p>
                    <p className="mt-1 break-all font-mono text-xs text-faint">
                      {reason.code}{reason.provider ? ` · ${providerDisplayName(reason.provider)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
              {run.routing.candidates.length ? (
                <ul className="grid gap-2 sm:grid-cols-2" aria-label="Provider routing candidates">
                  {run.routing.candidates.map((candidate) => (
                    <li key={`${candidate.provider}-${candidate.model ?? "default"}`} className="card-inset min-w-0 p-3 text-sm">
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                        <span className="min-w-0 break-all font-medium text-foreground">
                          {providerDisplayName(candidate.provider)}{candidate.model ? ` / ${candidate.model}` : ""}
                        </span>
                        <StatusBadge tone={candidate.eligible ? "safe" : "neutral"}>
                          {candidate.eligible ? "Eligible" : "Ineligible"}
                        </StatusBadge>
                      </div>
                      <p className="mt-1 break-words text-xs text-faint">
                        {candidate.score === null ? "No score recorded" : `Score ${candidate.score.toFixed(3)}`}
                        {candidate.ineligibleReasons.length ? ` · ${candidate.ineligibleReasons.join(", ")}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="text-sm leading-6 text-muted">
                This is bounded durable routing evidence, not current provider-health status.
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-muted">
              This legacy run records the selected target but has no bounded routing-decision evidence.
              SoftwareFactory does not infer a source, reason, or candidate score.
            </p>
          )}
        </>
      ) : (
        <p className="mt-3 text-sm leading-6 text-muted">
          No provider/model routing target is present in this run&apos;s bounded projection. SoftwareFactory
          does not substitute a configured provider, an agent preference, or demo data for missing run evidence.
        </p>
      )}
    </section>
  );
}

function routingLabel(source: string | null) {
  if (!source) return "not recorded";
  return source.toLowerCase().replace(/_/g, " ");
}

function EvidenceSection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const entries = Children.toArray(children);
  return (
    <section className="rounded-lg border border-line p-4">
      <h3 className="font-semibold text-foreground">{title}</h3>
      {entries.length ? <ul className="mt-2 divide-y divide-[var(--border)]">{children}</ul> : <p className="mt-2 text-sm text-faint">{empty}</p>}
    </section>
  );
}

function shortSha(value?: string | null) {
  return value ? value.slice(0, 7) : null;
}

function providerDisplayName(provider: string) {
  if (provider === "anthropic") return "Anthropic / Claude";
  if (provider === "openai") return "OpenAI / Codex";
  return provider;
}
