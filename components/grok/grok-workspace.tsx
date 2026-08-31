"use client";

import {
  Activity,
  AlertTriangle,
  Ban,
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
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

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
type InspectorTab = "goal" | "plan" | "agents" | "progress" | "files" | "tests" | "artifacts" | "deployment";
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
const CONTROL_ACTIONS: readonly GrokControlAction[] = ["pause", "resume", "cancel", "stop", "retry"];
const BLOCKED_FALLBACK = "The session and plan are saved, but no graph or worker execution has started.";

const tabs: ReadonlyArray<{ key: InspectorTab; label: string; icon: typeof Target }> = [
  { key: "goal", label: "Goal", icon: Target },
  { key: "plan", label: "Plan", icon: Code2 },
  { key: "agents", label: "Agents", icon: Users },
  { key: "progress", label: "Progress", icon: Activity },
  { key: "files", label: "Files / Diffs", icon: GitCompareArrows },
  { key: "tests", label: "Tests", icon: FlaskConical },
  { key: "artifacts", label: "Artifacts", icon: Box },
  { key: "deployment", label: "Deployment", icon: Rocket },
];

function clock(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
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
  if (detail.session.status.toLowerCase() === "blocked") return BLOCKED_FALLBACK;
  if (!detail.session.graphId) {
    return "This durable session has no linked graph. A saved plan is not evidence that a worker or provider started.";
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

async function readJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (body as { error?: { message?: string } }).error?.message;
    throw new Error(message ?? "Grok Bot could not complete that request.");
  }
  return body;
}

function EmptyInspector({ label }: { label: string }) {
  return (
    <div className="grid min-h-40 place-items-center rounded-lg border border-dashed border-[var(--border-strong)] p-5 text-center">
      <div>
        <PackageCheck className="mx-auto size-5 text-faint" aria-hidden="true" />
        <p className="mt-2 text-sm font-medium text-foreground">No {label.toLowerCase()} recorded</p>
        <p className="mt-1 text-xs text-muted">This pane fills only from durable run evidence.</p>
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
          {artifact.uri ? (
            <a
              aria-label={`Open ${artifact.label}`}
              className="mt-2 inline-flex text-xs font-medium text-[var(--accent-text)] hover:underline"
              href={artifact.uri}
            >
              Open artifact
            </a>
          ) : null}
        </li>
      ))}
    </ul>
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
    const assigned = detail.tasks.filter((task) => task.provider || task.agentName);
    return (
      <div>
        <p className="text-xs font-semibold text-foreground">
          {hasObservedRun ? "Observed execution identity" : "Planned routing intent"}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted">
          {hasObservedRun
            ? "Provider and model values below come from recorded node-run evidence."
            : "Provider, model, and agent values below come from the saved plan; they do not prove execution."}
        </p>
        {assigned.length ? (
          <ul className="mt-3 space-y-2">
            {assigned.map((task) => (
              <li key={task.id} className="flex items-start gap-3 rounded-lg border border-[var(--border)] p-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--accent-surface)] text-[var(--accent-text)]"><Bot className="size-4" aria-hidden="true" /></span>
                <div className="min-w-0"><p className="truncate text-sm font-medium text-foreground">{hasObservedRun ? task.provider : task.agentName ?? task.provider}</p><p className="mt-0.5 truncate text-xs text-muted">{task.title}{task.model ? ` · ${task.model}` : ""}</p></div>
              </li>
            ))}
          </ul>
        ) : <div className="mt-3"><EmptyInspector label={hasObservedRun ? "observed execution identities" : "planned routing identities"} /></div>}
      </div>
    );
  }

  if (tab === "progress") {
    if (!detail.events.length) return <EmptyInspector label="progress events" />;
    return (
      <ol className="space-y-3 border-l border-[var(--border-strong)] pl-4">
        {detail.events.map((event) => (
          <li key={event.id} className="relative">
            <span className="absolute -left-[1.22rem] top-1 size-2 rounded-full bg-[var(--accent)]" aria-hidden="true" />
            <p className="text-xs font-medium text-foreground">{event.type}</p>
            <p className="mt-1 text-xs leading-5 text-muted">{event.detail}</p>
            <time className="mt-1 block text-[11px] text-muted">{clock(event.createdAt)}</time>
          </li>
        ))}
      </ol>
    );
  }

  const matches = (patterns: readonly string[]) => detail.artifacts.filter((artifact) => {
    const kind = artifact.kind.toLowerCase();
    return patterns.some((pattern) => kind.includes(pattern));
  });
  if (tab === "files") return <ArtifactList artifacts={matches(["file", "diff", "commit", "pull_request"])} emptyLabel="files or diffs" />;
  if (tab === "tests") return <ArtifactList artifacts={matches(["test", "validation", "check", "ci"])} emptyLabel="test evidence" />;
  if (tab === "deployment") return <ArtifactList artifacts={matches(["deploy", "preview", "health"])} emptyLabel="deployment evidence" />;
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
      setSessions((current) => current.some((session) => session.id === body.session.id)
        ? current.map((session) => session.id === body.session.id ? body.session : session)
        : [body.session, ...current]);
      setNotice(executionNotice(body));
      setErrorMessage("");
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
      const selectedSession = requestedSession?.projectId === selectedProject
        ? requestedSession.id
        : nextSessions.find((session) => !selectedProject || session.projectId === selectedProject)?.id ?? "";
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
    setErrorMessage("");
    setNotice("");
    try {
      const response = await fetch("/api/grok/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, prompt: goal }),
      });
      const body = await readJson(response) as GrokCreateResponse;
      setPrompt("");
      setDetail(body);
      setSessions((current) => [body.session, ...current.filter((session) => session.id !== body.session.id)]);
      setSessionId(body.session.id);
      setNotice(body.blocked?.message ?? executionNotice(body));
      updateUrl({ projectId, sessionId: body.session.id, graphId: body.session.graphId ?? undefined, graphRunId: body.session.graphRunId ?? undefined });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "The goal could not be recorded.");
    } finally {
      setSubmitting(false);
    }
  }

  async function controlSession(action: GrokControlAction) {
    if (!selectedSession || controlPending || !selectedSession.allowedActions.includes(action)) return;
    setControlPending(action);
    setErrorMessage("");
    setNotice("");
    try {
      const response = await fetch(`/api/grok/sessions/${selectedSession.id}/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          idempotencyKey: `grok-control:${globalThis.crypto.randomUUID()}`,
          reason: `${action} requested from the Grok Bot control center`,
        }),
      });
      const body = await readJson(response) as GrokControlResponse;
      setDetail(body);
      setSessions((current) => current.map((session) => (
        session.id === body.session.id ? body.session : session
      )));
      setNotice(body.note ?? (body.replayed
        ? `The ${action} control was already applied; durable state was reloaded.`
        : executionNotice(body)));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : `The ${action} request could not be completed.`);
    } finally {
      setControlPending(null);
    }
  }

  const controlIcon = (action: GrokControlAction) => action === "pause"
    ? Pause
    : action === "resume"
      ? Play
      : action === "cancel"
        ? Ban
        : action === "stop"
          ? CircleStop
          : RefreshCw;

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
                <button type="button" className="grid size-8 place-items-center rounded-lg border border-[var(--border)] text-muted hover:text-foreground" aria-label="Start a new goal" onClick={() => { setSessionId(""); setDetail(null); setPrompt(""); setErrorMessage(""); setNotice(""); updateUrl({ projectId: projectId || undefined }); }}><MessageSquarePlus className="size-4" aria-hidden="true" /></button>
              </div>
              <label className="mt-3 block"><span className="sr-only">Project</span><select className="input w-full text-sm" value={projectId} onChange={(event) => { setProjectId(event.target.value); setSessionId(""); setDetail(null); setErrorMessage(""); setNotice(""); updateUrl({ projectId: event.target.value || undefined }); }}><option value="">Choose project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
              <ul className="mt-3 max-h-52 space-y-1 overflow-y-auto xl:max-h-[calc(70vh-7rem)]">
                {filteredSessions.map((session) => (
                  <li key={session.id}><button type="button" className={cn("w-full rounded-lg px-3 py-2.5 text-left transition-colors", session.id === sessionId ? "bg-[var(--accent-surface)]" : "hover:bg-[var(--surface-raised)]")} onClick={() => void selectSession(session.id)}><span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{session.title}</span><ChevronRight className="size-3.5 shrink-0 text-faint" /></span><span className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted"><span>{session.status}</span><time>{clock(session.updatedAt)}</time></span></button></li>
                ))}
                {!filteredSessions.length ? <li className="rounded-lg border border-dashed border-[var(--border-strong)] p-3 text-xs text-muted">No persisted sessions for this project.</li> : null}
              </ul>
            </aside>

            <div className="flex min-h-[34rem] min-w-0 flex-col border-b border-[var(--border)] xl:border-b-0 xl:border-r">
              <header className="flex min-h-14 items-center justify-between gap-3 border-b border-[var(--border)] px-4">
                <div className="min-w-0"><p className="truncate text-sm font-semibold text-foreground">{selectedSession?.title ?? "What should we accomplish?"}</p><p className="truncate text-xs text-muted">{selectedSession ? selectedSession.graphRunId ? "Durable session · run evidence linked" : selectedSession.graphId ? "Durable session · graph recorded; no run evidence yet" : "Durable session · plan saved; execution not linked" : "New durable goal"}</p></div>
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
                {!detail ? <div className="grid min-h-64 place-items-center text-center"><div className="max-w-lg"><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--accent-surface)] text-[var(--accent-text)]"><Sparkles className="size-6" aria-hidden="true" /></span><h2 className="mt-4 text-xl font-semibold text-foreground">Ask for the outcome</h2><p className="mt-2 text-sm leading-6 text-muted">Grok Bot records plain language and a deterministic plan. Graph, agent, test, and delivery evidence appears here only after the runtime records it.</p><div className="mt-4 flex flex-wrap justify-center gap-2">{STARTERS.map((starter) => <button key={starter} type="button" className="rounded-full border border-[var(--border-strong)] px-3 py-1.5 text-xs text-muted hover:text-foreground" onClick={() => setPrompt(starter)}>{starter}</button>)}</div></div></div> : null}
              </div>
              <form onSubmit={submit} className="border-t border-[var(--border)] p-3 sm:p-4">
                {errorMessage ? <p role="alert" className="mb-2 text-xs text-[var(--danger)]">{errorMessage}</p> : null}
                <div className="flex items-end gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-inset)] p-2 focus-within:border-[var(--accent-border)]"><textarea className="min-h-12 max-h-36 flex-1 resize-y bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-faint" rows={2} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Build me…  Fix…  Research…  Test…  Deploy…" aria-label="Tell Grok Bot what you want done" /><button type="submit" className="grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--accent)] text-black disabled:cursor-not-allowed disabled:opacity-50" disabled={!prompt.trim() || !projectId || submitting} aria-label="Start goal">{submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}</button></div>
                <p className="mt-2 text-[11px] text-muted">A request saves a session and plan. It does not imply that a graph, worker, or provider started.</p>
              </form>
            </div>

            <aside aria-label="Session inspector" className="min-w-0 p-3">
              <div className="flex items-center justify-between gap-2"><p className="label">Control center</p><button type="button" className="grid size-8 place-items-center rounded-lg border border-[var(--border)] text-muted hover:text-foreground" aria-label="Refresh session" onClick={() => sessionId ? void loadDetail(sessionId) : void load()}><RefreshCw className="size-3.5" /></button></div>
              {selectedSession ? <div className="mt-3 grid grid-cols-2 gap-1 sm:grid-cols-5">{CONTROL_ACTIONS.map((action) => { const Icon = controlIcon(action); const allowed = selectedSession.allowedActions.includes(action); const pending = controlPending === action; return <button key={action} type="button" aria-label={allowed ? `${action} session` : `${action} unavailable in ${selectedSession.status}`} disabled={!allowed || controlPending !== null} title={allowed ? `${action} this session` : `${action} is not available in ${selectedSession.status}`} className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg border border-[var(--border)] text-[10px] capitalize text-muted enabled:hover:border-[var(--accent-border)] enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void controlSession(action)}>{pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Icon className="size-3.5" aria-hidden="true" />}{action}</button>; })}</div> : null}
              <div className="mt-3 flex gap-1 overflow-x-auto border-b border-[var(--border)] pb-2 xl:grid xl:grid-cols-4" role="tablist" aria-label="Session evidence">{tabs.map((entry) => { const Icon = entry.icon; return <button id={`grok-tab-${entry.key}`} key={entry.key} type="button" role="tab" aria-selected={tab === entry.key} aria-controls="grok-inspector-panel" className={cn("flex min-w-max items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium", tab === entry.key ? "bg-[var(--accent-surface)] text-[var(--accent-text)]" : "text-muted hover:text-foreground")} onClick={() => setTab(entry.key)}><Icon className="size-3" aria-hidden="true" />{entry.label}</button>; })}</div>
              <div id="grok-inspector-panel" role="tabpanel" aria-labelledby={`grok-tab-${tab}`} className="mt-4 max-h-[calc(70vh-11rem)] overflow-y-auto pr-1"><Inspector detail={detail} tab={tab} /></div>
            </aside>
          </div>
        ) : null}
      </section>
    </FactoryShell>
  );
}
