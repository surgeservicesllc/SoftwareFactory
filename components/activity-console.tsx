"use client";

import { Activity, Loader2, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { BlockedState, Card, StatusBadge } from "@/components/ui";

type ActivityEvent = {
  actor: { id: string; displayName: string } | null;
  description: string;
  entity: { id: string | null; type: string };
  eventType: string;
  id: string;
  occurredAt: string;
  project: { id: string; name: string } | null;
};

type LoadState = "loading" | "signed-out" | "setup" | "ready" | "error";

export function ActivityConsole() {
  const [state, setState] = useState<LoadState>("loading");
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    setMessage("");
    try {
      const response = await fetch("/api/activity?limit=100", { cache: "no-store" });
      if (response.status === 401) { setState("signed-out"); return; }
      if (response.status === 409) { setState("setup"); return; }
      const body = (await response.json()) as { events?: ActivityEvent[]; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Live activity could not be loaded.");
      setEvents(body.events ?? []);
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Live activity could not be loaded.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const visibleEvents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return events;
    return events.filter((event) => [
      event.description,
      event.eventType,
      event.entity.type,
      event.project?.name,
      event.actor?.displayName,
    ].some((value) => value?.toLowerCase().includes(normalized)));
  }, [events, query]);

  if (state === "signed-out") {
    return <BlockedState icon={Activity} title="Sign in to see your activity" description="Your audit trail is visible only to members of your organization." href="/auth/sign-in?next=/activity" label="Sign in" />;
  }
  if (state === "setup") {
    return <BlockedState icon={Activity} title="Choose an organization" description="Finish setup or pick an active organization to load its audit trail." href="/connections" label="Open connections" />;
  }
  if (state === "error") {
    return <BlockedState icon={Activity} title="Activity is unavailable" description={message || "Your audit trail could not be loaded."} href="/connections" label="Check connections" />;
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-foreground">Your activity</h2>
          <StatusBadge tone={state === "ready" ? "safe" : "neutral"}>
            {state === "ready" ? "Live" : "Loading"}
          </StatusBadge>
        </div>
        <div className="flex gap-2">
          <label className="relative block min-w-0 flex-1 sm:w-64 sm:flex-none">
            <span className="sr-only">Search activity</span>
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden="true" />
            <input className="input pl-9" onChange={(event) => setQuery(event.target.value)} placeholder="Search…" type="search" value={query} />
          </label>
          <button type="button" onClick={() => void load()} disabled={state === "loading"} className="btn btn-secondary btn-sm shrink-0" aria-label="Refresh activity">
            {state === "loading" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Refresh
          </button>
        </div>
      </div>

      {state === "loading" ? (
        <div className="grid min-h-48 place-items-center">
          <Loader2 className="size-6 animate-spin text-accent" aria-label="Loading activity" />
        </div>
      ) : visibleEvents.length ? (
        <ul className="divide-y divide-[var(--border)]">
          {visibleEvents.map((event) => (
            <li key={event.id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
              <div className="min-w-0">
                <p className="font-medium text-foreground">{event.description}</p>
                <p className="mt-1 text-sm text-muted">
                  {event.actor?.displayName ?? "System"} · {event.project?.name ?? "Organization"} ·{" "}
                  {event.eventType}
                </p>
              </div>
              <time dateTime={event.occurredAt} className="shrink-0 text-sm text-faint">
                {formatDate(event.occurredAt)}
              </time>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid min-h-48 place-items-center p-8 text-center">
          <div className="max-w-sm">
            <p className="font-semibold text-foreground">
              {query ? "Nothing matches that search" : "Nothing has happened yet"}
            </p>
            <p className="mt-2 text-sm text-muted">
              {query
                ? "Try a different word."
                : "Connecting GitHub, adding a project, or opening a draft pull request will all show up here."}
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
