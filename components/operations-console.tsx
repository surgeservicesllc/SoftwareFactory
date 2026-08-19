"use client";

import {
  Activity,
  AlertTriangle,
  CircleGauge,
  Loader2,
  PlugZap,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Snowflake,
  Stethoscope,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { BlockedState, Card, EmptyState, MetricCard, SectionTitle, StatusBadge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { NOT_CONNECTED_LABEL } from "@/lib/constants";
import { compareHealth, healthTone } from "@/lib/operations/health";
import { HEALTH_STATE_LABELS, SEVERITY_LABELS, isIncidentSeverity, isProjectHealthState } from "@/lib/operations/types";
import { isBrowserSupabaseConfigured } from "@/lib/supabase/browser-config";

type Summary = {
  projectsTotal: number;
  projectsHealthy: number;
  projectsDegraded: number;
  projectsCritical: number;
  projectsUnknown: number;
  projectsPaused: number;
  projectsFrozen: number;
  openIncidents: number;
  openSev1: number;
  openSev2: number;
  incidentsResolved24h: number;
  failedDeployments24h: number;
  rollbacks24h: number;
  failedRollbacks24h: number;
  repairsOpen: number;
  ownerAttention: number;
  connectedMonitors: number;
  pendingEvents: number;
};

type ProjectOperations = {
  id: string;
  name: string;
  status: string;
  healthState: string;
  healthReason: string | null;
  healthComputedAt: string | null;
  releasesFrozen: boolean;
  operationsStopped: boolean;
  ownerAttentionRequired: boolean;
  connectedMonitors: number;
  openIncidents: number;
};

type Incident = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  severity: string;
  status: string;
  source: string | null;
  symptoms: string | null;
  impact: string | null;
  occurrenceCount: number;
  detectedAt: string;
  resolvedAt: string | null;
  ownerAttentionRequired: boolean;
  rootCause: string | null;
  correctiveAction: string | null;
  autoCreated: boolean;
};

type Monitor = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  signalKind: string;
  provider: string;
  targetUrl: string | null;
  connectionState: string;
  connectionLabel: string;
  unavailableReason: string | null;
  enabled: boolean;
  lastOutcome: string;
  lastObservedAt: string | null;
  consecutiveFailures: number;
  failureThreshold: number;
};

type Provider = {
  id: string;
  label: string;
  connected: boolean;
  statusLabel: string;
  supports: string[];
  unavailableReason: string | null;
  unblockedBy: string | null;
};

type AuditEvent = {
  id: string;
  projectId: string | null;
  kind: string;
  entityType: string;
  summary: string;
  createdAt: string;
};

type Journey = {
  id: string;
  projectName: string;
  monitorId: string;
  name: string;
  profile: string;
  baseUrl: string;
  stepCount: number;
  writeSteps: number;
  enabled: boolean;
  connectionLabel: string;
  lastOutcome: string;
  lastObservedAt: string | null;
};

type Overview = {
  role: string;
  summary: Summary | null;
  projects: ProjectOperations[];
  incidents: Incident[];
  monitors: Monitor[];
  providers: Provider[];
  auditEvents: AuditEvent[];
  journeys: Journey[];
};

type State = "loading" | "signed-out" | "setup" | "ready" | "error";

function formatTime(value: string | null): string {
  if (!value) return "Never";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Unknown";
  return new Date(parsed).toLocaleString();
}

function healthLabel(state: string): string {
  return isProjectHealthState(state) ? HEALTH_STATE_LABELS[state] : "Unknown";
}

function severityLabel(severity: string): string {
  return isIncidentSeverity(severity) ? SEVERITY_LABELS[severity] : severity.toUpperCase();
}

function severityTone(severity: string): "danger" | "warning" | "neutral" {
  if (severity === "sev1") return "danger";
  if (severity === "sev2") return "warning";
  return "neutral";
}

