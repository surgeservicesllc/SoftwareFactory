"use client";

import {
  ArrowRight,
  Bot,
  Check,
  Factory,
  GitBranch,
  Loader2,
  PlugZap,
  Settings2,
  Terminal,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { pipelineStage } from "@/components/pipelines-console";
import { BlockedState, Card, StatusBadge } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * AI Factory: the guided end-to-end journey, connected over the flows that
 * already exist. Each step's completion is derived from the live records the
 * step produces — a connected installation, a project, a connected account,
 * an assignment, a saved command — never from a stored wizard state. That is
 * what makes progress survive refresh and navigation by construction, and
 * what makes this page unable to disagree with the rest of the console.
 */

type StepId =
  | "connect_github"
  | "create_project"
  | "pipeline"
  | "connect_bots"
  | "assign_bots"
  | "configure_bots"
  | "command"
  | "watch";

type FactoryData = {
  connectedInstallations: number;
  repositories: number;
  projects: Array<{ id: string; name: string }>;
  connectedAccounts: number;
  bots: number;
  assignments: number;
  configuredAssignments: number;
  commands: Array<{ id: string; prompt: string; status: string; project: { id: string; name: string } | null }>;
};

type State =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "setup" }
  | { kind: "ready"; data: FactoryData };

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function AiFactoryConsole() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      const [connections, projects, accounts, bots, commands] = await Promise.allSettled([
        fetch("/api/github/connections", { cache: "no-store" }),
        fetch("/api/projects", { cache: "no-store" }),
        fetch("/api/ai-accounts", { cache: "no-store" }),
        fetch("/api/bots", { cache: "no-store" }),
        fetch("/api/commands", { cache: "no-store" }),
      ]);

      const first = connections.status === "fulfilled" ? connections.value : null;
      if (first && first.status === 401) {
        setState({ kind: "signed-out" });
        return;
      }
      if (first && first.status === 409) {
        setState({ kind: "setup" });
        return;
      }

      const data: FactoryData = {
        connectedInstallations: 0,
        repositories: 0,
        projects: [],
        connectedAccounts: 0,
        bots: 0,
        assignments: 0,
        configuredAssignments: 0,
        commands: [],
      };

      if (first?.ok) {
        const body = await readJson<{ connections?: Array<{ status: string; installation: unknown; repositories?: Array<{ selected: boolean; archived: boolean }> }> }>(first);
        const live = (body?.connections ?? []).filter((connection) => connection.status === "connected" && connection.installation);
        data.connectedInstallations = live.length;
        data.repositories = live.reduce(
          (sum, connection) => sum + (connection.repositories ?? []).filter((repository) => repository.selected && !repository.archived).length,
          0,
        );
      }
      if (projects.status === "fulfilled" && projects.value.ok) {
        const body = await readJson<{ projects?: Array<{ id: string; name: string }> }>(projects.value);
        data.projects = (body?.projects ?? []).map((project) => ({ id: project.id, name: project.name }));
      }
      if (accounts.status === "fulfilled" && accounts.value.ok) {
        const body = await readJson<{ accounts?: Array<{ status: string }> }>(accounts.value);
        data.connectedAccounts = (body?.accounts ?? []).filter((account) => account.status === "connected").length;
      }
      if (bots.status === "fulfilled" && bots.value.ok) {
        const body = await readJson<{
          bots?: unknown[];
          assignments?: Array<{ status?: string; roleId?: string | null; responsibilities?: unknown[] }>;
        }>(bots.value);
        data.bots = (body?.bots ?? []).length;
        const active = (body?.assignments ?? []).filter((assignment) => assignment.status !== "released");
        data.assignments = active.length;
        data.configuredAssignments = active.filter(
          (assignment) => assignment.roleId || (assignment.responsibilities ?? []).length > 0,
        ).length;
      }
      if (commands.status === "fulfilled" && commands.value.ok) {
        const body = await readJson<{ commands?: FactoryData["commands"] }>(commands.value);
        data.commands = body?.commands ?? [];
      }

      setState({ kind: "ready", data });
    } catch {
      setState((current) => (current.kind === "ready" ? current : { kind: "signed-out" }));
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 20_000);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(interval);
    };
  }, [load]);

  if (state.kind === "loading") {
    return (
      <Card className="grid min-h-64 place-items-center">
        <Loader2 className="size-6 animate-spin text-accent" aria-label="Loading the factory" />
      </Card>
    );
  }
  if (state.kind === "signed-out") {
    return <BlockedState icon={Factory} title="Sign in to run your factory" description="The guided journey reads your workspace's live state." href="/auth/sign-in?next=/solutions/ai-factory" label="Sign in" />;
  }
  if (state.kind === "setup") {
    return <BlockedState icon={Factory} title="Finish setting up" description="Create or choose a workspace first." href="/solutions/connections" label="Open connections" />;
  }

  const { data } = state;
  const firstProject = data.projects[0] ?? null;
  const hasSucceededCommand = data.commands.some((command) => command.status === "succeeded");

  const steps: Array<{
    id: StepId;
    title: string;
    description: string;
    done: boolean;
    evidence: string;
    href: string;
    action: string;
    icon: typeof Factory;
  }> = [
    {
      id: "connect_github",
      title: "Connect Repository",
      description: "Authorize GitHub and choose the repositories your factory may work on.",
      done: data.connectedInstallations > 0,
      evidence: data.connectedInstallations > 0
        ? `${data.connectedInstallations} installation${data.connectedInstallations === 1 ? "" : "s"} · ${data.repositories} repositor${data.repositories === 1 ? "y" : "ies"} authorized`
        : "No GitHub installation yet",
      href: "/solutions/connections",
      action: "Connect GitHub",
      icon: GitBranch,
    },
    {
      id: "create_project",
      title: "Create Project",
      description: "A project is one repository. Name it and it persists with its branch and history.",
      done: data.projects.length > 0,
      evidence: data.projects.length > 0
        ? `${data.projects.length} project${data.projects.length === 1 ? "" : "s"}: ${data.projects.slice(0, 3).map((project) => project.name).join(", ")}`
        : "No project yet",
      href: "/solutions/projects#add-project",
      action: "Create a project",
      icon: Factory,
    },
    {
      id: "pipeline",
      title: "Pipeline Ready",
      description: "Every goal runs the same verified lifecycle. Thirteen built-in templates are compiled and ready; add your own.",
      done: data.projects.length > 0,
      evidence: "Intake → Planning → Building → Draft PR, with CI on every pull request",
      href: "/solutions/pipelines?view=templates",
      action: "Review templates",
      icon: Workflow,
    },
    {
      id: "connect_bots",
      title: "Connect Bots",
      description: "Sign in with the AI accounts you already pay for — Claude and Codex today.",
      done: data.connectedAccounts > 0,
      evidence: data.connectedAccounts > 0
        ? `${data.connectedAccounts} account${data.connectedAccounts === 1 ? "" : "s"} connected · ${data.bots} bot${data.bots === 1 ? "" : "s"}`
        : "No AI account connected yet",
      href: "/solutions/bot-manager#connect",
      action: "Connect a bot",
      icon: PlugZap,
    },
    {
      id: "assign_bots",
      title: "Assign Bots to Project",
      description: "Put one or many bots on each project.",
      done: data.assignments > 0,
      evidence: data.assignments > 0
        ? `${data.assignments} active assignment${data.assignments === 1 ? "" : "s"}`
        : "No bot is assigned to a project yet",
      href: firstProject ? "/solutions/myprojects" : "/solutions/projects",
      action: "Assign bots",
      icon: Bot,
    },
    {
      id: "configure_bots",
      title: "Configure Bot Settings",
      description: "Give each posting a role, responsibilities, and repository access.",
      done: data.configuredAssignments > 0,
      evidence: data.configuredAssignments > 0
        ? `${data.configuredAssignments} of ${data.assignments} assignment${data.assignments === 1 ? "" : "s"} configured`
        : data.assignments > 0
          ? "Assignments exist; none carries a role or responsibilities yet"
          : "Assign a bot first",
      href: "/solutions/myprojects",
      action: "Configure",
      icon: Settings2,
    },
    {
      id: "command",
      title: "Issue a Command",
      description: "Describe the outcome you want in plain words. The server verifies it, queues it, and a worker builds it.",
      done: data.commands.length > 0,
      evidence: data.commands.length > 0
        ? `${data.commands.length} command${data.commands.length === 1 ? "" : "s"} recorded`
        : "No command yet",
      href: firstProject ? `/solutions/bot-manager?project=${firstProject.id}` : "/solutions/bot-manager",
      action: "Give a bot work",
      icon: Terminal,
    },
    {
      id: "watch",
      title: "Watch It Ship",
      description: "Every run lands as a draft pull request with CI evidence; you review and merge.",
      done: hasSucceededCommand,
      evidence: hasSucceededCommand
        ? "At least one command has completed end to end"
        : data.commands.length > 0
          ? "Work is in flight — watch it on Pipelines"
          : "Nothing has run yet",
      href: "/solutions/pipelines",
      action: "Open Pipelines",
      icon: Workflow,
    },
  ];

  const currentIndex = steps.findIndex((step) => !step.done);
  const doneCount = steps.filter((step) => step.done).length;
  const recent = data.commands.slice(0, 3);

  return (
    <div className="space-y-6">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Your factory, step by step</h2>
            <p className="mt-1 text-sm text-muted">
              Progress is read from your live records, so it survives refresh and never disagrees
              with the rest of the console.
            </p>
          </div>
          <StatusBadge tone={doneCount === steps.length ? "safe" : "info"} dot={false}>
            {doneCount} of {steps.length} complete
          </StatusBadge>
        </div>

        <ol className="mt-6 space-y-0">
          {steps.map((step, index) => {
            const isCurrent = index === currentIndex;
            const Icon = step.icon;
            return (
              <li key={step.id} className="relative flex gap-4 pb-6 last:pb-0">
                {/* The connector, drawn per row so the column stays honest on
                    every viewport — vertical steps are the mobile-first shape
                    of the reference's horizontal band. */}
                {index < steps.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute left-[15px] top-8 h-full w-0.5",
                      step.done ? "bg-[var(--accent)]" : "bg-[var(--border)]",
                    )}
                  />
                ) : null}
                <span
                  className={cn(
                    "z-10 grid size-8 shrink-0 place-items-center rounded-full border text-sm font-semibold",
                    step.done
                      ? "border-[var(--accent-border)] bg-[var(--accent-surface)] text-[var(--accent-text)]"
                      : isCurrent
                        ? "border-[var(--accent-border)] bg-surface text-foreground ring-2 ring-[var(--accent-border)]"
                        : "border-line bg-surface text-faint",
                  )}
                  aria-hidden="true"
                >
                  {step.done ? <Check className="size-4" /> : index + 1}
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon className="size-4 shrink-0 text-faint" aria-hidden="true" />
                    <h3 className="font-semibold text-foreground">{step.title}</h3>
                    {step.done ? (
                      <StatusBadge tone="safe" dot={false}>Done</StatusBadge>
                    ) : isCurrent ? (
                      <StatusBadge tone="info" dot={false}>You are here</StatusBadge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-muted">{step.description}</p>
                  <p className="mt-1 text-xs text-faint">{step.evidence}</p>
                  {/* Done steps hide their action to keep the column quiet —
                      except the repeatable ones: issuing another command and
                      watching runs never stop being next actions. */}
                  {!step.done || isCurrent || step.id === "watch" || step.id === "command" ? (
                    <Link
                      href={step.href}
                      className={cn("mt-2 inline-flex", isCurrent ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm")}
                    >
                      {step.action}
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-foreground">Command execution, live</h2>
        <p className="mt-1 text-sm text-muted">
          Every command runs the same lifecycle: verified intake → queue → a worker claims it →
          isolated branch → draft pull request with CI. Merging stays yours, and production deploys
          from the merge.
        </p>
        {recent.length ? (
          <ul className="mt-4 divide-y divide-[var(--border)]">
            {recent.map((command) => {
              const stage = pipelineStage(command.status);
              return (
                <li key={command.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <p className="min-w-0 flex-1 truncate text-sm text-foreground" title={command.prompt}>
                    {command.prompt}
                  </p>
                  <StatusBadge tone={stage.tone} dot={false}>{stage.label}</StatusBadge>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-faint">
            No commands yet — your first one will appear here with its live stage.
          </p>
        )}
        <Link href="/solutions/pipelines" className="btn btn-secondary btn-sm mt-4">
          <Workflow className="size-4" aria-hidden="true" />
          Open Pipelines
        </Link>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-base font-semibold text-foreground">Integrated services</h2>
          <ul className="mt-3 space-y-2.5 text-sm">
            <li className="flex items-center gap-2.5">
              <GitBranch className="size-4 shrink-0 text-faint" aria-hidden="true" />
              <span className="flex-1 text-muted">GitHub — repositories, branches, draft PRs, webhooks</span>
              <StatusBadge tone={data.connectedInstallations > 0 ? "safe" : "neutral"} dot={false}>
                {data.connectedInstallations > 0 ? "Connected" : "Not Connected"}
              </StatusBadge>
            </li>
            <li className="flex items-center gap-2.5">
              <ArrowRight className="size-4 shrink-0 text-faint" aria-hidden="true" />
              <span className="flex-1 text-muted">Vercel — production deploys from every merge to main</span>
              <StatusBadge tone="safe" dot={false}>Wired</StatusBadge>
            </li>
            <li className="flex items-center gap-2.5">
              <PlugZap className="size-4 shrink-0 text-faint" aria-hidden="true" />
              <span className="flex-1 text-muted">Supabase — persistence, auth, and the audit trail</span>
              <StatusBadge tone="safe" dot={false}>Wired</StatusBadge>
            </li>
          </ul>
          <p className="mt-3 text-xs text-faint">
            Only services this workspace actually integrates are listed — nothing here is decorative.
          </p>
        </Card>

        <Card className="p-5">
          <h2 className="text-base font-semibold text-foreground">Observability &amp; control</h2>
          <ul className="mt-3 grid grid-cols-2 gap-2 text-sm">
            {([
              ["Runs", "/solutions/runs"],
              ["Reports", "/solutions/reports"],
              ["Bot Usage", "/solutions/bot-usage"],
              ["Activity", "/solutions/activity"],
              ["Operations", "/solutions/operations"],
              ["Safety", "/solutions/settings"],
            ] as const).map(([label, href]) => (
              <li key={href}>
                <Link href={href} className="btn btn-secondary btn-sm w-full justify-between">
                  {label}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-faint">
            Everything a bot does lands in these views as recorded evidence.
          </p>
        </Card>
      </div>
    </div>
  );
}
