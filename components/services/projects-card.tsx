"use client";

import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Notice, SectionTitle } from "@/components/ui";
import { useAccountProperties } from "@/components/services/use-account-properties";
import { cn } from "@/lib/cn";
import type { AccountsPayload, TechniciansPayload } from "@/components/services/types";
import { PROJECT_STATE_LABELS, type ProjectProgressView } from "@/lib/services/schedule-bends";

/**
 * Multi-day projects (ADR-239): each one is its visits, so the progress
 * here is counted from them every time — days, completed, cancelled, the
 * next day — and the only thing a person sets is "cancel", which cancels
 * what is not yet done and leaves a completed day completed.
 */

type Payload = { projects: ProjectProgressView[]; counts: { total: number; active: number; planned: number } };

const STATE_TONES: Record<ProjectProgressView["state"], string> = {
  planned: "border-slate-200 bg-slate-100 text-slate-700",
  active: "border-sky-200 bg-sky-50 text-sky-700",
  done: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-rose-200 bg-rose-50 text-rose-700",
};

async function readFailure(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}

export function ProjectsCard({
  accounts,
  technicians,
  onChanged,
}: {
  accounts: AccountsPayload | null;
  technicians: TechniciansPayload | null;
  onChanged: () => void;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/services/projects", { headers: { accept: "application/json" } });
      if (!response.ok) {
        setError(await readFailure(response, "Projects could not be listed."));
        return;
      }
      setError("");
      const body = (await response.json()) as Partial<Payload>;
      setPayload({
        projects: Array.isArray(body.projects) ? body.projects : [],
        counts: body.counts ?? { total: 0, active: 0, planned: 0 },
      });
    } catch {
      setError("Projects could not be listed.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);

  const cancel = useCallback(async (project: ProjectProgressView) => {
    setMessage("");
    const response = await fetch(`/api/services/projects/${project.projectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });
    if (!response.ok) {
      setError(await readFailure(response, "The project could not be cancelled."));
      return;
    }
    const body = (await response.json()) as { cancelledVisits: number };
    setMessage(`Cancelled “${project.name}”: ${body.cancelledVisits} ${body.cancelledVisits === 1 ? "visit" : "visits"} cancelled; completed days stay completed.`);
    setConfirming(null);
    await load();
    onChanged();
  }, [load, onChanged]);

  return (
    <section className="card mb-6" data-testid="services-projects">
      <SectionTitle
        title={payload === null ? "Projects" : `Projects (${payload.counts.total})`}
        description="A job that takes several days: one real visit per working day, each routed and completed on its own. Progress is counted from the visits every time you look."
      />
      <button
        type="button"
        className="btn btn-secondary mt-3 px-3 py-1.5 text-xs"
        onClick={() => setCreating((current) => !current)}
        data-testid="services-projects-new"
      >
        {creating ? "Close" : "New project"}
      </button>
      {creating ? (
        <ProjectForm
          accounts={accounts}
          technicians={technicians}
          onDone={(visits) => {
            setCreating(false);
            setMessage(`Project created with ${visits} ${visits === 1 ? "visit" : "visits"}.`);
            void load();
            onChanged();
          }}
        />
      ) : null}
      {error ? <div className="mt-3"><Notice tone="warning">{error}</Notice></div> : null}
      {message ? <p className="mt-3 text-sm text-emerald-700" data-testid="services-projects-message">{message}</p> : null}
      {payload !== null && payload.projects.length === 0 ? (
        <p className="mt-3 text-sm text-muted" data-testid="services-projects-empty">No projects yet. A fumigation, an exclusion or a rebuild that takes the crew several days goes here.</p>
      ) : payload !== null ? (
        <ul className="mt-3 divide-y divide-line" data-testid="services-projects-list">
          {payload.projects.map((project) => (
            <li key={project.projectId} className="flex flex-wrap items-center gap-3 py-3 text-sm" data-testid={`services-project-${project.projectId}`}>
              <CalendarRange className="size-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{project.name}</span>
                  <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", STATE_TONES[project.state])}>
                    {PROJECT_STATE_LABELS[project.state]}
                  </span>
                  <Link href={`/Services/customers/${project.accountId}`} className="text-muted underline-offset-2 hover:underline">
                    {project.accountName}
                  </Link>
                  {project.propertyLabel ? <span className="text-xs text-faint">{project.propertyLabel}</span> : null}
                </span>
                <span className="block text-xs text-faint" data-testid={`services-project-progress-${project.projectId}`}>
                  {project.serviceType} · {project.startsOn} → {project.endsOn} · {project.completed} of {project.days} days done
                  {project.cancelled > 0 ? `, ${project.cancelled} cancelled` : ""}
                  {project.nextDay !== null ? ` · next ${project.nextDay}` : ""}
                  {project.technicianName ? ` · ${project.technicianName}` : " · unassigned"}
                </span>
                {project.note ? <span className="block text-xs text-muted">{project.note}</span> : null}
              </span>
              {project.state === "planned" || project.state === "active" ? (
                confirming === project.projectId ? (
                  <span className="flex gap-2">
                    <button type="button" className="btn btn-secondary px-2.5 py-1 text-xs text-rose-700" onClick={() => void cancel(project)} data-testid={`services-project-cancel-confirm-${project.projectId}`}>
                      Confirm: cancel {project.remaining} {project.remaining === 1 ? "visit" : "visits"}
                    </button>
                    <button type="button" className="btn btn-secondary px-2.5 py-1 text-xs" onClick={() => setConfirming(null)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <button type="button" className="btn btn-secondary px-2.5 py-1 text-xs" onClick={() => setConfirming(project.projectId)} data-testid={`services-project-cancel-${project.projectId}`}>
                    Cancel project
                  </button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ProjectForm({
  accounts,
  technicians,
  onDone,
}: {
  accounts: AccountsPayload | null;
  technicians: TechniciansPayload | null;
  onDone: (visits: number) => void;
}) {
  const [accountId, setAccountId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [technicianId, setTechnicianId] = useState("");
  const [name, setName] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [dailyStart, setDailyStart] = useState("07:00");
  const [dailyEnd, setDailyEnd] = useState("15:30");
  const [includeWeekends, setIncludeWeekends] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const properties = useAccountProperties(accountId);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/services/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId,
          propertyId,
          ...(technicianId !== "" ? { technicianId } : {}),
          name: name.trim(),
          serviceType: serviceType.trim(),
          startsOn,
          endsOn,
          dailyStart,
          dailyEnd,
          includeWeekends,
          ...(note.trim().length > 0 ? { note: note.trim() } : {}),
        }),
      });
      if (!response.ok) {
        setError(await readFailure(response, "The project could not be created."));
        return;
      }
      const body = (await response.json()) as { visits: number };
      onDone(body.visits);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mt-4 grid gap-3 rounded-lg border border-line bg-surface-inset p-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      data-testid="services-project-form"
    >
      <label className="block text-sm">
        <span className="text-muted">Account</span>
        <select value={accountId} onChange={(event) => { setAccountId(event.target.value); setPropertyId(""); }} required className="input mt-1" aria-label="Project account">
          <option value="">Choose an account</option>
          {(accounts?.accounts ?? []).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select>
      </label>
      <label className="block text-sm">
        <span className="text-muted">Site</span>
        <select value={propertyId} onChange={(event) => setPropertyId(event.target.value)} required className="input mt-1" aria-label="Project site">
          <option value="">{accountId === "" ? "Choose the account first" : "Choose a site"}</option>
          {properties.map((property) => <option key={property.id} value={property.id}>{property.label}</option>)}
        </select>
      </label>
      <label className="block text-sm">
        <span className="text-muted">Name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} className="input mt-1" aria-label="Project name" />
      </label>
      <label className="block text-sm">
        <span className="text-muted">Service</span>
        <input value={serviceType} onChange={(event) => setServiceType(event.target.value)} required maxLength={120} className="input mt-1" aria-label="Project service" />
      </label>
      <label className="block text-sm">
        <span className="text-muted">First day</span>
        <input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} required className="input mt-1" aria-label="Project first day" />
      </label>
      <label className="block text-sm">
        <span className="text-muted">Last day</span>
        <input type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} required className="input mt-1" aria-label="Project last day" />
      </label>
      <label className="block text-sm">
        <span className="text-muted">Each day from</span>
        <input type="time" value={dailyStart} onChange={(event) => setDailyStart(event.target.value)} required className="input mt-1" aria-label="Project daily start" />
      </label>
      <label className="block text-sm">
        <span className="text-muted">Each day until</span>
        <input type="time" value={dailyEnd} onChange={(event) => setDailyEnd(event.target.value)} required className="input mt-1" aria-label="Project daily end" />
      </label>
      <label className="block text-sm">
        <span className="text-muted">Technician</span>
        <select value={technicianId} onChange={(event) => setTechnicianId(event.target.value)} className="input mt-1" aria-label="Project technician">
          <option value="">Unassigned</option>
          {(technicians?.technicians ?? []).filter((technician) => technician.active).map((technician) => (
            <option key={technician.id} value={technician.id}>{[technician.firstName, technician.lastName].filter(Boolean).join(" ")}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-muted sm:pt-6">
        <input type="checkbox" checked={includeWeekends} onChange={(event) => setIncludeWeekends(event.target.checked)} aria-label="Include weekends" />
        Include weekends
      </label>
      <label className="block text-sm sm:col-span-2">
        <span className="text-muted">Note</span>
        <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} className="input mt-1" aria-label="Project note" />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" disabled={busy} className="btn btn-primary px-3 py-1.5 text-xs" data-testid="services-project-create">
          Create project
        </button>
      </div>
      {error ? <div className="sm:col-span-2"><Notice tone="warning">{error}</Notice></div> : null}
    </form>
  );
}
