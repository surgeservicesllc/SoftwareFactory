"use client";

import { Activity, Fingerprint, Loader2, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { EmptyPanel, TenantStateGate, formatDateTime } from "@/components/tenant-states";
import { Panel, StatusBadge } from "@/components/ui";
import { useTenantResource } from "@/lib/client/use-tenant-resource";

type ActivityEvent = {
  actor: { id: string | null; displayName: string };
  description: string;
  entity: { id: string | null; type: string };
  eventType: string;
  id: string;
  occurredAt: string;
  project: { id: string; name: string } | null;
};

type ActivityPayload = {
  events: ActivityEvent[];
  availableEventTypes: string[];
};

export function ActivityConsole() {
  const [search, setSearch] = useState("");
  const [eventType, setEventType] = useState("");
  const [projectId, setProjectId] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: "100" });
    if (search.trim()) params.set("search", search.trim());
    if (eventType) params.set("eventType", eventType);
    if (projectId) params.set("projectId", projectId);
    return `/api/activity?${params.toString()}`;
  }, [eventType, projectId, search]);

  const activity = useTenantResource<ActivityPayload>(query);
  const projects = useTenantResource<{ projects: Array<{ id: string; name: string }> }>("/api/projects");

  if (activity.state !== "ready" || !activity.data) {
    return <TenantStateGate state={activity.state} message={activity.message} subject="activity" next="/activity" />;
  }

  const { events, availableEventTypes } = activity.data;

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[#212b37] p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-[#95a83a]" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-[#e1e6ea]">Tenant event stream</h2>
          </div>
          <StatusBadge tone="safe">Live · Supabase</StatusBadge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative block min-w-0 sm:w-56">
            <span className="sr-only">Search activity</span>
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#5e6a79]" aria-hidden="true" />
            <input
              className="form-control h-8 pl-9 text-[10px]"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search descriptions…"
              type="search"
              value={search}
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#5c6978]">Event</span>
            <select
              value={eventType}
              onChange={(event) => setEventType(event.target.value)}
              className="h-8 rounded-md border border-[#2b3644] bg-[#0a0f16] px-2 text-[10px] text-[#c4ccd5]"
            >
              <option value="">All</option>
              {availableEventTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#5c6978]">Project</span>
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="h-8 rounded-md border border-[#2b3644] bg-[#0a0f16] px-2 text-[10px] text-[#c4ccd5]"
            >
              <option value="">All</option>
              {(projects.data?.projects ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={activity.reload}
            disabled={activity.refreshing}
            className="secondary-action"
            aria-label="Refresh activity"
          >
            {activity.refreshing ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-3.5" aria-hidden="true" />
            )}
            Refresh
          </button>
        </div>
      </div>

      {events.length === 0 ? (
        <EmptyPanel
          title={search || eventType || projectId ? "No matching events" : "No activity recorded"}
          description="Important authenticated and provider transitions appear here as immutable, tenant-scoped evidence."
          icon={Fingerprint}
        />
      ) : (
        <div className="divide-y divide-[#202a36]">
          {events.map((event) => (
            <article key={event.id} className="grid gap-3 p-4 sm:grid-cols-[28px_minmax(0,1fr)_180px] sm:p-5">
              <span className="mt-0.5 grid size-7 place-items-center rounded-lg border border-[#233f4a] bg-[#10232b] text-[#60d8ff]">
                <Fingerprint className="size-3.5" aria-hidden="true" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xs font-semibold text-[#d8dee5]">{event.description}</h3>
                  <StatusBadge tone="info" dot={false}>
                    {event.eventType}
                  </StatusBadge>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[8px] uppercase tracking-[0.1em] text-[#596675]">
                  <span>Actor · {event.actor.displayName}</span>
                  <span>Project · {event.project?.name ?? "Organization"}</span>
                  <span>
                    Target · {event.entity.type}
                    {event.entity.id ? `/${event.entity.id.slice(0, 8)}` : ""}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-end sm:justify-start">
                <time dateTime={event.occurredAt} className="font-mono text-[9px] text-[#6c7887]">
                  {formatDateTime(event.occurredAt)}
                </time>
                <StatusBadge tone="neutral" dot={false}>
                  Redacted evidence
                </StatusBadge>
              </div>
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}
