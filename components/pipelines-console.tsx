"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleDotDashed,
  Loader2,
  Workflow,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { formatDateTime } from "@/lib/format/date";
import { commandProgress } from "@/components/commands-console";
import { GraphRunsPanel } from "@/components/graph-runs-panel";
import { PipelineTemplatesManager } from "@/components/pipeline-templates-manager";
import { BlockedState, Card, SectionTitle, StatusBadge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ClearSurfaceButton } from "@/components/clear-surface-button";
import { SelectionDeleteButton } from "@/components/selection-delete-button";

/**
 * Pipelines: the lifecycle view over the records that already govern work.
 * A pipeline run here IS a saved command — goal in, verification, queue,
 * worker execution, draft PR out — read live from the same table the Bot
 * Manager writes. Nothing on this page is a separate pipeline store, because
 * duplicating the lifecycle would let the two views disagree.
 *
 * Templates are the compiled graph templates the engine already versions;
 * they arrive server-compiled from the page so the topology facts are exact.
 */

type CommandView = {
  id: string;
  prompt: string;
  risk: string;
  status: string;
  submittedAt: string;
  completedAt: string | null;
  project: { id: string; name: string } | null;
};

export type PipelineTemplateSummary = {
  key: string;
  name: string;
  category: string;
  summary: string;
  version: number;
  topology: string | null;
  nodeCount: number | null;
  maxParallelism: number | null;
  /**
   * Nodes needing a workspace with real command execution — run the tests,
   * attempt the reproduction. The analysis worker provides no such executor
   * and, since migration 20260819001000, does not claim a graph containing
   * one. A person choosing this template should know that before the graph is
   * recorded, not after it sits unclaimed.
   */
  anchorNodeCount: number | null;
  compiles: boolean;
};

type State = "loading" | "signed-out" | "setup" | "ready" | "error";

const ACTIVE_STATUSES = new Set(["submitted", "awaiting_approval", "queued", "running"]);

/**
 * The lifecycle in human words. Which stage a run is in comes from the
 * command status the worker itself advances — never from a timer or a guess.
 */
export function pipelineStage(status: string): {
  label: string;
  tone: "neutral" | "info" | "safe" | "warning" | "danger";
  needsOwner: boolean;
} {
  switch (status) {
    case "submitted":
      return { label: "Intake", tone: "info", needsOwner: false };
    case "awaiting_approval":
      return { label: "Waiting for your approval", tone: "warning", needsOwner: true };
    case "queued":
      return { label: "Planning", tone: "info", needsOwner: false };
    case "running":
      return { label: "Building", tone: "info", needsOwner: false };
    case "succeeded":
      return { label: "Complete", tone: "safe", needsOwner: false };
    case "failed":
      return { label: "Failed", tone: "danger", needsOwner: false };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral", needsOwner: false };
    default:
      return { label: status.replaceAll("_", " "), tone: "neutral", needsOwner: false };
  }
}

/** Shared, and safe: an unparseable time renders a dash, not a thrown page. */
const formatDate = formatDateTime;