function outcomeTone(outcome: string): "safe" | "warning" | "danger" | "neutral" {
  if (outcome === "pass") return "safe";
  if (outcome === "degraded") return "warning";
  if (outcome === "fail") return "danger";
  return "neutral";
}

export function OperationsConsole({ authenticated }: { authenticated: boolean }) {
  const supabaseConfigured = isBrowserSupabaseConfigured();
  const canLoad = supabaseConfigured && authenticated;
  const [state, setState] = useState<State>(() => (canLoad ? "loading" : "signed-out"));
  const [overview, setOverview] = useState<Overview | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canLoad) {
      setState("signed-out");
      return;
    }
    setState("loading");
    try {
      const response = await fetch("/api/operations/overview", { cache: "no-store" });
      if (response.status === 401) {
        setState("signed-out");
        return;
      }
      if (response.status === 409) {
        setState("setup");
        return;
      }
      const body = (await response.json()) as Overview & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Operations data could not be loaded.");
      setOverview(body);
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

  const post = useCallback(
    async (key: string, url: string, payload: unknown) => {
      setBusyAction(key);
      setActionError(null);
      setNotice(null);
      try {
        const response = await fetch(url, {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = (await response.json()) as { error?: { message?: string } } & Record<string, unknown>;
        if (!response.ok) {
          throw new Error(body.error?.message ?? "The action could not be completed.");
        }
        await load();
        return body;
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "The action could not be completed.");
        return null;
      } finally {
        setBusyAction(null);
      }
    },
    [load],
  );

  const sortedProjects = useMemo(
    () =>
      [...(overview?.projects ?? [])].sort((left, right) => {
        const leftState = isProjectHealthState(left.healthState) ? left.healthState : "unknown";
        const rightState = isProjectHealthState(right.healthState) ? right.healthState : "unknown";
        return compareHealth(leftState, rightState) || left.name.localeCompare(right.name);
      }),
    [overview?.projects],
  );

  const openIncidents = useMemo(
    () => (overview?.incidents ?? []).filter((incident) => incident.status !== "resolved" && incident.status !== "closed"),
    [overview?.incidents],
  );

  const isOwner = overview?.role === "owner";
  const summary = overview?.summary ?? null;
  const operationsStopped = (overview?.projects ?? []).some((project) => project.operationsStopped);

  if (state === "signed-out") {
    return (
      <BlockedState
        title="Sign in to see production operations"
        description="Operations data is read from your own tenant records and is never shown to a signed-out visitor."
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
        description="Create an organization before monitoring production."
        href="/auth/onboarding"
        label="Continue setup"
        icon={CircleGauge}
      />
    );
  }

  if (state === "error") {
    return (
      <BlockedState
        title="Operations data is unavailable"
        description="The live source could not be read. Nothing is inferred in its place."
        icon={AlertTriangle}
      />
    );
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="portfolio-title">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="portfolio-title" className="text-lg font-semibold text-foreground">
              Portfolio health
            </h2>
            <p className="mt-1 text-sm text-muted">
              Derived from connected monitors, open incidents, and deployment records only.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={state === "loading"}
            className="btn btn-secondary btn-sm"
            aria-label="Refresh operations data"
          >
            {state === "loading" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-4" aria-hidden="true" />
            )}
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Projects monitored"
            value={summary ? String(summary.connectedMonitors) : "—"}
            detail={summary ? `${summary.projectsTotal} project(s) in this organization` : "Loading"}
            icon={Activity}
            tone={summary && summary.connectedMonitors > 0 ? "safe" : "neutral"}
          />
          <MetricCard
            label="Open incidents"
            value={summary ? String(summary.openIncidents) : "—"}
            detail={summary ? `${summary.openSev1} SEV1 · ${summary.openSev2} SEV2` : "Loading"}
            icon={ShieldAlert}
            tone={summary && summary.openSev1 > 0 ? "danger" : summary && summary.openIncidents > 0 ? "warning" : "safe"}
          />
          <MetricCard
            label="Frozen projects"
            value={summary ? String(summary.projectsFrozen) : "—"}
            detail="Autonomous releases are blocked while frozen"
            icon={Snowflake}
            tone={summary && summary.projectsFrozen > 0 ? "warning" : "neutral"}
          />
          <MetricCard
            label="Needs your attention"
            value={summary ? String(summary.ownerAttention) : "—"}
            detail={summary ? `${summary.failedRollbacks24h} failed rollback(s) in 24h` : "Loading"}
            icon={AlertTriangle}
            tone={summary && summary.ownerAttention > 0 ? "danger" : "safe"}
          />
        </div>
      </section>

      {actionError ? (
        <p role="alert" className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-surface)] px-4 py-3 text-sm text-[var(--danger)]">
          {actionError}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-lg border border-line-strong bg-surface-raised px-4 py-3 text-sm text-muted">
          {notice}
        </p>
      ) : null}

      <Card className="p-5">
        <SectionTitle
          title="Projects"
          description="Every state carries the reason it was derived. A project with no connected monitor stays Unknown rather than looking healthy."
        />
        {sortedProjects.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No projects yet"
              description="Connect a repository as a project, then add a production monitor to observe it."
              actionHref="/solutions/projects"
              actionLabel="Add a project"
            />
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {sortedProjects.map((project) => (
              <li key={project.id} className="rounded-lg border border-line p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-foreground">{project.name}</h3>
                    <p className="mt-1 text-sm text-muted">{project.healthReason ?? "No health evidence yet."}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      tone={healthTone(isProjectHealthState(project.healthState) ? project.healthState : "unknown")}
                    >
                      {healthLabel(project.healthState)}
                    </StatusBadge>
                    {project.releasesFrozen ? <StatusBadge tone="warning">Releases frozen</StatusBadge> : null}
                    {project.operationsStopped ? <StatusBadge tone="danger">Operations stopped</StatusBadge> : null}
                    {project.ownerAttentionRequired ? <StatusBadge tone="danger">Owner attention</StatusBadge> : null}
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                  <div className="flex justify-between gap-2 rounded border border-line px-3 py-2">
                    <dt className="text-muted">Connected monitors</dt>
                    <dd className="tabular text-foreground">{project.connectedMonitors}</dd>
                  </div>
                  <div className="flex justify-between gap-2 rounded border border-line px-3 py-2">
                    <dt className="text-muted">Open incidents</dt>
                    <dd className="tabular text-foreground">{project.openIncidents}</dd>
                  </div>
                  <div className="flex justify-between gap-2 rounded border border-line px-3 py-2">
                    <dt className="text-muted">Last checked</dt>
                    <dd className="text-foreground">{formatTime(project.healthComputedAt)}</dd>
                  </div>
                </dl>
                {isOwner ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busyAction !== null || project.releasesFrozen}
                      onClick={() =>
                        void post(`freeze-${project.id}`, "/api/operations/controls", {
                          action: "freeze",
                          projectId: project.id,
                          reason: "Owner requested a release freeze from the Operations console.",
                        })
                      }
                    >
                      <Snowflake className="size-4" aria-hidden="true" />
                      Freeze releases
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busyAction !== null || !project.releasesFrozen}
                      onClick={() =>
                        void post(`resume-${project.id}`, "/api/operations/controls", {
                          action: "resume",
                          projectId: project.id,
                          note: "Owner resumed releases from the Operations console after review.",
                          acknowledgeOpenIncidents: true,
                        })
                      }
                    >
                      <ShieldCheck className="size-4" aria-hidden="true" />
                      Resume releases
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <SectionTitle
          title="Incidents"
          description="Repeated signals fold into one incident. An incident closes only with a recorded cause, corrective action, and passing validation."
        />
        {openIncidents.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No open incidents"
              description="Incidents appear here automatically when a connected monitor breaches its failure threshold."
            />
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {openIncidents.map((incident) => (
              <li key={incident.id} className="rounded-lg border border-line p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-foreground">{incident.title}</h3>
                    <p className="mt-1 text-sm text-muted">
                      {incident.projectName} · detected {formatTime(incident.detectedAt)} ·{" "}
                      {incident.occurrenceCount} occurrence{incident.occurrenceCount === 1 ? "" : "s"}
                    </p>
                    {incident.symptoms ? (
                      <p className="mt-2 text-sm text-muted">{incident.symptoms}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={severityTone(incident.severity)}>{severityLabel(incident.severity)}</StatusBadge>
                    <StatusBadge tone="neutral">{incident.status}</StatusBadge>
                    {incident.autoCreated ? <StatusBadge tone="info">Detected automatically</StatusBadge> : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busyAction !== null}
                    onClick={async () => {
                      const body = await post(`diagnose-${incident.id}`, `/api/operations/incidents/${incident.id}/diagnose`, {});
                      const diagnosis = body?.diagnosis as { likelyCause?: string; confidence?: string } | undefined;
                      if (diagnosis?.likelyCause) {
                        setNotice(`Diagnosis (${diagnosis.confidence} confidence): ${diagnosis.likelyCause}`);
                      }
                    }}
                  >
                    <Stethoscope className="size-4" aria-hidden="true" />
                    Diagnose
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busyAction !== null}
                    onClick={async () => {
                      const body = await post(`repair-${incident.id}`, `/api/operations/incidents/${incident.id}/repair`, {});
                      if (body?.created) {
                        setNotice("Repair work was created and left unassigned — no execution worker is connected.");
                      }
                    }}
                  >
                    <Wrench className="size-4" aria-hidden="true" />
                    Create repair work
                  </button>
                  {isOwner ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busyAction !== null}
                      onClick={async () => {
                        const body = await post(
                          `rollback-${incident.id}`,
                          `/api/operations/incidents/${incident.id}/rollback`,
                          { confirmation: "EVALUATE ROLLBACK" },
                        );
                        const blockers = (body?.blockers ?? []) as { code: string }[];
                        if (blockers.length) {
                          setNotice(`Rollback recorded as blocked: ${blockers.map((blocker) => blocker.code).join(", ")}.`);
                        }
                      }}
                    >
                      <ShieldAlert className="size-4" aria-hidden="true" />
                      Evaluate rollback
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <SectionTitle
            title="Monitors"
            description="Only a monitor with a connected adapter can record a signal."
          />
          {(overview?.monitors ?? []).length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="No monitors configured"
                description="Add a monitor to a project to start observing production."
              />
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {(overview?.monitors ?? []).map((monitor) => (
                <li key={monitor.id} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{monitor.name}</p>
                      <p className="text-sm text-muted">
                        {monitor.projectName} · {monitor.signalKind} · {monitor.provider}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={monitor.connectionState === "connected" ? "safe" : "danger"}>
                        {monitor.connectionLabel}
                      </StatusBadge>
                      <StatusBadge tone={outcomeTone(monitor.lastOutcome)}>{monitor.lastOutcome}</StatusBadge>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-faint">
                    {monitor.connectionState === "connected"
                      ? `Last observed ${formatTime(monitor.lastObservedAt)} · ${monitor.consecutiveFailures}/${monitor.failureThreshold} consecutive failures`
                      : (monitor.unavailableReason ?? NOT_CONNECTED_LABEL)}
                  </p>
                  {monitor.connectionState === "connected" ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm mt-2"
                      disabled={busyAction !== null}
                      onClick={async () => {
                        const body = await post(`run-${monitor.id}`, `/api/operations/monitors/${monitor.id}/run`, {});
                        const observation = body?.observation as { outcome?: string; thresholdBreached?: boolean } | undefined;
                        if (observation?.outcome) {
                          setNotice(
                            observation.thresholdBreached
                              ? `Check returned ${observation.outcome} and breached the failure threshold.`
                              : `Check returned ${observation.outcome}.`,
                          );
                        }
                      }}
                    >
                      {busyAction === `run-${monitor.id}` ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Activity className="size-4" aria-hidden="true" />
                      )}
                      Run check now
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <SectionTitle
            title="Monitoring providers"
            description="What SoftwareFactory can and cannot observe today, and what would change that."
          />
          <ul className="mt-4 space-y-2">
            {(overview?.providers ?? []).map((provider) => (
              <li key={provider.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-foreground">{provider.label}</p>
                  <StatusBadge tone={provider.connected ? "safe" : "danger"}>{provider.statusLabel}</StatusBadge>
                </div>
                <p className="mt-2 text-sm text-muted">
                  {provider.connected
                    ? `Observes: ${provider.supports.join(", ")}.`
                    : (provider.unavailableReason ?? NOT_CONNECTED_LABEL)}
                </p>
                {!provider.connected && provider.unblockedBy ? (
                  <p className="mt-1 text-sm text-faint">Needs: {provider.unblockedBy}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="p-5">
        <SectionTitle
          title="Synthetic journeys"
          description="Project-defined production checks. Destructive steps are refused, and a declared write is recorded but never issued against production."
        />
        {(overview?.journeys ?? []).length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No synthetic journeys defined"
              description="Add a synthetic monitor and define its Basic, Standard, or Critical journey to check real user paths."
            />
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {(overview?.journeys ?? []).map((journey) => (
              <li key={journey.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{journey.name}</p>
                    <p className="text-sm text-muted">
                      {journey.projectName} · {journey.profile} profile · {journey.stepCount} step
                      {journey.stepCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={journey.connectionLabel === "Connected" ? "safe" : "danger"}>
                      {journey.connectionLabel}
                    </StatusBadge>
                    <StatusBadge tone={outcomeTone(journey.lastOutcome)}>{journey.lastOutcome}</StatusBadge>
                  </div>
                </div>
                <p className="mt-2 text-sm text-faint">
                  Last run {formatTime(journey.lastObservedAt)}
                  {journey.writeSteps > 0
                    ? ` · ${journey.writeSteps} declared write step${journey.writeSteps === 1 ? "" : "s"} recorded but not executed`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <SectionTitle
          title="Operations audit"
          description="Immutable evidence for every detection, freeze, rollback decision, repair, and resolution."
        />
        {(overview?.auditEvents ?? []).length === 0 ? (
          <div className="mt-4">
            <EmptyState title="No operations events yet" description="Evidence appears here as soon as a monitor reports." />
          </div>
        ) : (
          <ul className="mt-4 space-y-1.5">
            {(overview?.auditEvents ?? []).map((event) => (
              <li
                key={event.id}
                className={cn(
                  "flex flex-wrap items-baseline justify-between gap-2 rounded border border-line px-3 py-2 text-sm",
                )}
              >
                <span className="font-medium text-foreground">{event.kind}</span>
                <span className="min-w-0 flex-1 text-muted">{event.summary}</span>
                <span className="tabular text-faint">{formatTime(event.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {isOwner ? (
        <Card className="p-5">
          <SectionTitle
            title="Emergency controls"
            description="Stopping autonomous operations freezes every project in this organization and flags them for your review. Resuming clears that stop; each release freeze is still released on its own evidence."
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busyAction !== null || operationsStopped}
              onClick={() =>
                void post("stop-all", "/api/operations/controls", {
                  action: "stop",
                  reason: "Owner stopped autonomous operations from the Operations console.",
                })
              }
            >
              <PlugZap className="size-4" aria-hidden="true" />
              Stop autonomous operations
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busyAction !== null || !operationsStopped}
              onClick={() =>
                void post("resume-all", "/api/operations/controls", {
                  action: "resume_operations",
                  note: "Owner resumed autonomous operations from the Operations console after review.",
                })
              }
            >
              <ShieldCheck className="size-4" aria-hidden="true" />
              Resume autonomous operations
            </button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
