"use client";

import { FolderGit2, GitPullRequestArrow, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { MetricCard, StatusBadge } from "@/components/ui";
import { isBrowserSupabaseConfigured } from "@/lib/supabase/browser-config";

type Project = { id: string; githubRepository: string | null; defaultBranch: string; connectionId: string | null; connectionStatus: "connected" | "not_connected" };
type PullRequest = { id: number; state: string };
type State = "loading" | "signed-out" | "setup" | "ready" | "error";

export function LiveDashboardMetrics({ authenticated }: { authenticated: boolean }) {
  const supabaseConfigured = isBrowserSupabaseConfigured();
  const canLoad = supabaseConfigured && authenticated;
  const [state, setState] = useState<State>(() => canLoad ? "loading" : "signed-out");
  const [projects, setProjects] = useState<Project[]>([]);
  const [connectedCount, setConnectedCount] = useState(0);
  const [openPullRequests, setOpenPullRequests] = useState<number | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!canLoad) {
      setState("signed-out");
      return;
    }
    setState("loading");
    setWarnings([]);
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      if (response.status === 401) { setState("signed-out"); return; }
      if (response.status === 409) { setState("setup"); return; }
      const body = (await response.json()) as { projects?: Project[]; connectedCount?: number; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Live project metrics could not be loaded.");
      const allProjects = body.projects ?? [];
      const liveProjects = allProjects.filter(
        (project) => project.connectionStatus === "connected"
          && project.githubRepository
          && project.connectionId,
      );
      const reportedConnectedCount = body.connectedCount;
      if (
        typeof reportedConnectedCount !== "number"
        || !Number.isSafeInteger(reportedConnectedCount)
        || reportedConnectedCount !== liveProjects.length
      ) {
        throw new Error("Live project connection status was inconsistent.");
      }
      setProjects(liveProjects);
      setConnectedCount(reportedConnectedCount);
      if (!liveProjects.length) {
        setOpenPullRequests(0);
        setState("ready");
        return;
      }
      const results = await Promise.allSettled(liveProjects.map(async (project) => {
        const [owner = "", repository = ""] = project.githubRepository!.split("/");
        const pullResponse = await fetch(`/api/github/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls?connectionId=${encodeURIComponent(project.connectionId!)}`, { cache: "no-store" });
        const pullBody = (await pullResponse.json()) as { pullRequests?: PullRequest[]; error?: { message?: string } };
        if (!pullResponse.ok) throw new Error(pullBody.error?.message ?? `${project.githubRepository} pull requests unavailable.`);
        return (pullBody.pullRequests ?? []).filter((pullRequest) => pullRequest.state === "open").length;
      }));
      const nextWarnings: string[] = [];
      let total = 0;
      let successCount = 0;
      results.forEach((result) => {
        if (result.status === "fulfilled") { total += result.value; successCount += 1; }
        else nextWarnings.push(result.reason instanceof Error ? result.reason.message : "A repository PR count is unavailable.");
      });
      setWarnings(nextWarnings);
      setOpenPullRequests(successCount === liveProjects.length ? total : null);
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

  const githubConnected = state === "ready" && connectedCount > 0;
  const statusLabel = useMemo(
    () => state === "ready"
      ? githubConnected ? "Live · Supabase + GitHub" : "Live · Supabase · GitHub Not Connected"
      : state === "signed-out"
        ? "Sign in required"
        : state === "setup"
          ? "Organization setup required"
          : state === "error"
            ? "Live source unavailable"
            : "Loading live source",
    [githubConnected, state],
  );

  return (
    <div className="space-y-8">
      <section aria-labelledby="live-metrics-title">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="live-metrics-title" className="text-lg font-semibold text-foreground">Live numbers</h2>
            <p className="mt-1 text-sm text-muted">Read from your own Supabase records and from GitHub.</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge tone={githubConnected ? "safe" : state === "error" ? "danger" : "neutral"}>{statusLabel}</StatusBadge>
            <button type="button" onClick={() => void load()} disabled={state === "loading"} className="btn btn-secondary btn-sm" aria-label="Refresh live dashboard metrics">
              {state === "loading" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Refresh
            </button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <MetricCard
            label="Connected projects"
            value={state === "ready" ? String(connectedCount) : "—"}
            detail={state === "ready" ? "Live projects stored in Supabase" : statusLabel}
            icon={FolderGit2}
            tone={connectedCount ? "safe" : "neutral"}
            demo={false}
          />
          <MetricCard
            label="Open pull requests"
            value={githubConnected && openPullRequests !== null ? String(openPullRequests) : "—"}
            detail={state === "ready"
              ? !githubConnected
                ? "GitHub Not Connected"
                : openPullRequests === null
                ? "Incomplete — a GitHub read failed"
                : `Live across ${projects.length} connected project${projects.length === 1 ? "" : "s"}`
              : statusLabel}
            icon={GitPullRequestArrow}
            tone={openPullRequests === null ? "warning" : "info"}
            demo={false}
          />
        </div>
        {warnings.length ? (
          <p className="mt-3 text-sm text-[var(--warning)]">
            {warnings.length} live repository source{warnings.length === 1 ? " is" : "s are"} unavailable, so no partial pull-request total is shown.
          </p>
        ) : null}
      </section>
    </div>
  );
}
