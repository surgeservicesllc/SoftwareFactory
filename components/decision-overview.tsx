"use client";

import { Bot, FolderGit2, Loader2, RefreshCw, Workflow } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Card, SectionTitle } from "@/components/ui";
import { isBrowserSupabaseConfigured } from "@/lib/supabase/browser-config";

/**
 * The three numbers a person needs before choosing where to work.
 *
 * Every figure is counted from the same tenant endpoints the consoles
 * themselves read — `/api/projects`, `/api/commands`, `/api/bots` — so this
 * card can never claim a project, pipeline or bot that the console would not
 * show. A source that fails is reported as unavailable for that row rather
 * than rendered as a zero: "0 pipelines" and "we could not read your
 * pipelines" are different sentences, and only one of them is true.
 */

type State = "loading" | "signed-out" | "setup" | "ready" | "error";

type Counts = {
  projects: number | null;
  connectedProjects: number | null;
  pipelines: number | null;
  runningPipelines: number | null;
  bots: number | null;
};

const UNKNOWN: Counts = {
  projects: null,
  connectedProjects: null,
  pipelines: null,
  runningPipelines: null,
  bots: null,
};

type ProjectRow = {
  githubRepository: string | null;
  connectionId: string | null;
  connectionStatus: "connected" | "not_connected";
};
type CommandRow = { status: string };
type BotRow = { id: string };

/**
 * The `command_status` values that mean work is still ahead of this pipeline —
 * everything except the three terminal ones (`succeeded`, `failed`,
 * `cancelled`).
 */
const IN_FLIGHT = new Set(["submitted", "awaiting_approval", "queued", "running"]);

export function DecisionOverview({ authenticated }: { authenticated: boolean }) {
  const canLoad = isBrowserSupabaseConfigured() && authenticated;
  const [state, setState] = useState<State>(() => (canLoad ? "loading" : "signed-out"));
  const [counts, setCounts] = useState<Counts>(UNKNOWN);

  const load = useCallback(async () => {
    if (!canLoad) {
      setState("signed-out");
      setCounts(UNKNOWN);
      return;
    }
    setState("loading");

    const projectsResponse = await fetch("/api/projects", { cache: "no-store" }).catch(() => null);
    if (projectsResponse?.status === 401) {
      setState("signed-out");
      setCounts(UNKNOWN);
      return;
    }
    // No workspace yet: there is nothing to count, and saying so is not an error.
    if (projectsResponse?.status === 409) {
      setState("setup");
      setCounts(UNKNOWN);
      return;
    }

    const next: Counts = { ...UNKNOWN };

    if (projectsResponse?.ok) {
      const body = (await projectsResponse.json().catch(() => null)) as
        | { projects?: ProjectRow[]; connectedCount?: number }
        | null;
      const projects = body?.projects ?? [];
      next.projects = projects.length;
      next.connectedProjects = projects.filter(
        (project) =>
          project.connectionStatus === "connected"
          && Boolean(project.githubRepository)
          && Boolean(project.connectionId),
      ).length;
    }

    // The remaining reads are independent: a pipeline outage must not blank
    // the project count that was already read successfully.
    const [commandsResponse, botsResponse] = await Promise.all([
      fetch("/api/commands?limit=100", { cache: "no-store" }).catch(() => null),
      fetch("/api/bots", { cache: "no-store" }).catch(() => null),
    ]);

    if (commandsResponse?.ok) {
      const body = (await commandsResponse.json().catch(() => null)) as
        | { commands?: CommandRow[] }
        | null;
      const commands = body?.commands ?? [];
      next.pipelines = commands.length;
      next.runningPipelines = commands.filter((command) => IN_FLIGHT.has(command.status)).length;
    }

    if (botsResponse?.ok) {
      const body = (await botsResponse.json().catch(() => null)) as { bots?: BotRow[] } | null;
      next.bots = (body?.bots ?? []).length;
    }

    setCounts(next);
    // Every source failing is an outage worth naming; a single failed source
    // is reported on its own row.
    setState(
      next.projects === null && next.pipelines === null && next.bots === null ? "error" : "ready",
    );
  }, [canLoad]);

  useEffect(() => {
    if (!canLoad) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [canLoad, load]);

  const rows = [
    {
      key: "projects",
      icon: FolderGit2,
      label: "Projects",
      href: "/solutions/projects",
      value: counts.projects,
      detail:
        counts.connectedProjects === null
          ? null
          : `${counts.connectedProjects} connected to a repository`,
    },
    {
      key: "pipelines",
      icon: Workflow,
      label: "Pipelines",
      href: "/solutions/pipelines",
      value: counts.pipelines,
      detail:
        counts.runningPipelines === null
          ? null
          : counts.runningPipelines === 0
            ? "None in flight"
            : `${counts.runningPipelines} in flight`,
    },
    {
      key: "bots",
      icon: Bot,
      label: "Bots",
      href: "/solutions/bot-manager",
      value: counts.bots,
      detail: null,
    },
  ] as const;

  const message =
    state === "signed-out"
      ? "Sign in to see your workspace."
      : state === "setup"
        ? "Name a workspace and these numbers start counting."
        : state === "error"
          ? "Your workspace could not be read just now. Nothing is wrong with the data — try again."
          : null;

  return (
    <Card className="flex flex-col p-5">
      <SectionTitle
        title="Quick overview"
        description="Counted from your own records, not an estimate."
        action={
          <button
            type="button"
            onClick={() => void load()}
            disabled={state === "loading" || !canLoad}
            className="btn btn-secondary btn-sm"
            aria-label="Refresh the quick overview"
          >
            {state === "loading" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-4" aria-hidden="true" />
            )}
            Refresh
          </button>
        }
      />

      <div className="mt-4 flex-1">
        {state === "loading" ? (
          <div className="space-y-2" aria-busy="true">
            {rows.map((row) => (
              <div key={row.key} className="h-14 animate-pulse rounded-lg border border-line" />
            ))}
            <span className="sr-only">Loading your workspace overview</span>
          </div>
        ) : message ? (
          <p className="text-sm text-muted">{message}</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.key}
                className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5"
              >
                <span className="flex items-center gap-2.5">
                  <row.icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
                  <Link href={row.href} className="text-sm font-medium text-foreground hover:underline">
                    {row.label}
                  </Link>
                </span>
                <span className="text-right">
                  <span className="block font-mono text-sm font-semibold text-foreground">
                    {row.value === null ? "Unavailable" : row.value}
                  </span>
                  {row.value !== null && row.detail ? (
                    <span className="block text-xs text-faint">{row.detail}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
