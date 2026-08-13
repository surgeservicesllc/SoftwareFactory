"use client";

import { FolderGit2, GitPullRequestArrow, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { MetricCard, SetupSteps, StatusBadge, type SetupStep } from "@/components/ui";
import { isBrowserSupabaseConfigured } from "@/lib/supabase/browser-config";

type Project = { id: string; githubRepository: string | null; defaultBranch: string; connectionId: string | null; connectionStatus: "connected" | "not_connected" };
type PullRequest = { id: number; state: string };
type State = "loading" | "signed-out" | "setup" | "ready" | "error";

export function LiveDashboardMetrics() {
  const supabaseConfigured = isBrowserSupabaseConfigured();
  const [state, setState] = useState<State>(() => supabaseConfigured ? "loading" : "signed-out");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectRowCount, setProjectRowCount] = useState(0);
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
      setProjectRowCount(allProjects.length);
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

  /*
   * Setup progress is derived from the single /api/projects read the metrics
   * already need. Any stored project proves GitHub was connected; a connected
   * project proves the link is currently live.
   */
  const steps = useMemo<SetupStep[]>(() => {
    const githubConnected = state === "ready" && projectRowCount > 0;
    const projectLinked = state === "ready" && connectedCount > 0;
    return [
      {
        title: "Connect GitHub",
        description: "Authorize the GitHub App and pick which repositories SoftwareFactory may read.",
        href: "/connections",
        action: "Connect",
        done: githubConnected,
      },
      {
        title: "Add a project",
        description: "Link one of those repositories so its branches, commits, and pull requests appear here.",
        href: "/projects",
        action: "Add project",
        done: projectLinked,
      },
      {
        title: "Open your files",
        description: "Browse the repository, edit a file, and send the change out as a draft pull request.",
        href: "/files",
        action: "Browse files",
        done: false,
      },
    ];
  }, [connectedCount, projectRowCount, state]);

  const currentStep = steps.findIndex((step) => !step.done);
  const allSetUp = connectedCount > 0 && state === "ready";

  return (
    <div className="space-y-8">
      <section aria-labelledby="setup-title">
        <div className="mb-3">
          <h2 id="setup-title" className="text-lg font-semibold text-foreground">
            {allSetUp ? "Your setup" : "Get started in three steps"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {allSetUp
              ? "Everything below is connected. Jump back into any step to make a change."
              : "Nothing here runs on its own. You connect a repository, and SoftwareFactory shows you what is in it."}
          </p>
        </div>
        <SetupSteps steps={steps} current={currentStep === -1 ? steps.length - 1 : currentStep} />
      </section>

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
          {/* Without a live GitHub connection there is no pull-request total to
              state, so the count stays blank rather than implying a real zero. */}
          <MetricCard
            label="Open pull requests"
            value={githubConnected && openPullRequests !== null ? String(openPullRequests) : "—"}
            detail={state === "ready"
              ? !githubConnected
                ? "GitHub Not Connected"
                : openPullRequests === null
                  ? "Incomplete — one or more GitHub reads failed"
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
