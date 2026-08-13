"use client";

import { FolderGit2, GitPullRequestArrow, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { MetricCard, Panel, StatusBadge } from "@/components/ui";

type Project = { id: string; githubRepository: string | null; defaultBranch: string; connectionId: string | null; connectionStatus: "connected" | "not_connected" };
type PullRequest = { id: number; state: string };
type State = "loading" | "signed-out" | "setup" | "ready" | "error";

function isBrowserSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    && (
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
      || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
    ),
  );
}

export function LiveDashboardMetrics() {
  const supabaseConfigured = isBrowserSupabaseConfigured();
  const [state, setState] = useState<State>(() => supabaseConfigured ? "loading" : "signed-out");
  const [projects, setProjects] = useState<Project[]>([]);
  const [connectedCount, setConnectedCount] = useState(0);
  const [openPullRequests, setOpenPullRequests] = useState<number | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!supabaseConfigured) {
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
      const liveProjects = (body.projects ?? []).filter(
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
  }, [supabaseConfigured]);

  useEffect(() => {
    if (!supabaseConfigured) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, supabaseConfigured]);
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
    <section className="mb-6" aria-labelledby="live-metrics-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 id="live-metrics-title" className="eyebrow">Live control-plane metrics</h2><p className="mt-1 text-[10px] text-[#8592a3]">Tenant-scoped records with on-demand GitHub reads; never mixed into demo totals.</p></div><div className="flex items-center gap-2"><StatusBadge tone={githubConnected ? "safe" : state === "error" ? "danger" : "neutral"}>{statusLabel}</StatusBadge><button type="button" onClick={() => void load()} disabled={state === "loading"} className="secondary-action" aria-label="Refresh live dashboard metrics">{state === "loading" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}Refresh</button></div></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Connected projects" value={state === "ready" ? String(connectedCount) : "—"} detail={state === "ready" ? "Live projects stored in Supabase" : statusLabel} icon={FolderGit2} tone={connectedCount ? "safe" : "neutral"} demo={false} />
        <MetricCard label="Open pull requests" value={githubConnected && openPullRequests !== null ? String(openPullRequests) : "—"} detail={state === "ready" ? !githubConnected ? "GitHub Not Connected" : openPullRequests === null ? "Incomplete — one or more GitHub reads failed" : `Live across ${projects.length} connected project${projects.length === 1 ? "" : "s"}` : statusLabel} icon={GitPullRequestArrow} tone={openPullRequests === null ? "warning" : "info"} demo={false} />
        <Panel className="p-4 sm:col-span-2"><p className="eyebrow">Live source boundary</p><p className="mt-3 text-xs leading-5 text-[#8490a0]">Only connected projects and GitHub pull requests appear here. Agent work, deployments, tests, incidents, and owner attention below remain clearly labeled Demo Data until their providers are verified.</p>{warnings.length ? <p className="mt-3 text-[10px] leading-5 text-[#d7b96d]">{warnings.length} live repository source{warnings.length === 1 ? " is" : "s are"} unavailable. No partial PR total is shown.</p> : null}</Panel>
      </div>
    </section>
  );
}
