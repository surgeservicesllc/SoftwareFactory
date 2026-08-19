"use client";

import { ArrowRight, BellRing } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Card, StatusBadge } from "@/components/ui";
import { isBrowserSupabaseConfigured } from "@/lib/supabase/browser-config";

type CommandRow = { id: string; prompt: string; risk: string; status: string };
type RunRow = {
  id: string;
  status: string;
  errorMessage?: string | null;
  task?: { title?: string | null } | null;
};
type ConnectionRow = { id: string; name: string; status: string; statusReason: string | null };
type IncidentRow = {
  id: string;
  title: string;
  projectName: string;
  severity: string;
  status: string;
  impact: string | null;
  resolvedAt: string | null;
  ownerAttentionRequired: boolean;
};

type AttentionItem = {
  action: string;
  href: string;
  id: string;
  tone: "danger" | "warning";
  what: string;
  why: string;
};

const MAX_ITEMS = 6;

/**
 * The one place that lists decisions only the owner can make — and nothing
 * else. Routine progress never appears here; an empty queue renders nothing at
 * all, so when this section is visible it always deserves a look.
 *
 * Every item answers, in order: what happened, why it matters, and the single
 * recommended action as a button to the exact screen — the owner never hunts
 * through logs to find out what the product wants from them.
 *
 * Sources are read independently and best-effort, mirroring `GettingStarted`:
 * a failure in one source can hide that source's items but never suppresses
 * the others, and can never invent an item — silence is the failure mode, and
 * the underlying consoles remain the authoritative views.
 */
export function NeedsYourAttention({ authenticated }: { authenticated: boolean }) {
  const canLoad = isBrowserSupabaseConfigured() && authenticated;
  const [items, setItems] = useState<AttentionItem[] | null>(null);

  useEffect(() => {
    if (!canLoad) return;
    let active = true;

    async function readJson<T>(url: string): Promise<T | null> {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) return null;
        return (await response.json()) as T;
      } catch {
        return null;
      }
    }

    async function load() {
      const [commandsBody, connectionsBody, workerBody, operationsBody, runsBody] = await Promise.all([
        readJson<{ commands?: CommandRow[] }>("/api/commands"),
        readJson<{ connections?: ConnectionRow[] }>("/api/github/connections"),
        readJson<{ worker?: { connectionStatus?: string } }>("/api/worker/status"),
        readJson<{ incidents?: IncidentRow[] }>("/api/operations/overview"),
        readJson<{ runs?: RunRow[] }>("/api/runs"),
      ]);
      if (!active) return;

      const found: AttentionItem[] = [];

      // Production incidents flagged for the owner come first: they are the
      // items with real-world blast radius.
      for (const incident of operationsBody?.incidents ?? []) {
        if (!incident.ownerAttentionRequired || incident.resolvedAt) continue;
        found.push({
          action: "Open Operations",
          href: "/solutions/operations",
          id: `incident-${incident.id}`,
          tone: "danger",
          what: `Production incident in ${incident.projectName}: ${incident.title}`,
          why: incident.impact
            ?? "Automatic recovery has gone as far as it may; the next step is an owner decision.",
        });
      }

      // RED work is recorded, never run, until the owner says so.
      const awaiting = (commandsBody?.commands ?? []).filter(
        (command) => command.status === "awaiting_approval",
      );
      if (awaiting.length === 1) {
        found.push({
          action: "Review the command",
          href: "/solutions/bot-manager",
          id: `command-${awaiting[0]!.id}`,
          tone: "danger",
          what: `A ${awaiting[0]!.risk.toUpperCase()} command is waiting for your approval`,
          why: "High-risk work is recorded but never runs without your explicit approval.",
        });
      } else if (awaiting.length > 1) {
        found.push({
          action: "Review the commands",
          href: "/solutions/bot-manager",
          id: "commands-awaiting",
          tone: "danger",
          what: `${awaiting.length} commands are waiting for your approval`,
          why: "High-risk work is recorded but never runs without your explicit approval.",
        });
      }

      // A connection in error blocks every project behind it.
      for (const connection of connectionsBody?.connections ?? []) {
        if (connection.status !== "error") continue;
        found.push({
          action: "Open Connections",
          href: "/solutions/connections",
          id: `connection-${connection.id}`,
          tone: "warning",
          what: `GitHub connection "${connection.name}" needs attention`,
          why: connection.statusReason
            ?? "Projects on this connection cannot receive new work until it is restored.",
        });
      }

      // Work that failed is the item this area most owes a person. Watching
      // the owner on 2026-08-16, a command failed three times and the console
      // said nothing anywhere they were looking: they learned it by asking.
      // A failure is finished, unattended, and theirs to decide about — retry
      // or change the request — which is exactly what belongs here.
      const failedRuns = (runsBody?.runs ?? []).filter((run) => run.status === "failed");
      if (failedRuns.length === 1) {
        const run = failedRuns[0]!;
        found.push({
          action: "Open Runs",
          href: "/solutions/runs",
          id: `run-${run.id}`,
          tone: "danger",
          what: `Work failed: ${run.task?.title ?? "an untitled request"}`,
          // The server already sanitizes this message; showing it saves the
          // trip into the run just to learn the one thing that matters.
          why: run.errorMessage
            ?? "The run stopped before finishing. Its evidence is kept, and it can be retried.",
        });
      } else if (failedRuns.length > 1) {
        found.push({
          action: "Open Runs",
          href: "/solutions/runs",
          id: "runs-failed",
          tone: "danger",
          what: `${failedRuns.length} runs failed`,
          why: "Each keeps its evidence and can be retried from the Runs page.",
        });
      }

      // Queued work with no worker is not an error — but only the owner can
      // bring a worker back, so it belongs here rather than in a log.
      const queued = (commandsBody?.commands ?? []).some(
        (command) => command.status === "queued",
      );
      const workerConnected = workerBody?.worker?.connectionStatus === "connected";
      if (queued && workerBody !== null && !workerConnected) {
        found.push({
          action: "Check worker status",
          href: "/solutions/bot-manager",
          id: "worker-missing",
          tone: "warning",
          what: "Work is queued, but no worker is connected",
          why: "Queued commands stay safely stored and start as soon as a worker reconnects.",
        });
      }

      setItems(found.slice(0, MAX_ITEMS));
    }

    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [canLoad]);

  // Nothing to decide (or nothing readable yet) renders nothing: this area
  // earns attention precisely by never crying wolf.
  if (!items || items.length === 0) return null;

  return (
    <section aria-labelledby="attention-title" className="mb-8">
      <Card className="border-[var(--warning-border)] p-5">
        <div className="flex items-center gap-2.5">
          <BellRing className="size-5 text-[var(--warning)]" aria-hidden="true" />
          <h2 id="attention-title" className="text-lg font-semibold text-foreground">
            Needs your attention
          </h2>
          <StatusBadge tone="warning">{items.length}</StatusBadge>
        </div>
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-3 rounded-lg border border-line p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                {/* Incident titles and connection names are arbitrary text; an
                    unbroken token must wrap rather than scroll the phone. */}
                <p className="break-words font-medium text-foreground">{item.what}</p>
                <p className="mt-1 break-words text-sm text-muted">{item.why}</p>
              </div>
              <Link
                href={item.href}
                className={
                  item.tone === "danger"
                    ? "btn btn-primary btn-sm shrink-0 self-start sm:self-auto"
                    : "btn btn-secondary btn-sm shrink-0 self-start sm:self-auto"
                }
              >
                {item.action}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
