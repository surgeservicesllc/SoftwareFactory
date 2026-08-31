"use client";

import {
  Activity,
  AlertTriangle,
  Bot,
  Box,
  ChevronRight,
  CircleStop,
  Code2,
  FlaskConical,
  GitCompareArrows,
  Loader2,
  MessageSquarePlus,
  PackageCheck,
  Pause,
  Play,
  RefreshCw,
  Rocket,
  Send,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { FactoryShell, type FactoryViewer } from "@/components/graph/factory-shell";
import { StatusBadge } from "@/components/ui";
import { cn } from "@/lib/cn";
import type {
  GrokArtifact,
  GrokControlAction,
  GrokSession,
  GrokSessionDetail,
  GrokSessionListResponse,
} from "@/lib/grok/contracts";
import { FACTORY_STEPS } from "@/lib/sdlc/factory-steps";

type Project = { readonly id: string; readonly name: string; readonly connectionStatus?: string };
type LoadState = "loading" | "ready" | "signed-out" | "setup" | "error";
type InspectorTab = "goal" | "plan" | "agents" | "progress" | "files" | "tests" | "preview" | "artifacts" | "deployment";
type GrokCreateResponse = GrokSessionDetail & Readonly<{
  workerWoken: boolean;
  executionStarted: boolean;
  blocked?: Readonly<{ code: string; message: string }>;
}>;
type GrokControlResponse = GrokSessionDetail & Readonly<{
  control: Readonly<{ intentId: string; action: GrokControlAction; state: string }>;
  replayed: boolean;
  workerWoken: boolean;
  note?: string;
}>;

export type GrokSelection = {
  readonly projectId?: string;
  readonly sessionId?: string;
  readonly graphId?: string;
  readonly graphRunId?: string;
};

const STARTERS = ["Build me…", "Fix…", "Research…", "Test…", "Deploy…"] as const;
const POLLING_STATUSES = new Set([
  "active",
  "planning",
  "planned",
  "ready",
  "queued",
  "running",
  "verifying",
  "paused",
  "awaiting_approval",
]);
type RenderedGrokControlAction = Extract<GrokControlAction, "pause" | "resume" | "stop">;
const CONTROL_ACTIONS: readonly RenderedGrokControlAction[] = ["pause", "resume", "stop"];
const BLOCKED_FALLBACK = "The session and plan are saved, but no graph or worker execution has started.";
const UNPLANNED_FALLBACK = "The request is saved, but no plan was recorded. No graph, worker, or provider started.";

const tabs: ReadonlyArray<{ key: InspectorTab; label: string; icon: typeof Target }> = [
  { key: "goal", label: "Goal", icon: Target },
  { key: "plan", label: "Plan", icon: Code2 },
  { key: "agents", label: "Agents", icon: Users },
  { key: "progress", label: "Progress", icon: Activity },
  { key: "files", label: "Files / Diffs", icon: GitCompareArrows },
  { key: "tests", label: "Tests", icon: FlaskConical },
  { key: "preview", label: "Preview", icon: PackageCheck },
  { key: "artifacts", label: "Artifacts", icon: Box },
  { key: "deployment", label: "Deployment", icon: Rocket },
];

function clock(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function safeArtifactHref(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function statusTone(status: string): "safe" | "info" | "warning" | "danger" | "neutral" {
  const normalized = status.toLowerCase();
  if (normalized === "completed") return "safe";
  if (["failed", "cancelled", "stopped", "budget_stopped"].includes(normalized)) return "danger";
  if (["blocked", "paused", "awaiting_approval", "partial"].includes(normalized)) return "warning";
  if (POLLING_STATUSES.has(normalized)) return "info";
  return "neutral";
}

function executionNotice(detail: GrokSessionDetail | null) {
  if (!detail) return "";
  const hasPlan = detail.tasks.length > 0;
  if (detail.session.status.toLowerCase() === "blocked") {
    return hasPlan ? BLOCKED_FALLBACK : UNPLANNED_FALLBACK;
  }
  if (!detail.session.graphId) {
    return hasPlan
      ? "This durable session has no linked graph. A saved plan is not evidence that a worker or provider started."
      : UNPLANNED_FALLBACK;
  }
  if (!detail.session.graphRunId) {
    return "The graph is recorded, but no durable run evidence is linked yet.";
  }
  return "";
}

function messageRoleLabel(role: GrokSessionDetail["messages"][number]["role"]) {
  if (role === "user") return "You";
  if (role === "assistant") return "Chief of Staff";
  if (role === "tool") return "Recorded tool evidence";
  return "System";
}

function selectionQuery(selection: GrokSelection) {
  const params = new URLSearchParams();
  if (selection.projectId) params.set("projectId", selection.projectId);
  if (selection.sessionId) params.set("sessionId", selection.sessionId);
  if (selection.graphId) params.set("graphId", selection.graphId);
  if (selection.graphRunId) params.set("graphRunId", selection.graphRunId);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function updateUrl(selection: GrokSelection) {
  const query = selectionQuery(selection);
  window.history.replaceState(null, "", `/solutions/factory/grok${query}`);
}

class GrokRequestError extends Error {
  readonly status: number;
  readonly sessionId: string | null;

  constructor(message: string, status: number, sessionId: string | null) {
    super(message);
    this.name = "GrokRequestError";
    this.status = status;
    this.sessionId = sessionId;
  }
}

async function readJson(response: Response) {
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (response.ok) throw error;
    body = {};
  }
  if (!response.ok) {
    const message = (body as { error?: { message?: string } }).error?.message;
    const sessionId = (body as { sessionId?: unknown }).sessionId;
    throw new GrokRequestError(
      message ?? "Grok Bot could not complete that request.",
      response.status,
      typeof sessionId === "string" ? sessionId : null,
    );
  }
  return body;
}

function sessionHeadline(session: GrokSession, detail: GrokSessionDetail | null) {
  if (session.graphRunId) return "Durable session · run evidence linked";
  if (session.graphId) return "Durable session · graph recorded; no run evidence yet";
  if (detail?.session.id === session.id) {
    return detail.tasks.length === 0
      ? "Durable session · request saved; no plan recorded"
      : "Durable session · plan saved; execution not linked";
  }
  return "Durable session · loading recorded evidence";
}

function sessionListStatus(session: GrokSession, detail: GrokSessionDetail | null) {
  return detail?.session.id === session.id && detail.tasks.length === 0
    ? "request saved; no plan recorded"
    : session.status;
}

function EmptyInspector({ label }: { label: string }) {
  return (
    <div className="grid min-h-40 place-items-center rounded-lg border border-dashed border-[var(--border-strong)] p-5 text-center">
      <div>
        <PackageCheck className="mx-auto size-5 text-faint" aria-hidden="true" />
        <p className="mt-2 text-sm font-medium text-foreground">No {label.toLowerCase()} recorded</p>
        <p className="mt-1 text-xs text-muted">This pane fills only from durable recorded evidence.</p>
      </div>
    </div>
  );
}

function ArtifactList({ artifacts, emptyLabel }: { artifacts: readonly GrokArtifact[]; emptyLabel: string }) {
  if (artifacts.length === 0) return <EmptyInspector label={emptyLabel} />;
  return (
    <ul className="space-y-2">
      {artifacts.map((artifact) => (
        <li key={artifact.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] p-3">
          <p className="text-sm font-medium text-foreground">{artifact.label}</p>
          <p className="mt-1 text-xs text-muted">{artifact.kind} · {clock(artifact.createdAt)}</p>
          {safeArtifactHref(artifact.uri) ? (
            <a
              aria-label={`Open ${artifact.label}`}
              className="mt-2 inline-flex text-xs font-medium text-[var(--accent-text)] hover:underline"
              href={safeArtifactHref(artifact.uri) ?? undefined}
            >
              Open artifact
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function EvidenceLink({ href, children }: { href: string | null; children: string }) {
  const safeHref = safeArtifactHref(href);
  return safeHref ? (
    <a className="font-medium text-[var(--accent-text)] hover:underline" href={safeHref}>{children}</a>
  ) : <span>{children}</span>;
}

function NotConnected({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-foreground">{label}</p>
        <StatusBadge tone="neutral">Not Connected</StatusBadge>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted">{detail}</p>
    </div>
  );
}

function Inspector({ detail, tab }: { detail: GrokSessionDetail | null; tab: InspectorTab }) {
  if (!detail) return <EmptyInspector label={tabs.find((entry) => entry.key === tab)?.label ?? "evidence"} />;

  if (tab === "goal") {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] p-3">
          <p className="label">Outcome</p>
          <p className="mt-2 text-sm leading-6 text-foreground">{detail.session.goal}</p>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div><dt className="text-muted">Project</dt><dd className="mt-1 text-foreground">{detail.session.projectName}</dd></div>
          <div><dt className="text-muted">Status</dt><dd className="mt-1"><StatusBadge tone={statusTone(detail.session.status)}>{detail.session.status}</StatusBadge></dd></div>
        </dl>
      </div>
    );
  }

  if (tab === "plan") {
    if (!detail.tasks.length) return <EmptyInspector label="plan" />;
    return (
      <ol className="space-y-2">
        {detail.tasks.map((task, index) => (
          <li key={task.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] p-3">
            <div className="flex items-start gap-2">
              <span className="grid size-5 shrink-0 place-items-center rounded-full border border-[var(--border-strong)] text-[10px] text-muted">{index + 1}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{task.title}</p>
                <p className="mt-1 text-xs text-muted">{task.status}{task.dependsOn.length ? ` · after ${task.dependsOn.join(", ")}` : " · can start immediately"}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>
    );
  }

  if (tab === "agents") {
    const hasObservedRun = Boolean(detail.session.graphRunId);
    const hasPlan = detail.tasks.length > 0;
    const assigned = detail.tasks.filter((task) => task.provider || task.agentName);
    return (
      <div>
        <p className="text-xs font-semibold text-foreground">
          {hasObservedRun
            ? "Observed node execution route"
            : hasPlan
              ? "Planned routing intent"
              : "No routing plan recorded"}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted">
          {hasObservedRun
            ? "Provider, model, state, and attempt come from recorded node-run evidence. No bot account or worker-process identity was recorded."
            : hasPlan
              ? "Provider, model, and agent values below come from the saved plan; they do not prove execution."
              : "No provider, model, or agent routing identity was recorded, and no provider started."}
        </p>
        {assigned.length ? (
          <ul className="mt-3 space-y-2">
            {assigned.map((task) => (
              <li key={task.id} className="flex items-start gap-3 rounded-lg border border-[var(--border)] p-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--accent-surface)] text-[var(--accent-text)]"><Bot className="size-4" aria-hidden="true" /></span>
                <div className="min-w-0"><p className="truncate text-sm font-medium text-foreground">{hasObservedRun ? task.provider : task.agentName ?? task.provider}</p><p className="mt-0.5 truncate text-xs text-muted">{task.title}{task.model ? ` · ${task.model}` : ""}{hasObservedRun ? ` · ${task.status}${task.attempt === null || task.attempt === undefined ? "" : ` · attempt ${task.attempt}`}` : ""}</p></div>
              </li>
            ))}
          </ul>
        ) : <div className="mt-3"><EmptyInspector label={hasObservedRun ? "observed execution routes" : hasPlan ? "planned routing identities" : "routing identities"} /></div>}
      </div>
    );
  }

  if (tab === "progress") {
    const run = detail.runEvidence;
    const progressEvents = run
      ? [...run.events, ...detail.events].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      : detail.events;
    if (!run && !progressEvents.length) return <EmptyInspector label="progress events" />;
    return (
      <div className="space-y-4">
        {run ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] p-3">
            <div className="flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-foreground">{run.progress.completed} of {run.progress.total} nodes complete</span><span className="text-muted">{run.progress.percent}%</span></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface)]"><div className="h-full bg-[var(--accent)]" style={{ width: `${run.progress.percent}%` }} /></div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div><dt className="text-muted">Tokens</dt><dd className="mt-1 text-foreground">{run.tokensUsed === null ? "Not recorded" : run.tokensUsed.toLocaleString()}</dd></div>
              <div><dt className="text-muted">Cost</dt><dd className="mt-1 text-foreground">{run.costMicros === null ? "Not recorded" : `$${(run.costMicros / 1_000_000).toFixed(4)}`}</dd></div>
            </dl>
            {run.closureNote ? <p className="mt-3 text-xs leading-5 text-muted">{run.closureNote}</p> : null}
          </div>
        ) : null}
        {detail.eventsTruncated ? <p className="text-xs text-muted">Newest 200 Grok session events shown.</p> : null}
        {run?.eventsTruncated ? <p className="text-xs text-muted">Newest 500 graph events shown.</p> : null}
        <ol className="space-y-3 border-l border-[var(--border-strong)] pl-4">
        {progressEvents.map((event) => (
          <li key={event.id} className="relative">
            <span className="absolute -left-[1.22rem] top-1 size-2 rounded-full bg-[var(--accent)]" aria-hidden="true" />
            <p className="text-xs font-medium text-foreground">{event.type}{"nodeKey" in event && event.nodeKey ? ` · ${event.nodeKey}` : ""}</p>
            <p className="mt-1 text-xs leading-5 text-muted">{event.detail}</p>
            <time className="mt-1 block text-[11px] text-muted">{clock(event.createdAt)}</time>
          </li>
        ))}
        </ol>
      </div>
    );
  }

  const release = detail.runEvidence?.release;
  if (tab === "files") {
    if (!release?.pullRequest && !release?.producedCommit) return <EmptyInspector label="pull request or diff evidence" />;
    return (
      <div className="space-y-3">
        {release.pullRequest ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] p-3 text-xs">
            <p className="font-semibold text-foreground">{release.pullRequest.repository} · PR #{release.pullRequest.number}</p>
            <p className="mt-2 text-muted"><EvidenceLink href={`${release.pullRequest.url}/files`}>Open files and diffs</EvidenceLink></p>
          </div>
        ) : null}
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div><dt className="text-muted">Produced commit</dt><dd className="mt-1 break-all text-foreground">{release.producedCommit ?? "Not recorded"}</dd></div>
          <div><dt className="text-muted">Base branch</dt><dd className="mt-1 text-foreground">{release.baseBranch ?? "Not recorded"}</dd></div>
        </dl>
      </div>
    );
  }

  if (tab === "tests") {
    if (release?.checks === null || release?.checks === undefined) return <EmptyInspector label="exact-head CI evidence" />;
    if (!release.checks.length) return <p className="text-xs text-muted">Exact-head CI was recorded with no check runs.</p>;
    return <ul className="space-y-2">{release.checks.map((check) => (
      <li key={`${check.name}:${check.url ?? check.conclusion}`} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] p-3 text-xs"><EvidenceLink href={check.url}>{check.name}</EvidenceLink><StatusBadge tone={check.conclusion === "success" ? "safe" : "danger"}>{check.conclusion}</StatusBadge></li>
    ))}</ul>;
  }

  if (tab === "preview") {
    const previewUrl = release?.deployment?.url ?? null;
    return previewUrl ? (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] p-3 text-xs"><p className="font-semibold text-foreground">Recorded deployment URL</p><p className="mt-2 break-all text-muted"><EvidenceLink href={previewUrl}>{previewUrl}</EvidenceLink></p></div>
    ) : <NotConnected label="Preview" detail="No provider deployment URL has been recorded for this run." />;
  }

  if (tab === "deployment") {
    return (
      <div className="space-y-3">
        {release?.deployment ? <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] p-3 text-xs"><p className="font-semibold text-foreground">{release.deployment.environment ?? "Deployment"} · {release.deployment.state}</p>{release.deployment.url ? <p className="mt-2 break-all text-muted"><EvidenceLink href={release.deployment.url}>{release.deployment.url}</EvidenceLink></p> : null}</div> : <EmptyInspector label="deployment evidence" />}
        {release?.health ? <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] p-3 text-xs"><div className="flex items-center justify-between gap-3"><p className="font-semibold text-foreground">Production health</p><StatusBadge tone={release.health.healthy ? "safe" : "danger"}>{release.health.healthy ? "healthy" : "unhealthy"}</StatusBadge></div>{release.health.postDeployValidation ? <p className="mt-2 text-muted">{release.health.postDeployValidation}</p> : null}</div> : <EmptyInspector label="production health evidence" />}
        <NotConnected label="Rollback" detail="Grok Bot has no connected rollback executor. No rollback will run automatically." />
        <NotConnected label="Automatic continuation" detail="Automatic continuation is not connected. A recorded run will not advance through external actions on its own." />
      </div>
    );
  }

  return <ArtifactList artifacts={detail.artifacts} emptyLabel="artifacts" />;
}

export function GrokWorkspace({
  initialSelection,
  viewer,
}: {
  initialSelection: GrokSelection;
  viewer?: FactoryViewer;
}) {
  const [state, setState] = useState<LoadState>("loading");
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [projectId, setProjectId] = useState(initialSelection.projectId ?? "");
  const [sessions, setSessions] = useState<readonly GrokSession[]>([]);
  const [sessionId, setSessionId] = useState(initialSelection.sessionId ?? "");
  const [detail, setDetail] = useState<GrokSessionDetail | null>(null);
  const [tab, setTab] = useState<InspectorTab>("goal");
  const [prompt, setPrompt] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [controlPending, setControlPending] = useState<GrokControlAction | null>(null);
  const detailRequest = useRef(0);
  const submitAttempt = useRef<Readonly<{
    projectId: string;
    prompt: string;
    idempotencyKey: string;
  }> | null>(null);
  const controlAttempts = useRef(new Map<string, string>());

  const loadDetail = useCallback(async (id: string) => {
    const requestId = ++detailRequest.current;
    if (!id) {
      setDetail(null);
      setNotice("");
      return;
    }
    setDetail((current) => current?.session.id === id ? current : null);
    try {
      const response = await fetch(`/api/grok/sessions/${id}`, { cache: "no-store" });
      const body = await readJson(response) as GrokSessionDetail;
      if (requestId !== detailRequest.current) return;
      setDetail(body);
      setProjectId(body.session.projectId);
      setSessionId(body.session.id);
      setSessions((current) => current.some((session) => session.id === body.session.id)
        ? current.map((session) => session.id === body.session.id ? body.session : session)
        : [body.session, ...current]);
      setNotice(executionNotice(body));
      setErrorMessage("");
      updateUrl({
        projectId: body.session.projectId,
        sessionId: body.session.id,
        graphId: body.session.graphId ?? undefined,
        graphRunId: body.session.graphRunId ?? undefined,
      });
    } catch (error) {
      if (requestId !== detailRequest.current) return;
      setDetail(null);
      setNotice("");
      setErrorMessage(error instanceof Error ? error.message : "The session could not be loaded.");
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const [projectResponse, sessionResponse] = await Promise.all([
        fetch("/api/projects", { cache: "no-store" }),
        fetch("/api/grok/sessions", { cache: "no-store" }),
      ]);
      if (projectResponse.status === 401 || sessionResponse.status === 401) {
        setState("signed-out");
        return;
      }
      if (projectResponse.status === 409 || sessionResponse.status === 409) {
        setState("setup");
        return;
      }
      const projectBody = await readJson(projectResponse) as { projects?: Project[] };
      const sessionBody = await readJson(sessionResponse) as GrokSessionListResponse;
      const nextProjects = Array.isArray(projectBody.projects) ? projectBody.projects : [];
      const nextSessions = Array.isArray(sessionBody.sessions) ? sessionBody.sessions : [];
      setProjects(nextProjects);
      setSessions(nextSessions);
      const requestedSession = initialSelection.sessionId
        ? nextSessions.find((session) => session.id === initialSelection.sessionId) ?? null
        : null;
      const selectedProject = initialSelection.projectId || requestedSession?.projectId || nextProjects[0]?.id || "";
      const selectedSession = initialSelection.sessionId
        ?? (requestedSession?.projectId === selectedProject
          ? requestedSession.id
          : nextSessions.find((session) => !selectedProject || session.projectId === selectedProject)?.id ?? "");
      setProjectId(selectedProject);
      setSessionId(selectedSession);
      setState("ready");
      await loadDetail(selectedSession);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Grok Bot could not be loaded.");
      setState("error");
    }
  }, [initialSelection.projectId, initialSelection.sessionId, loadDetail]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);
  const activeSessionId = detail?.session.id;
  const activeSessionStatus = detail?.session.status;
  useEffect(() => {
    if (!activeSessionId || !activeSessionStatus || !POLLING_STATUSES.has(activeSessionStatus.toLowerCase())) return;
    const timer = window.setInterval(() => void loadDetail(activeSessionId), 10_000);
    return () => window.clearInterval(timer);
  }, [activeSessionId, activeSessionStatus, loadDetail]);

  const filteredSessions = useMemo(
    () => sessions.filter((session) => !projectId || session.projectId === projectId),
    [projectId, sessions],
  );
  const selectedSession = detail?.session.id === sessionId
    ? detail.session
    : sessions.find((session) => session.id === sessionId) ?? null;
  const query = selectionQuery({
    projectId: projectId || undefined,
    sessionId: sessionId || undefined,
    graphId: selectedSession?.graphId ?? initialSelection.graphId,
    graphRunId: selectedSession?.graphRunId ?? initialSelection.graphRunId,
  });

  async function selectSession(id: string) {
    setSessionId(id);
    setErrorMessage("");
    setNotice("");
    const session = sessions.find((candidate) => candidate.id === id);
    updateUrl({ projectId: session?.projectId ?? projectId, sessionId: id, graphId: session?.graphId ?? undefined, graphRunId: session?.graphRunId ?? undefined });
    await loadDetail(id);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const goal = prompt.trim();
    if (!goal || !projectId || submitting) return;
    setSubmitting(true);
    detailRequest.current += 1;
    setErrorMessage("");
    setNotice("");
    try {
      const attempt = submitAttempt.current?.projectId === projectId
        && submitAttempt.current.prompt === goal
        ? submitAttempt.current
        : {
            projectId,
            prompt: goal,
            idempotencyKey: `grok-submit:${globalThis.crypto.randomUUID()}`,
          };
      submitAttempt.current = attempt;
      const response = await fetch("/api/grok/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, prompt: goal, idempotencyKey: attempt.idempotencyKey }),
      });
      const body = await readJson(response) as GrokCreateResponse;
      submitAttempt.current = null;
      setPrompt("");
      setDetail(body);
      setSessions((current) => [body.session, ...current.filter((session) => session.id !== body.session.id)]);
      setSessionId(body.session.id);
      setNotice(body.blocked?.message ?? executionNotice(body));
      updateUrl({ projectId, sessionId: body.session.id, graphId: body.session.graphId ?? undefined, graphRunId: body.session.graphRunId ?? undefined });
    } catch (error) {
      if (error instanceof GrokRequestError) {
        // A client response is a completed attempt. A server response is still
        // indeterminate: durable evidence may have committed before the server
        // failed to project it, so preserve the key and let retry recover that
        // exact attempt rather than creating another session.
        if (error.status < 500) submitAttempt.current = null;
        if (error.status === 409 && error.sessionId) {
          setSessionId(error.sessionId);
          // The POST already committed this durable identity. Preserve it in
          // the address bar before the follow-up read so a transient GET
          // failure can be recovered with a normal page reload.
          updateUrl({ projectId, sessionId: error.sessionId });
          await loadDetail(error.sessionId);
          setErrorMessage(error.message);
          return;
        }
      }
      setErrorMessage(error instanceof Error ? error.message : "The goal could not be recorded.");
    } finally {
      setSubmitting(false);
    }
  }

  async function controlSession(action: GrokControlAction) {
    if (!selectedSession || controlPending || !selectedSession.allowedActions.includes(action)) return;
    const attemptKey = `${selectedSession.id}:${action}`;
    setControlPending(action);
    detailRequest.current += 1;
    setErrorMessage("");
    setNotice("");
    try {
      const idempotencyKey = controlAttempts.current.get(attemptKey)
        ?? `grok-control:${globalThis.crypto.randomUUID()}`;
      controlAttempts.current.set(attemptKey, idempotencyKey);
      const response = await fetch(`/api/grok/sessions/${selectedSession.id}/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          idempotencyKey,
          reason: `${action} requested from the Grok Bot control center`,
        }),
      });
      const body = await readJson(response) as GrokControlResponse;
      controlAttempts.current.delete(attemptKey);
      setDetail(body);
      setSessions((current) => current.map((session) => (
        session.id === body.session.id ? body.session : session
      )));
      setNotice(body.note ?? (body.replayed
        ? `The ${action} control was already applied; durable state was reloaded.`
        : executionNotice(body)));
    } catch (error) {
      // A missing response or server 5xx is indeterminate: the atomic database
      // control may have committed before projection/transport failed. Reuse
      // that exact key. Only success or a definitive client response releases
      // the key for a later control cycle.
      if (error instanceof GrokRequestError && error.status >= 400 && error.status < 500) {
        controlAttempts.current.delete(attemptKey);
      }
      setErrorMessage(error instanceof Error ? error.message : `The ${action} request could not be completed.`);
    } finally {
      setControlPending(null);
    }
  }

  const controlIcon = (action: RenderedGrokControlAction) => action === "pause"
    ? Pause
    : action === "resume"
      ? Play
      : CircleStop;
  const selectedRunIsRunning = selectedSession?.status.toUpperCase() === "RUNNING"
    || (detail?.session.id === selectedSession?.id
      && detail?.runEvidence?.state.toUpperCase() === "RUNNING");
  const renderedControlActions = selectedRunIsRunning
    ? CONTROL_ACTIONS.filter((action) => action !== "stop")
    : CONTROL_ACTIONS;

  function moveEvidenceTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }
    if (nextIndex === null) return;

    event.preventDefault();
    const next = tabs[nextIndex];
    setTab(next.key);
    window.requestAnimationFrame(() => {
      document.getElementById(`grok-tab-${next.key}`)?.focus();
    });
  }

  return (
    <FactoryShell
      step={FACTORY_STEPS[0]}
      section="grok"
      marks={[]}
      run={null}
      stepQuery={query}
      viewer={viewer}
      breadcrumb={<span className="flex items-center gap-2"><Sparkles className="size-4 text-[var(--accent-text)]" aria-hidden="true" /><strong className="text-foreground">Grok Bot</strong><span aria-hidden="true">/</span><span>{selectedSession?.title ?? "New goal"}</span></span>}
    >
      <section aria-labelledby="grok-heading" className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <header className="border-b border-[var(--border)] px-4 py-3 sm:px-5">
          <h1 id="grok-heading" className="text-lg font-semibold text-foreground">Grok Bot</h1>
          <p className="mt-0.5 text-xs text-muted">A durable Codex and Claude workspace with recorded evidence, safe controls, and no implied execution.</p>
        </header>
        {state === "loading" ? <div className="grid min-h-[70vh] place-items-center"><Loader2 className="size-6 animate-spin text-[var(--accent)]" aria-label="Loading Grok Bot" /></div> : null}
        {state === "signed-out" ? <div className="grid min-h-[70vh] place-items-center p-8 text-center"><div><Bot className="mx-auto size-8 text-faint" /><h2 className="mt-3 text-lg font-semibold">Sign in to use Grok Bot</h2><a href="/sign-in?next=/solutions/factory/grok" className="btn btn-primary btn-sm mt-4">Sign in</a></div></div> : null}
        {state === "setup" ? <div className="grid min-h-[70vh] place-items-center p-8 text-center"><div><Target className="mx-auto size-8 text-faint" /><h2 className="mt-3 text-lg font-semibold">Choose a Factory project first</h2><a href="/solutions/projects" className="btn btn-primary btn-sm mt-4">Open projects</a></div></div> : null}
        {state === "error" ? <div className="grid min-h-[70vh] place-items-center p-8 text-center"><div><CircleStop className="mx-auto size-8 text-[var(--danger)]" aria-hidden="true" /><h2 className="mt-3 text-lg font-semibold">Grok Bot is unavailable</h2><p className="mt-2 max-w-md text-sm text-muted">{errorMessage}</p><button type="button" className="btn btn-secondary btn-sm mt-4" onClick={() => void load()}>Try again</button></div></div> : null}
        {state === "ready" ? (
          <div className="grid min-h-[70vh] xl:grid-cols-[16rem_minmax(0,1fr)_22rem]">
            <aside aria-label="Grok sessions" className="border-b border-[var(--border)] bg-[var(--surface-inset)] p-3 xl:border-b-0 xl:border-r">
              <div className="flex items-center justify-between gap-2">
                <p className="label">Sessions</p>
                <button type="button" className="grid size-8 place-items-center rounded-lg border border-[var(--border)] text-muted hover:text-foreground" aria-label="Start a new goal" onClick={() => { detailRequest.current += 1; setSessionId(""); setDetail(null); setPrompt(""); setErrorMessage(""); setNotice(""); updateUrl({ projectId: projectId || undefined }); }}><MessageSquarePlus className="size-4" aria-hidden="true" /></button>
              </div>
              <label className="mt-3 block"><span className="sr-only">Project</span><select className="input w-full text-sm" value={projectId} onChange={(event) => { detailRequest.current += 1; setProjectId(event.target.value); setSessionId(""); setDetail(null); setErrorMessage(""); setNotice(""); updateUrl({ projectId: event.target.value || undefined }); }}><option value="">Choose project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
              <ul className="mt-3 max-h-52 space-y-1 overflow-y-auto xl:max-h-[calc(70vh-7rem)]">
                {filteredSessions.map((session) => (
                  <li key={session.id}><button type="button" aria-current={session.id === sessionId ? "true" : undefined} className={cn("w-full rounded-lg px-3 py-2.5 text-left transition-colors", session.id === sessionId ? "bg-[var(--accent-surface)]" : "hover:bg-[var(--surface-raised)]")} onClick={() => void selectSession(session.id)}><span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{session.title}</span><ChevronRight className="size-3.5 shrink-0 text-faint" /></span><span className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted"><span>{sessionListStatus(session, detail)}</span><time>{clock(session.updatedAt)}</time></span></button></li>
                ))}
                {!filteredSessions.length ? <li className="rounded-lg border border-dashed border-[var(--border-strong)] p-3 text-xs text-muted">No persisted sessions for this project.</li> : null}
              </ul>
            </aside>

            <div className="flex min-h-[34rem] min-w-0 flex-col border-b border-[var(--border)] xl:border-b-0 xl:border-r">
              <header className="flex min-h-14 items-center justify-between gap-3 border-b border-[var(--border)] px-4">
                <div className="min-w-0"><p className="truncate text-sm font-semibold text-foreground">{selectedSession?.title ?? "What should we accomplish?"}</p><p className="truncate text-xs text-muted">{selectedSession ? sessionHeadline(selectedSession, detail) : "New durable goal"}</p></div>
                {selectedSession ? <StatusBadge tone={statusTone(selectedSession.status)}>{selectedSession.status}</StatusBadge> : null}
              </header>
              <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
                {notice ? (
                  <div className="flex items-start gap-2.5 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] px-3 py-2.5 text-sm text-[var(--warning)]" role="status">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <p>{notice}</p>
                  </div>
                ) : null}
                <div className="space-y-4" role="log" aria-label="Recorded session messages" aria-live="polite" aria-relevant="additions text">
                  {detail?.messages.map((entry) => (
                    <article key={entry.id} aria-label={`${messageRoleLabel(entry.role)} message`} className={cn("max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6", entry.role === "user" ? "ml-auto bg-foreground text-background" : "border border-[var(--border)] bg-[var(--surface-raised)] text-foreground")}><p className={cn("text-[10px] font-semibold uppercase tracking-wide", entry.role === "user" ? "text-background/80" : "text-muted")}>{messageRoleLabel(entry.role)}</p><p className="mt-1 whitespace-pre-wrap">{entry.content}</p><time className={cn("mt-2 block text-[10px]", entry.role === "user" ? "text-background/80" : "text-muted")}>{clock(entry.createdAt)}</time></article>
                  ))}
                </div>
                {!detail ? <div className="grid min-h-64 place-items-center text-center"><div className="max-w-lg"><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--accent-surface)] text-[var(--accent-text)]"><Sparkles className="size-6" aria-hidden="true" /></span><h2 className="mt-4 text-xl font-semibold text-foreground">Ask for the outcome</h2><p className="mt-2 text-sm leading-6 text-muted">Grok Bot records plain language first and adds a deterministic plan only when planning succeeds. Graph, agent, test, and delivery evidence appears here only after the runtime records it.</p><div className="mt-4 flex flex-wrap justify-center gap-2">{STARTERS.map((starter) => <button key={starter} type="button" className="rounded-full border border-[var(--border-strong)] px-3 py-1.5 text-xs text-muted hover:text-foreground" onClick={() => setPrompt(starter)}>{starter}</button>)}</div></div></div> : null}
              </div>
              <form onSubmit={submit} className="border-t border-[var(--border)] p-3 sm:p-4">
                {errorMessage ? <p role="alert" className="mb-2 text-xs text-[var(--danger)]">{errorMessage}</p> : null}
                <div className="flex items-end gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-inset)] p-2 focus-within:border-[var(--accent-border)]"><textarea className="min-h-12 max-h-36 flex-1 resize-y bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-faint" rows={2} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Build me…  Fix…  Research…  Test…  Deploy…" aria-label="Tell Grok Bot what you want done" /><button type="submit" className="grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-50" disabled={!prompt.trim() || !projectId || submitting} aria-label="Start goal">{submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}</button></div>
                <p className="mt-2 text-[11px] text-muted">A request saves a session; a plan is recorded only when planning succeeds. Neither implies that a graph, worker, or provider started.</p>
              </form>
            </div>

            <aside aria-label="Session inspector" className="min-w-0 p-3">
              <div className="flex items-center justify-between gap-2"><p className="label">Control center</p><button type="button" className="grid size-8 place-items-center rounded-lg border border-[var(--border)] text-muted hover:text-foreground" aria-label="Refresh session" onClick={() => sessionId ? void loadDetail(sessionId) : void load()}><RefreshCw className="size-3.5" /></button></div>
              {selectedSession ? <div className={cn("mt-3 grid gap-1", selectedRunIsRunning ? "grid-cols-2" : "grid-cols-3")}>{renderedControlActions.map((action) => { const Icon = controlIcon(action); const allowed = selectedSession.allowedActions.includes(action); const pending = controlPending === action; return <button key={action} type="button" aria-label={allowed ? `${action} session` : `${action} unavailable in ${selectedSession.status}`} disabled={!allowed || controlPending !== null} title={allowed ? `${action} this session` : `${action} is not available in ${selectedSession.status}`} className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg border border-[var(--border)] text-[10px] capitalize text-muted enabled:hover:border-[var(--accent-border)] enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void controlSession(action)}>{pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Icon className="size-3.5" aria-hidden="true" />}{action}</button>; })}</div> : null}
              <div className="mt-3 flex gap-1 overflow-x-auto border-b border-[var(--border)] pb-2 xl:grid xl:grid-cols-4" role="tablist" aria-label="Session evidence">{tabs.map((entry, index) => { const Icon = entry.icon; return <button id={`grok-tab-${entry.key}`} key={entry.key} type="button" role="tab" aria-selected={tab === entry.key} aria-controls="grok-inspector-panel" tabIndex={tab === entry.key ? 0 : -1} className={cn("flex min-w-max items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium", tab === entry.key ? "bg-[var(--accent-surface)] text-[var(--accent-text)]" : "text-muted hover:text-foreground")} onClick={() => setTab(entry.key)} onKeyDown={(event) => moveEvidenceTab(event, index)}><Icon className="size-3" aria-hidden="true" />{entry.label}</button>; })}</div>
              <div id="grok-inspector-panel" role="tabpanel" aria-labelledby={`grok-tab-${tab}`} tabIndex={0} className="mt-4 max-h-[calc(70vh-11rem)] overflow-y-auto pr-1"><Inspector detail={detail} tab={tab} /></div>
            </aside>
          </div>
        ) : null}
      </section>
    </FactoryShell>
  );
}
