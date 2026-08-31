"use client";

import {
  Bot,
  Boxes,
  Check,
  ChevronRight,
  CircleGauge,
  Cpu,
  FolderKanban,
  GitBranch,
  Hexagon,
  KeyRound,
  LayoutDashboard,
  type LucideIcon,
  PlugZap,
  ScrollText,
  Settings,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { FACTORY_STEPS, type FactoryStep } from "@/lib/sdlc/factory-steps";
import { shortRunId } from "@/lib/graph/run-label";
import { budgetActionIsNotable, budgetActionLabel, formatCost } from "@/lib/graph/run-spend";

/**
 * The AI Factory workspace shell, as the owner's boards draw it.
 *
 * A sidebar of its own — the wordmark, the ten steps with their live check
 * circles, the operations and system destinations, and the current run's
 * card — around the step content. Every destination is a real route and
 * every state mark is derived from the run the page is showing; the boards'
 * bells, share menus and refresh pickers have no backing behavior and are
 * deliberately absent rather than decorative.
 */

export type FactoryViewer = {
  readonly email?: string | null;
  readonly displayName?: string | null;
};

export type StepMark = {
  readonly slug: string;
  /** complete | active | pending — derived from the run's own nodes. */
  readonly state: "complete" | "active" | "pending";
};

function initialsFor(viewer: FactoryViewer | undefined): string {
  const source = viewer?.displayName ?? viewer?.email ?? "";
  const parts = source.replace(/@.*$/, "").split(/[.\s_-]+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
  return initials || "·";
}

function SideLink({
  href,
  icon: Icon,
  children,
  current = false,
}: {
  href: string;
  icon: LucideIcon;
  children: ReactNode;
  current?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex min-h-9 items-center gap-2.5 rounded-lg px-3 text-[13px] font-medium transition-colors",
        current
          ? "bg-[var(--accent-surface)] text-[var(--accent-text)]"
          : "text-muted hover:bg-surface-raised hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
      <span className="truncate">{children}</span>
    </Link>
  );
}

export function FactoryShell({
  step,
  section = "step",
  marks,
  run,
  stepQuery = "",
  viewer,
  breadcrumb,
  children,
}: {
  step: FactoryStep;
  /** The shell can host the lifecycle steps or a first-class Factory workspace. */
  section?: "step" | "grok";
  /** Live standings for the sidebar's ten circles; empty while loading. */
  marks: readonly StepMark[];
  run?: {
    readonly graphRunId: string;
    readonly state: string;
    readonly startedAt?: string | null;
    readonly stepsComplete: number;
    /** What the run spent, when the worker recorded it. */
    readonly costMicros?: number | null;
    readonly budgetAction?: string | null;
  } | null;
  /** Exact graph/run selection carried between the ten step routes. */
  stepQuery?: string;
  viewer?: FactoryViewer;
  breadcrumb: ReactNode;
  children: ReactNode;
}) {
  const markFor = (slug: string) => marks.find((mark) => mark.slug === slug)?.state ?? "pending";

  return (
    <div className="flex min-h-screen">
      <aside
        aria-label="AI Factory"
        className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--surface-inset)] px-3 py-5 lg:flex"
      >
        <Link
          href={`/solutions/factory/requirement${stepQuery}`}
          aria-label="Factory steps home"
          className="flex items-center gap-2 px-2"
        >
          <span className="grid size-8 place-items-center rounded-lg border border-[var(--accent-border)] bg-[var(--accent-surface)]">
            <Hexagon className="size-4 text-[var(--accent-text)]" aria-hidden="true" />
          </span>
          <span className="text-sm font-bold tracking-wide text-foreground">AI FACTORY</span>
        </Link>

        <p className="label mt-6 px-3">Overview</p>
        <nav aria-label="Overview" className="mt-1.5 space-y-0.5">
          <SideLink href="/solutions" icon={CircleGauge}>Overview</SideLink>
          <SideLink href="/solutions/portfolio" icon={LayoutDashboard}>Dashboard</SideLink>
          <SideLink href="/solutions/projects" icon={FolderKanban}>Projects</SideLink>
        </nav>

        <p className="label mt-5 px-3">AI Factory</p>
        <nav aria-label="AI Factory workspaces" className="mt-1.5 space-y-0.5">
          <SideLink
            href={`/solutions/factory/grok${stepQuery}`}
            icon={Bot}
            current={section === "grok"}
          >
            Grok Bot
          </SideLink>
        </nav>
        <nav aria-label="The ten factory steps" className="mt-1.5 space-y-0.5">
          {FACTORY_STEPS.map((entry) => {
            const mark = markFor(entry.slug);
            const current = section === "step" && entry.slug === step.slug;
            return (
              <Link
                key={entry.slug}
                href={`/solutions/factory/${entry.slug}${stepQuery}`}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors",
                  current
                    ? "bg-[var(--accent-surface)] text-[var(--accent-text)]"
                    : "text-muted hover:bg-surface-raised hover:text-foreground",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-full border text-[10px] font-semibold",
                    mark === "complete"
                      ? "border-[#1f5d47] bg-[rgba(52,211,153,0.12)] text-[#34d399]"
                      : current
                        ? "border-[var(--accent-border)] text-[var(--accent-text)]"
                        : "border-[var(--border-strong)] text-muted",
                  )}
                >
                  {mark === "complete" ? <Check className="size-3" aria-hidden="true" /> : entry.number}
                </span>
                <span className="truncate">{entry.title}</span>
                {current ? (
                  <ChevronRight aria-hidden="true" className="ml-auto size-3.5 shrink-0" />
                ) : mark === "active" ? (
                  <span aria-hidden="true" className="ml-auto size-1.5 rounded-full bg-[var(--accent)]" />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <p className="label mt-5 px-3">Operations</p>
        <nav aria-label="Operations" className="mt-1.5 space-y-0.5">
          <SideLink href="/solutions/pipelines" icon={GitBranch}>Runs</SideLink>
          <SideLink href="/solutions/agents" icon={Boxes}>Agents</SideLink>
          <SideLink href="/solutions/workflows" icon={Workflow}>Pipelines</SideLink>
          <SideLink href="/solutions/lifecycle" icon={Cpu}>Lifecycle</SideLink>
          <SideLink href="/solutions/reports" icon={ScrollText}>Reports</SideLink>
        </nav>

        <p className="label mt-5 px-3">System</p>
        <nav aria-label="System" className="mt-1.5 space-y-0.5">
          <SideLink href="/solutions/connections" icon={PlugZap}>Integrations</SideLink>
          <SideLink href="/solutions/settings#providers" icon={KeyRound}>Secrets</SideLink>
          <SideLink href="/solutions/settings" icon={Settings}>Settings</SideLink>
        </nav>

        <div className="mt-auto pt-5">
          {run ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
              <p className="label">Current run</p>
              <p className="mt-1 truncate font-mono text-xs text-foreground" title={run.graphRunId}>
                {shortRunId(run.graphRunId)}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {run.state} · {run.stepsComplete} of 10 steps complete
              </p>
              {/* Cost, only once something recorded one. */}
              {formatCost(run.costMicros) ? (
                <p className="mt-0.5 text-xs text-muted">
                  {formatCost(run.costMicros)}
                  {budgetActionIsNotable(run.budgetAction)
                    ? ` · ${budgetActionLabel(run.budgetAction)}`
                    : ""}
                </p>
              ) : null}
              <div
                role="img"
                aria-label={`${run.stepsComplete} of 10 steps complete`}
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-raised)]"
              >
                <div
                  className="h-full rounded-full bg-[var(--accent)]"
                  style={{ width: `${(run.stepsComplete / 10) * 100}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
              <p className="label">Current run</p>
              <p className="mt-1 text-xs text-muted">No lifecycle run yet.</p>
            </div>
          )}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex min-h-14 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-inset)] px-4 sm:px-6">
          <div className="min-w-0 flex-1">{breadcrumb}</div>
          <nav aria-label="Primary">
            <Link href="/solutions" aria-label="AI Factory console home" className="btn btn-secondary btn-sm inline-flex">
              <span className="hidden sm:inline">Open Console</span>
              <span className="sm:hidden">Console</span>
            </Link>
          </nav>
          <span
            aria-label={viewer?.email ?? "Signed out"}
            title={viewer?.email ?? "Signed out"}
            className="grid size-8 shrink-0 place-items-center rounded-full border border-[var(--accent-border)] bg-[var(--accent-surface)] text-xs font-bold text-[var(--accent-text)]"
          >
            {initialsFor(viewer)}
          </span>
        </header>
        <main className="px-4 py-6 sm:px-6">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
