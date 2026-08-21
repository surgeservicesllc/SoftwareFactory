"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Compass,
  ListTodo,
  Loader2,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { ExternalEvidenceLink } from "@/components/control-plane-detail";
import { Card, StatusBadge } from "@/components/ui";
import {
  buildFactoryBriefing,
  type BriefingAgent,
  type BriefingConnection,
  type BriefingGraphRun,
  type BriefingInboxMessage,
  type BriefingIncident,
  type BriefingItem,
  type BriefingRun,
  type BriefingSection,
  type BriefingTask,
  type BriefingWorker,
  type FactoryBriefing,
} from "@/lib/dashboard/factory-briefing";
import { isBrowserSupabaseConfigured } from "@/lib/supabase/browser-config";

type SourceId =
  | "tasks"
  | "runs"
  | "graphs"
  | "inbox"
  | "operations"
  | "connections"
  | "agents"
  | "worker";

type SourceResult<T> =
  | { id: SourceId; label: string; kind: "ready"; limited: boolean; value: T }
  | { id: SourceId; label: string; kind: "signed_out" | "setup" | "unavailable" };

type SourceNotice = Readonly<{ id: SourceId; label: string }>;

type ViewState =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "setup" }
  | { kind: "error" }
  | {
      kind: "ready";
      briefing: FactoryBriefing;
      unavailable: readonly SourceNotice[];
      limited: readonly SourceNotice[];
      updatedAt: string;
    };

const REFRESH_INTERVAL_MS = 30_000;
const SOURCE_TIMEOUT_MS = 8_000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): value is string {
  return typeof value === "string";
}

function nullableText(value: unknown): value is string | null {
  return value === null || text(value);
}

function namedRelation(value: unknown): value is { id: string; name: string } | null {
  return value === null || (record(value) && text(value.id) && text(value.name));
}

function titledRelation(value: unknown): value is { id: string; title?: string } | null {
  return value === null || (
    record(value)
    && text(value.id)
    && (value.title === undefined || text(value.title))
  );
}

function validTask(value: unknown): value is BriefingTask {
  return record(value)
    && text(value.id)
    && (value.title === undefined || text(value.title))
    && text(value.status)
    && text(value.risk)
    && typeof value.requiresOwnerApproval === "boolean"
    && typeof value.priority === "number"
    && text(value.createdAt)
    && namedRelation(value.project)
    && namedRelation(value.agent)
    && (value.command === undefined || value.command === null || (record(value.command) && text(value.command.id)))
    && (value.latestRun === undefined || value.latestRun === null || (record(value.latestRun) && text(value.latestRun.id) && text(value.latestRun.status)))
    && (value.pullRequest === undefined || value.pullRequest === null || (
      record(value.pullRequest)
      && typeof value.pullRequest.number === "number"
      && (value.pullRequest.url === undefined || nullableText(value.pullRequest.url))
    ));
}

function validRun(value: unknown): value is BriefingRun {
  return record(value)
    && text(value.id)
    && text(value.status)
    && nullableText(value.startedAt)
    && nullableText(value.completedAt)
    && text(value.createdAt)
    && namedRelation(value.project)
    && titledRelation(value.task)
    && namedRelation(value.agent);
}

function validGraphRun(value: unknown): value is BriefingGraphRun {
  return record(value)
    && text(value.graphRunId)
    && text(value.goal)
    && text(value.topology)
    && text(value.state)
    && nullableText(value.startedAt)
    && nullableText(value.completedAt)
    && (value.verifications === undefined || (
      Array.isArray(value.verifications)
      && value.verifications.every((verification) => record(verification) && text(verification.verdict))
    ));
}

function validInboxMessage(value: unknown): value is BriefingInboxMessage {
  return record(value)
    && text(value.id)
    && text(value.status)
    && text(value.kind)
    && nullableText(value.agentName)
    && text(value.createdAt);
}

function validIncident(value: unknown): value is BriefingIncident {
  return record(value)
    && text(value.id)
    && text(value.title)
    && text(value.projectName)
    && text(value.severity)
    && text(value.status)
    && nullableText(value.impact)
    && nullableText(value.resolvedAt)
    && typeof value.ownerAttentionRequired === "boolean"
    && (value.detectedAt === undefined || text(value.detectedAt));
}

function validConnection(value: unknown): value is BriefingConnection {
  return record(value)
    && text(value.id)
    && text(value.name)
    && text(value.status)
    && nullableText(value.statusReason);
}

function validAgent(value: unknown): value is BriefingAgent {
  return record(value)
    && text(value.id)
    && text(value.name)
    && text(value.role)
    && text(value.status);
}

