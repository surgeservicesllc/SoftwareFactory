"use client";

import { ArrowRight, Bot, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Card, SetupSteps, StatusBadge, type SetupStep } from "@/components/ui";
import { isBrowserSupabaseConfigured } from "@/lib/supabase/browser-config";

type Project = {
  githubRepository: string | null;
  connectionId: string | null;
  connectionStatus: "connected" | "not_connected";
};
type Connection = { status?: string };
type State = "loading" | "signed-out" | "ready" | "error";

/**
 * The owner's front door: the four things that stand between signing in and a
 * working managed project, shown as a checklist that completes.
 *
 *   Connect GitHub → Add a project → Check the AI worker → Give a goal
 *
 * Each step's "done" is read from the same live sources the rest of the console
 * uses, so the guide can never claim a step is finished that isn't. Every
 * incomplete step links straight to the screen that finishes it (so a missing
 * piece is one click from being fixed), and once all four are done the guide
 * collapses into a single call to action: give the Factory a goal in Bot
 * Manager. Reads are best-effort and independent — a worker-status hiccup never
 * blocks the GitHub or project signal, it just leaves that one step unchecked.
 */
export function GettingStarted({ authenticated }: { authenticated: boolean }) {
  const canLoad = isBrowserSupabaseConfigured() && authenticated;
  const [state, setState] = useState<State>(() => (canLoad ? "loading" : "signed-out"));
  const [githubConnected, setGithubConnected] = useState(false);
  const [projectConnected, setProjectConnected] = useState(false);
  const [accountConnected, setAccountConnected] = useState(false);
  const [workerReady, setWorkerReady] = useState(false);
  const [goalGiven, setGoalGiven] = useState(false);

  const load = useCallback(async () => {
    if (!canLoad) {
      setState("signed-out");
      return;
    }
    setState("loading");
    try {
      const projectsResponse = await fetch("/api/projects", { cache: "no-store" });
      if (projectsResponse.status === 401) {
        setState("signed-out");
        return;
      }

      // A connected project (live repository binding) is the strongest signal,
      // and it implies GitHub is connected. 409 means the organization is not
      // set up yet, which simply leaves everything unchecked.
      let connectedProject = false;
      if (projectsResponse.ok) {
        const body = (await projectsResponse.json()) as { projects?: Project[] };
        connectedProject = (body.projects ?? []).some(
          (project) =>
            project.connectionStatus === "connected"
            && Boolean(project.githubRepository)
            && Boolean(project.connectionId),
        );
      }

      // GitHub can be connected before any project is linked, so check it
      // directly; a connected project also counts.
      let anyGithub = connectedProject;
      try {
        const connectionsResponse = await fetch("/api/github/connections", { cache: "no-store" });
        if (connectionsResponse.ok) {
          const body = (await connectionsResponse.json()) as { connections?: Connection[] };
          anyGithub = anyGithub
            || (body.connections ?? []).some((connection) => connection.status === "connected");
        }
      } catch {
        // Leave the GitHub signal as the project-derived value.
      }

      // Signing in a provider account is its own step, and the worker's
      // connection is not a substitute: a running worker with no account
      // connected would tick a box the person has not done. This reads the
      // accounts directly.
      let account = false;
      try {
        const accountsResponse = await fetch("/api/ai-accounts", { cache: "no-store" });
        if (accountsResponse.ok) {
          const body = (await accountsResponse.json()) as { accounts?: { status?: string }[] };
          account = (body.accounts ?? []).some((entry) => entry.status === "connected");
        }
      } catch {
        // No account signal leaves the step unchecked, never errors the guide.
      }

      let worker = false;
      try {
        const workerResponse = await fetch("/api/worker/status", { cache: "no-store" });
        if (workerResponse.ok) {
          const body = (await workerResponse.json()) as { worker?: { connectionStatus?: string } };
          worker = body.worker?.connectionStatus === "connected";
        }
      } catch {
        // A worker-status failure leaves the step unchecked, never errors the guide.
      }

      let goal = false;
      try {
        const commandsResponse = await fetch("/api/commands", { cache: "no-store" });
        if (commandsResponse.ok) {
          const body = (await commandsResponse.json()) as { commands?: unknown[] };
          goal = (body.commands ?? []).length > 0;
        }
      } catch {
        // No goal signal; the final step stays open.
      }

      setGithubConnected(anyGithub);
      setAccountConnected(account);
      setProjectConnected(connectedProject);
      setWorkerReady(worker);
      setGoalGiven(goal);
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

  const steps = useMemo<SetupStep[]>(
    () => [
      {
        title: "Connect GitHub",
        description: "Authorize the GitHub App and choose which repositories SoftwareFactory may read.",
        href: "/solutions/connections",
        action: "Connect",
        done: githubConnected,
      },
      {
        // The step that used to be missing entirely. Connecting Claude or
        // Codex is what makes a bot possible, and it is the longest part of
        // first-run setup — leaving it out of the guide meant the one screen
        // that explains the journey never mentioned it.
        title: "Connect an AI account",
        description: "Sign in to Claude or Codex with the account you already use. No API key needed.",
        href: "/solutions/bot-manager",
        action: "Connect an account",
        done: accountConnected,
      },
      {
        title: "Add a project",
        description: "Link a repository so the Factory has somewhere to plan, build, and open pull requests.",
        href: "/solutions/projects",
        action: "Add project",
        done: projectConnected,
      },
      {
        title: "Check your AI worker",
        description: "Confirm a worker is connected and ready to pick up the work your bots are given.",
        href: "/solutions/bot-manager",
        action: "Open Bot Manager",
        done: workerReady,
      },
      {
        title: "Give your Factory a goal",
        description: "Describe what you want in plain English. The Factory turns it into planned, reviewed work.",
        href: "/solutions/bot-manager",
        action: "Give a goal",
        done: goalGiven,
      },
    ],
    [githubConnected, accountConnected, projectConnected, workerReady, goalGiven],
  );

  const firstOpen = steps.findIndex((step) => !step.done);
  const allDone = firstOpen === -1;

  // Once everything is connected the checklist has done its job; replace it with
  // the one action the owner returns for — describing what they want done.
  if (state === "ready" && allDone) {
    return (
      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--accent-surface)] text-[var(--accent-text)]">
            <Bot className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Your Factory is ready</h2>
            <p className="mt-1 text-sm text-muted">
              GitHub, a project, and a worker are all connected. Tell the Factory what you want
              accomplished — it handles the technical details.
            </p>
          </div>
        </div>
        <Link href="/solutions/bot-manager" className="btn btn-primary shrink-0 self-start sm:self-auto">
          Give your Factory a goal
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </Card>
    );
  }

  return (
    <section aria-labelledby="getting-started-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="getting-started-title" className="text-lg font-semibold text-foreground">
            Get started
          </h2>
          <p className="mt-1 text-sm text-muted">
            Four steps from here to a managed project. Nothing runs on its own — you stay in control
            of every release.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge tone={state === "error" ? "danger" : "neutral"}>
            {state === "signed-out"
              ? "Sign in required"
              : state === "error"
                ? "Status unavailable"
                : state === "loading"
                  ? "Checking setup"
                  : `${steps.filter((step) => step.done).length} of ${steps.length} done`}
          </StatusBadge>
          {canLoad ? (
            <button
              type="button"
              onClick={() => void load()}
              disabled={state === "loading"}
              className="btn btn-secondary btn-sm"
              aria-label="Refresh setup status"
            >
              {state === "loading" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Refresh
            </button>
          ) : null}
        </div>
      </div>
      <SetupSteps steps={steps} current={firstOpen === -1 ? steps.length - 1 : firstOpen} />
    </section>
  );
}
