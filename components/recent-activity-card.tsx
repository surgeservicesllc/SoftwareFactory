"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { formatDateTime, useTenantList } from "@/components/tenant-list";
import { Card, SectionTitle } from "@/components/ui";

type ActivityEvent = {
  id: string;
  description: string;
  eventType: string;
  occurredAt: string;
  actor: { id: string; displayName: string } | null;
  project: { id: string; name: string } | null;
};

export function RecentActivityCard() {
  const { state } = useTenantList<ActivityEvent>(
    "/api/activity?limit=5",
    (body) => (body.events as ActivityEvent[]) ?? [],
    "Activity could not be loaded.",
  );

  const message = state.kind === "signed-out"
    ? "Sign in to see what has happened in your workspace."
    : state.kind === "setup"
      ? "Choose a workspace to see its activity."
      : state.kind === "error"
        ? state.message
        : state.kind === "ready" && !state.items.length
          ? "Nothing yet. Connecting GitHub, adding a project, or opening a draft pull request will all show up here."
          : null;

  return (
    <Card className="flex flex-col p-5">
      <SectionTitle title="Recent activity" description="The last few things that happened, from your own audit records." />

      <div className="mt-4 flex-1">
        {state.kind === "loading" ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-14 animate-pulse rounded-lg border border-line" />
            ))}
            <span className="sr-only">Loading activity</span>
          </div>
        ) : message ? (
          <p className="text-sm text-muted">{message}</p>
        ) : state.kind === "ready" ? (
          <ul className="space-y-2">
            {state.items.map((event) => (
              <li key={event.id} className="rounded-lg border border-line px-3 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="text-sm font-medium text-foreground">{event.description}</p>
                  <time dateTime={event.occurredAt} className="text-xs text-faint">
                    {formatDateTime(event.occurredAt)}
                  </time>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {event.actor?.displayName ?? "System"}
                  {event.project ? ` · ${event.project.name}` : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <Link href="/activity" className="btn btn-secondary btn-sm mt-4 self-start">
        Open activity
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </Card>
  );
}