function validWorker(value: unknown): value is BriefingWorker {
  return record(value)
    && ["connected", "stale", "not_connected"].includes(String(value.connectionStatus))
    && text(value.statusLabel)
    && nullableText(value.lastHeartbeatAt)
    && Number.isInteger(value.activeWorkers)
    && Number.isInteger(value.availableWorkers)
    && Number.isInteger(value.staleAfterSeconds);
}

function listProjection<T>(key: string, valid: (value: unknown) => value is T) {
  return (body: unknown): T[] | null => {
    if (!record(body) || !Array.isArray(body[key])) return null;
    return body[key].every(valid) ? body[key] : null;
  };
}

function objectProjection<T>(key: string, valid: (value: unknown) => value is T) {
  return (body: unknown): T | null => {
    if (!record(body) || !valid(body[key])) return null;
    return body[key];
  };
}

async function readProjection<T>(
  id: SourceId,
  label: string,
  url: string,
  select: (body: unknown) => T | null,
  signal: AbortSignal,
  limit?: number,
): Promise<SourceResult<T>> {
  const controller = new AbortController();
  let cancel: ((reason?: unknown) => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    cancel = reject;
  });
  const abort = () => {
    controller.abort();
    cancel?.(new Error("Factory briefing source read cancelled."));
  };
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  const timeout = window.setTimeout(abort, SOURCE_TIMEOUT_MS);

  try {
    const response = await Promise.race([
      fetch(url, { cache: "no-store", signal: controller.signal }),
      cancelled,
    ]);
    if (response.status === 401) return { id, label, kind: "signed_out" };
    if (response.status === 403 || response.status === 409) return { id, label, kind: "setup" };
    if (!response.ok) return { id, label, kind: "unavailable" };
    const selected = select(await response.json());
    return selected === null
      ? { id, label, kind: "unavailable" }
      : {
          id,
          label,
          kind: "ready",
          limited: Array.isArray(selected) && limit !== undefined && selected.length >= limit,
          value: selected,
        };
  } catch {
    return { id, label, kind: "unavailable" };
  } finally {
    window.clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

function valueOr<T>(result: SourceResult<T>, fallback: T): T {
  return result.kind === "ready" ? result.value : fallback;
}

function formattedTime(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleString();
}

function workerTone(worker: BriefingWorker) {
  if (worker.connectionStatus === "connected") return "safe" as const;
  if (worker.connectionStatus === "stale") return "warning" as const;
  return "danger" as const;
}

/**
 * A single caller-scoped snapshot over existing authorized APIs. It never
 * starts or approves work: every action navigates to the authoritative screen,
 * which re-reads state and re-authorizes the person before any mutation.
 */
export function FactoryBriefing({ authenticated }: { authenticated: boolean }) {
  const canLoad = authenticated && isBrowserSupabaseConfigured();
  const [state, setState] = useState<ViewState>(() => canLoad ? { kind: "loading" } : { kind: "signed_out" });
  const [refreshing, setRefreshing] = useState(false);
  const loadSequence = useRef(0);
  const activeController = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    activeController.current?.abort();
    if (!canLoad) {
      setState({ kind: "signed_out" });
      return;
    }
    const controller = new AbortController();
    activeController.current = controller;
    setRefreshing(true);
    try {
      const results = await Promise.all([
        readProjection("tasks", "Backlog", "/api/tasks?limit=100&view=briefing", listProjection("tasks", validTask), controller.signal, 100),
        readProjection("runs", "Runs", "/api/runs?limit=100&view=briefing", listProjection("runs", validRun), controller.signal, 100),
        readProjection("graphs", "Graph runs", "/api/graphs/runs?limit=100&view=briefing", listProjection("runs", validGraphRun), controller.signal, 100),
        readProjection("inbox", "Agent inbox", "/api/agentos/inbox?limit=100&view=briefing", listProjection("messages", validInboxMessage), controller.signal, 100),
        readProjection("operations", "Operations", "/api/operations/overview?view=briefing", listProjection("incidents", validIncident), controller.signal, 50),
        readProjection("connections", "GitHub connections", "/api/github/connections?view=briefing", listProjection("connections", validConnection), controller.signal, 100),
        readProjection("agents", "Agent roster", "/api/agents?limit=100&view=briefing", listProjection("agents", validAgent), controller.signal, 100),
        readProjection("worker", "Worker", "/api/worker/status", objectProjection("worker", validWorker), controller.signal),
      ] as const);

      if (sequence !== loadSequence.current) return;
      if (results.some((result) => result.kind === "signed_out")) {
        setState({ kind: "signed_out" });
        return;
      }
      const readyCount = results.filter((result) => result.kind === "ready").length;
      if (readyCount === 0) {
        setState(results.some((result) => result.kind === "setup") ? { kind: "setup" } : { kind: "error" });
        return;
      }

      const [tasks, runs, graphs, inbox, operations, connections, agents, worker] = results;
      const briefing = buildFactoryBriefing({
        tasks: valueOr(tasks, []),
        runs: valueOr(runs, []),
        graphRuns: valueOr(graphs, []),
        inboxMessages: valueOr(inbox, []),
        incidents: valueOr(operations, []),
        connections: valueOr(connections, []),
        agents: valueOr(agents, []),
        worker: worker.kind === "ready" ? worker.value : null,
      });
      const unavailable = results
        .filter((result) => result.kind !== "ready")
        .map((result) => ({ id: result.id, label: result.label }));
      const limited = results.flatMap((result) => result.kind === "ready" && result.limited
        ? [{ id: result.id, label: result.label }]
        : []);
      setState({
        kind: "ready",
        briefing,
        unavailable,
        limited,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      if (sequence === loadSequence.current) setState({ kind: "error" });
    } finally {
      if (sequence === loadSequence.current) {
        if (activeController.current === controller) activeController.current = null;
        setRefreshing(false);
      }
    }
  }, [canLoad]);

  useEffect(() => {
    if (!canLoad) return;
    const initial = window.setTimeout(() => void load(), 0);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_INTERVAL_MS);
    return () => {
      loadSequence.current += 1;
      activeController.current?.abort();
      activeController.current = null;
      window.clearTimeout(initial);
      window.clearInterval(poll);
    };
  }, [canLoad, load]);

  if (!canLoad || state.kind === "signed_out") {
    return (
      <Card className="mb-8 p-5" id="factory-briefing">
        <BriefingHeader />
        <p className="mt-4 text-sm text-muted">Sign in to see live work, decisions, and crew state for your workspace.</p>
        <Link href="/auth/sign-in?next=/solutions" className="btn btn-primary btn-sm mt-4">Sign in</Link>
      </Card>
    );
  }

  if (state.kind === "loading") {
    return (
      <Card className="mb-8 grid min-h-56 place-items-center p-6" id="factory-briefing">
        <span className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-5 animate-spin text-accent" aria-hidden="true" />
          Loading factory briefing
        </span>
      </Card>
    );
  }

  if (state.kind === "setup") {
    return (
      <Card className="mb-8 p-5" id="factory-briefing">
        <BriefingHeader />
        <p className="mt-4 text-sm text-muted">Create or choose a workspace before loading its factory briefing.</p>
        <Link href="/solutions/connections" className="btn btn-primary btn-sm mt-4">Open connections</Link>
      </Card>
    );
  }

  if (state.kind === "error") {
    return (
      <Card className="mb-8 p-5" id="factory-briefing">
        <BriefingHeader />
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <p className="text-sm text-[var(--warning)]">The briefing could not read any live control-plane source.</p>
          <button type="button" className="btn btn-secondary btn-sm self-start sm:self-auto" disabled={refreshing} onClick={() => void load()}>
            <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
            {refreshing ? "Retrying" : "Try again"}
          </button>
        </div>
      </Card>
    );
  }

  const agentsUnavailable = state.unavailable.some((source) => source.id === "agents");
  const workerUnavailable = state.unavailable.some((source) => source.id === "worker");
  const incomplete = state.unavailable.length > 0 || state.limited.length > 0;
  const incompleteMessage = [
    "Briefing incomplete.",
    state.unavailable.length > 0
      ? `Unavailable: ${state.unavailable.map((source) => source.label).join(", ")}.`
      : null,
    state.limited.length > 0
      ? `Window full: ${state.limited.map((source) => `${source.label} (limit reached)`).join(", ")}. Older records may be omitted.`
      : null,
    "Empty lanes are not an all-clear until every source is available and complete.",
  ].filter(Boolean).join(" ");

  return (
    <Card className="mb-8 p-4 sm:p-5" id="factory-briefing">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <BriefingHeader />
        <div className="flex flex-wrap items-center gap-2" aria-label="Crew status" aria-live="polite">
          <StatusBadge tone="neutral" className="max-w-full whitespace-normal break-all text-left">
            {agentsUnavailable
              ? "Coordinator unavailable"
              : state.briefing.crew.liaison
                ? `Coordinator role: ${state.briefing.crew.liaison.name}`
                : "Coordinator not recorded"}
          </StatusBadge>
          <StatusBadge tone={agentsUnavailable ? "warning" : state.briefing.crew.activeAgents > 0 ? "safe" : "neutral"}>
            {agentsUnavailable
              ? "Roster unavailable"
              : `${state.briefing.crew.activeAgents} busy · ${state.briefing.crew.totalAgents} rostered`}
          </StatusBadge>
          {workerUnavailable || !state.briefing.crew.worker ? (
            <StatusBadge tone="warning">Phase 1C worker status unavailable</StatusBadge>
          ) : (
            <StatusBadge tone={workerTone(state.briefing.crew.worker)}>
              Phase 1C · {state.briefing.crew.worker.statusLabel}
            </StatusBadge>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={refreshing}
            onClick={() => void load()}
          >
            <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </div>

      {incomplete ? (
        <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] px-3 py-2.5 text-sm text-[var(--warning)]" role="status">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{incompleteMessage}</p>
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <BriefingLane
          title="Needs owner now"
          description="Decisions and failures that need owner attention."
          empty="Nothing in the live window needs owner attention."
          icon={AlertTriangle}
          tone="warning"
          section={state.briefing.needsYou}
          incomplete={incomplete}
        />
        <BriefingLane
          title="Underway"
          description="Work with recorded active execution."
          empty="No running work is visible in the live window."
          icon={Activity}
          tone="info"
          section={state.briefing.underway}
          incomplete={incomplete}
        />
        <BriefingLane
          title="Recently finished"
          description="Latest completed work and evidence."
          empty="No completed work is visible in the live window."
          icon={CheckCircle2}
          tone="safe"
          section={state.briefing.recentlyFinished}
          incomplete={incomplete}
        />
        <BriefingLane
          title="Up next"
          description="Queued, gated, and accepted work."
          empty="No waiting work is visible in the live window."
          icon={ListTodo}
          tone="neutral"
          section={state.briefing.upNext}
          incomplete={incomplete}
        />
      </div>

      <div className="mt-4 flex flex-col gap-2 border-t border-line pt-3 text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-1.5">
          <Clock3 className="size-3.5" aria-hidden="true" />
          Updated {formattedTime(state.updatedAt) ?? "just now"}
          {state.briefing.omittedCancelled > 0
            ? ` · ${state.briefing.omittedCancelled} cancelled item${state.briefing.omittedCancelled === 1 ? "" : "s"} omitted`
            : ""}
        </p>
        <p>Read-only bounded snapshot · up to 100 records per list source · actions re-authorize.</p>
      </div>
    </Card>
  );
}

function BriefingHeader() {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2.5">
        <Compass className="size-5 shrink-0 text-accent" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-foreground">Factory briefing</h2>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        One live view of what needs owner attention, what is moving, what landed, and what comes next.
      </p>
    </div>
  );
}

type LaneTone = "safe" | "info" | "warning" | "neutral";
function BriefingLane({
  title,
  description,
  empty,
  icon: Icon,
  tone,
  section,
  incomplete,
}: {
  title: string;
  description: string;
  empty: string;
  icon: LucideIcon;
  tone: LaneTone;
  section: BriefingSection;
  incomplete: boolean;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-line bg-surface p-3" aria-label={title}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
            {title}
          </h3>
          <p className="mt-1 text-xs text-faint">{description}</p>
        </div>
        <StatusBadge tone={tone} dot={false}>{section.total}</StatusBadge>
      </div>

      {section.items.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-line px-3 py-5 text-center text-xs text-faint">
          {incomplete ? "No items are visible in the sources that loaded." : empty}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {section.items.map((item) => <BriefingRow key={item.key} item={item} tone={tone} />)}
        </ul>
      )}
      {section.total > section.items.length ? (
        <p className="mt-2 text-xs text-faint">Showing {section.items.length} of {section.total}.</p>
      ) : null}
    </section>
  );
}

function BriefingRow({ item, tone }: { item: BriefingItem; tone: LaneTone }) {
  const occurred = formattedTime(item.occurredAt);
  return (
    <li className="min-w-0 rounded-md border border-line px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={tone} dot={false}>{item.label}</StatusBadge>
        {occurred ? <time dateTime={item.occurredAt ?? undefined} className="text-xs text-faint">{occurred}</time> : null}
      </div>
      <p className="mt-2 break-words text-sm font-medium text-foreground">{item.title}</p>
      <p className="mt-1 break-words text-xs text-muted">{item.detail}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <Link href={item.href} className="font-medium text-accent-text underline underline-offset-4">
          {item.actionLabel}
        </Link>
        {item.evidenceLabel ? (
          <ExternalEvidenceLink href={item.evidenceUrl}>{item.evidenceLabel}</ExternalEvidenceLink>
        ) : null}
      </div>
    </li>
  );
}
