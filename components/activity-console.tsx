"use client";

import { Activity, Loader2, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { BlockedState, Card, StatusBadge } from "@/components/ui";

type ActivityEvent = {
  actor: {
    id: string | null;
    displayName: string;
    source: "github" | "softwarefactory";
  } | null;
  description: string;
  entity: { id: string | null; type: string };
  eventType: string;
  evidence: {
    action: string | null;
    conclusion: string | null;
    resources: Array<{ id: string; type: string }>;
    source: "github" | "softwarefactory";
    stateTransition: string | null;
    status: string | null;
  };
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
      if (response.status === 409 || response.status === 403) { setState("setup"); return; }
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
      event.entity.id,
      event.entity.type,
      event.project?.name,
      event.actor?.displayName,
      event.evidence.action,
      event.evidence.conclusion,
      event.evidence.source,
      event.evidence.stateTransition,
      event.evidence.status,
      ...event.evidence.resources.flatMap((resource) => [resource.type, resource.id]),
    ].some((value) => value?.toLowerCase().includes(normalized)));
  }, [events, query]);

  if (state === "signed-out") {
    return <BlockedState icon={Activity} title="Sign in to see your activity" description="Your audit trail is visible only to members of your organization." href="/auth/sign-in?next=/activity" label="Sign in" />;
  }
  if (state === "setup") {
    return <BlockedState icon={Activity} title="Choose an organization" description="Finish setup or pick an active organization to load its audit trail." href="/solutions/connections" label="Open connections" />;
  }
  if (state === "error") {
    return (
      <Card className="grid min-h-64 place-items-center p-8 text-center">
        <div className="max-w-md">
          <Activity className="mx-auto size-8 text-faint" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-semibold text-foreground">Activity is unavailable</h2>
          <p className="mt-2 text-muted">{message || "Your audit trail could not be loaded."}</p>
          <button type="button" className="btn btn-primary mt-5" onClick={() => void load()}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Retry
          </button>
        </div>
      </Card>
    );
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
            <li key={event.id} className="flex flex-col gap-3 p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
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
              </div>
              <div className="min-w-0">
                <dl className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-faint">
                  <EvidenceItem label="Source" value={sourceLabel(event.evidence.source)} />
                  <EvidenceItem label="Entity" value={event.entity.type} id={event.entity.id} />
                  {event.evidence.action ? <EvidenceItem label="Action" value={event.evidence.action} /> : null}
                  {event.evidence.status ? <EvidenceItem label="Status" value={event.evidence.status} /> : null}
                  {event.evidence.conclusion ? <EvidenceItem label="Conclusion" value={event.evidence.conclusion} /> : null}
                  {event.evidence.stateTransition
                    ? <EvidenceItem label="Transition" value={event.evidence.stateTransition} />
                    : null}
                  {event.evidence.resources.map((resource, index) => (
                    <EvidenceItem
                      key={`${resource.type}:${resource.id}:${index}`}
                      label="Resource"
                      value={resource.type}
                      id={resource.id}
                    />
                  ))}
                </dl>
              </div>
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

function sourceLabel(source: ActivityEvent["evidence"]["source"]) {
  return source === "github" ? "GitHub" : "SoftwareFactory";
}

function EvidenceItem({ label, value, id }: { label: string; value: string; id?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="inline font-medium text-muted">{label}: </dt>
      <dd className="inline">
        {value}
        {id ? <span className="ml-1 break-all font-mono">{id}</span> : null}
      </dd>
    </div>
  );
}
