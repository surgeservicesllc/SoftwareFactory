"use client";

import { Activity, Fingerprint, Loader2, RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Panel, StatusBadge } from "@/components/ui";

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
    return <ActivityNotice title="Sign in to view live activity" description="Audit evidence is available only to authenticated members of the active organization." href="/sign-in?next=/activity" label="Sign in" />;
  }
  if (state === "setup") {
    return <ActivityNotice title="Select an organization" description="Complete onboarding or choose an active organization before loading tenant audit evidence." href="/connections" label="Open connections" />;
  }
  if (state === "error") {
    return <ActivityNotice title="Live activity is unavailable" description={message || "The tenant audit stream could not be loaded."} href="/connections" label="Review connections" />;
  }

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[#212b37] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-[#95a83a]" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-[#e1e6ea]">Live tenant event stream</h2>
          <StatusBadge tone={state === "ready" ? "safe" : "neutral"}>{state === "ready" ? "Live · Supabase" : "Loading"}</StatusBadge>
        </div>
        <div className="flex gap-2">
          <label className="relative block min-w-0 sm:w-64">
            <span className="sr-only">Search live activity</span>
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#5e6a79]" aria-hidden="true" />
            <input className="form-control pl-9" onChange={(event) => setQuery(event.target.value)} placeholder="Search live events…" type="search" value={query} />
          </label>
          <button type="button" onClick={() => void load()} disabled={state === "loading"} className="secondary-action" aria-label="Refresh live activity">
            {state === "loading" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Refresh
          </button>
        </div>
      </div>

      {state === "loading" ? (
        <div className="grid min-h-48 place-items-center"><Loader2 className="size-6 animate-spin text-[#c6f135]" aria-label="Loading live activity" /></div>
      ) : visibleEvents.length ? (
        <div className="divide-y divide-[#202a36]">
          {visibleEvents.map((event) => (
            <article key={event.id} className="grid gap-3 p-4 sm:grid-cols-[28px_minmax(0,1fr)_180px] sm:p-5">
              <span className="mt-0.5 grid size-7 place-items-center rounded-lg border border-[#233f4a] bg-[#10232b] text-[#60d8ff]">
                <Fingerprint className="size-3.5" aria-hidden="true" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xs font-semibold text-[#d8dee5]">{event.description}</h3>
                  <StatusBadge tone="info" dot={false}>{event.eventType}</StatusBadge>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[8px] uppercase tracking-[0.1em] text-[#596675]">
                  <span>Actor · {event.actor?.displayName ?? "Provider/system"}</span>
                  <span>Project · {event.project?.name ?? "Organization"}</span>
                  <span>Target · {event.entity.type}{event.entity.id ? `/${event.entity.id.slice(0, 8)}` : ""}</span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-end sm:justify-start">
                <time dateTime={event.occurredAt} className="font-mono text-[9px] text-[#6c7887]">{formatDate(event.occurredAt)}</time>
                <StatusBadge tone="neutral" dot={false}>Redacted evidence</StatusBadge>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="grid min-h-48 place-items-center p-6 text-center">
          <div><Fingerprint className="mx-auto size-7 text-[#566271]" /><p className="mt-3 text-xs font-semibold text-[#c7cfd8]">{query ? "No matching live events" : "No live activity recorded"}</p><p className="mt-1 text-[10px] text-[#667485]">Important authenticated and provider transitions will appear here as immutable, tenant-scoped evidence.</p></div>
        </div>
      )}
    </Panel>
  );
}

function ActivityNotice({ title, description, href, label }: { title: string; description: string; href: string; label: string }) {
  return <Panel className="grid min-h-48 place-items-center p-6 text-center"><div className="max-w-md"><Activity className="mx-auto size-7 text-[#71802c]" /><h2 className="mt-4 text-base font-semibold text-white">{title}</h2><p className="mt-2 text-xs leading-5 text-[#748191]">{description}</p><Link href={href} className="primary-action mt-4 justify-center">{label}</Link></div></Panel>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