function formatDuration(startIso: string, endIso: string | null): string {
  const start = Date.parse(startIso);
  const end = endIso ? Date.parse(endIso) : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "—";
  const minutes = Math.floor((end - start) / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

export function PipelinesConsole({ templates }: { templates: readonly PipelineTemplateSummary[] }) {
  const searchParams = useSearchParams();
  const view = searchParams.get("view") === "all"
    ? "all"
    : searchParams.get("view") === "templates"
      ? "templates"
      : searchParams.get("view") === "graphs"
        ? "graphs"
        : "active";
  const [state, setState] = useState<State>("loading");
  const [commands, setCommands] = useState<CommandView[]>([]);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/commands", { cache: "no-store" });
      if (response.status === 401) {
        setState("signed-out");
        return;
      }
      if (response.status === 409) {
        setState("setup");
        return;
      }
      const body = (await response.json()) as { commands?: CommandView[]; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Pipelines could not be loaded.");
      const loaded = body.commands ?? [];
      setCommands(loaded);
      // A tick on a row that has since gone — deleted here or finished
      // elsewhere — must not linger in the selection and be sent again.
      const present = new Set(loaded.map((command) => command.id));
      setSelected((previous) => {
        const kept = [...previous].filter((id) => present.has(id));
        return kept.length === previous.size ? previous : new Set(kept);
      });
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Pipelines could not be loaded.");
      setState("error");
    }
  }, []);

  const toggleOne = useCallback((id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    // Live view: the worker advances statuses on its own cadence.
    const interval = window.setInterval(() => void load(), 15_000);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(interval);
    };
  }, [load]);

  if (state === "loading") {
    return (
      <Card className="grid min-h-64 place-items-center">
        <Loader2 className="size-6 animate-spin text-accent" aria-label="Loading pipelines" />
      </Card>
    );
  }
  if (state === "signed-out") return <BlockedState icon={Workflow} title="Sign in to see your pipelines" description="Pipeline runs belong to your organization." href="/auth/sign-in?next=/solutions/pipelines" label="Sign in" />;
  if (state === "setup") return <BlockedState icon={Workflow} title="Finish setting up" description="Create or choose a workspace first." href="/solutions/connections" label="Open connections" />;
  if (state === "error") return <BlockedState icon={Workflow} title="Pipelines are unavailable" description={message || "Pipeline runs could not be loaded."} href="/solutions/bot-manager" label="Open Bot Manager" />;

  const active = commands.filter((command) => ACTIVE_STATUSES.has(command.status));
  const needsOwner = active.filter((command) => pipelineStage(command.status).needsOwner);
  const isList = view !== "templates" && view !== "graphs";
  const visible = view === "active" ? active : commands;
  // Only rows on screen can be acted on, so the count beside the button and
  // the ids the button sends are the same set the ticks describe.
  const selectedVisible = visible.filter((command) => selected.has(command.id));
  const allVisibleSelected = visible.length > 0 && selectedVisible.length === visible.length;

  return (
    <div className="space-y-4">
      <nav aria-label="Pipeline views" className="flex flex-wrap gap-1 border-b border-line">
        {([
          { key: "active", label: "Active", href: "/solutions/pipelines" },
          { key: "all", label: "All Pipelines", href: "/solutions/pipelines?view=all" },
          { key: "templates", label: "Templates", href: "/solutions/pipelines?view=templates" },
          { key: "graphs", label: "Graph runs", href: "/solutions/pipelines?view=graphs" },
        ] as const).map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.key === view ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab.key === view
                ? "border-[var(--accent)] text-foreground"
                : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {/*
        * Two controls, two scopes. Delete selected acts on the rows ticked
        * below and is offered on both lists, because picking one pipeline out
        * of a live list is a normal thing to want. Clear all pipelines stays
        * on All Pipelines only (owner instruction, 2026-08-22): beside work in
        * flight, a whole-list clear invites exactly the press the function
        * then refuses.
        */}
      {isList && visible.length > 0 ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              // Some but not all: the box says "partly", not "none".
              ref={(node) => {
                if (node) node.indeterminate = selectedVisible.length > 0 && !allVisibleSelected;
              }}
              onChange={() => {
                setSelected((previous) => {
                  const next = new Set(previous);
                  if (allVisibleSelected) for (const command of visible) next.delete(command.id);
                  else for (const command of visible) next.add(command.id);
                  return next;
                });
              }}
            />
            <span>
              {selectedVisible.length > 0
                ? `${selectedVisible.length} of ${visible.length} selected`
                : `Select all ${visible.length}`}
            </span>
          </label>
          <div className="flex flex-wrap items-start justify-end gap-3">
            <SelectionDeleteButton
              endpoint="/api/commands/delete"
              selectedIds={selectedVisible.map((command) => command.id)}
              noun="pipeline"
              idFieldName="commandIds"
              includeFlagName="includeCommandsWithRuns"
              includeFlagLabel="Also delete selected pipelines that already have run history. Deleting these removes their work items and those runs too."
              onDeleted={load}
            />
            {view === "all" ? (
              <ClearSurfaceButton
                endpoint="/api/commands/clear"
                label="Clear all pipelines"
                noun="pipeline"
                includeFlagName="includeCommandsWithRuns"
                includeFlagLabel="Also clear pipelines that already have run history. Deleting these removes their work items and those runs too."
                onCleared={load}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {view !== "templates" && view !== "graphs" ? (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Card className="p-4">
            <p className="text-sm text-faint">Active now</p>
            <p className="mt-1 text-xl font-semibold text-foreground">{active.length}</p>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-faint">Need your approval</p>
            <p className={cn("mt-1 text-xl font-semibold", needsOwner.length ? "text-[var(--warning)]" : "text-foreground")}>
              {needsOwner.length}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-faint">Completed</p>
            <p className="mt-1 text-xl font-semibold text-foreground">
              {commands.filter((command) => command.status === "succeeded").length}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-faint">Failed</p>
            <p className="mt-1 text-xl font-semibold text-foreground">
              {commands.filter((command) => command.status === "failed").length}
            </p>
          </Card>
        </div>
      ) : null}

      {view === "templates" ? (
        <PipelineTemplatesManager builtIns={templates} />
      ) : view === "graphs" ? (
        <GraphRunsPanel />
      ) : (
        <PipelineList
          commands={visible}
          selected={selected}
          onToggle={toggleOne}
          emptyTitle={view === "active" ? "Nothing is running" : "No pipeline runs yet"}
          emptyDescription={
            view === "active"
              ? "A pipeline starts when you give a bot work. Describe the goal and the rest — verification, queueing, execution, draft pull request — follows."
              : "Every goal you submit becomes a pipeline run and is kept here with its outcome."
          }
        />
      )}
    </div>
  );
}

function PipelineList({
  commands,
  selected,
  onToggle,
  emptyTitle,
  emptyDescription,
}: {
  commands: CommandView[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (!commands.length) {
    return (
      <Card className="p-5 sm:p-6">
        <SectionTitle title={emptyTitle} description={emptyDescription} />
        <Link href="/solutions/bot-manager" className="btn btn-primary btn-sm mt-4">
          <Workflow className="size-4" aria-hidden="true" />
          Start a pipeline
        </Link>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-[var(--border)]">
        {commands.map((command) => {
          const stage = pipelineStage(command.status);
          const progress = commandProgress(command.status);
          const StageIcon = stage.tone === "safe"
            ? CheckCircle2
            : stage.tone === "danger"
              ? XCircle
              : stage.needsOwner
                ? AlertTriangle
                : CircleDotDashed;
          return (
            <li key={command.id} className="flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="checkbox"
                  className="shrink-0"
                  checked={selected.has(command.id)}
                  onChange={() => onToggle(command.id)}
                  // The prompt is the row's name; a screen reader should hear
                  // which pipeline the tick belongs to, not "checkbox".
                  aria-label={`Select pipeline: ${command.prompt}`}
                />
                <StageIcon
                  className={cn(
                    "size-4 shrink-0",
                    stage.tone === "safe"
                      ? "text-accent"
                      : stage.tone === "danger"
                        ? "text-[var(--danger)]"
                        : stage.needsOwner
                          ? "text-[var(--warning)]"
                          : "text-faint",
                  )}
                  aria-hidden="true"
                />
                <p className="min-w-0 flex-1 truncate font-medium text-foreground" title={command.prompt}>
                  {command.prompt}
                </p>
                <StatusBadge tone={stage.tone} dot={false}>{stage.label}</StatusBadge>
                <StatusBadge tone={command.risk === "RED" ? "danger" : command.risk === "YELLOW" ? "warning" : "safe"} dot={false}>
                  {command.risk}
                </StatusBadge>
              </div>
              <p className="text-sm text-muted">
                {command.project ? `${command.project.name} · ` : ""}
                {command.completedAt
                  ? `finished ${formatDate(command.completedAt)} · took ${formatDuration(command.submittedAt, command.completedAt)}`
                  : `started ${formatDate(command.submittedAt)} · ${formatDuration(command.submittedAt, null)} elapsed`}
              </p>
              <p className="text-sm text-faint">
                {progress.hint}
                {progress.trackable ? (
                  <>
                    {" "}
                    <Link href="/solutions/runs" className="font-medium text-accent">Watch it on Runs</Link>
                  </>
                ) : null}
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
