"use client";

import { useCallback, useEffect, useState } from "react";
import { UserRoundCheck } from "lucide-react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import type {
  PortalMessagesPayload,
  PortalRequestsPayload,
  PortalUsersPayload,
  RequestSlaPayload,
  SurveysPayload,
} from "@/components/services/types";
import { SLA_STATE_LABELS, type SlaState } from "@/lib/services/customers-side";
import { cn } from "@/lib/cn";

/**
 * The staff side of the customer portal: invitations, and the queue of what
 * customers sent in.
 *
 * Two figures here are the ones a rollout is actually judged on, and both
 * are the uncomfortable half of a ratio. "Never signed in" counts
 * invitations that were sent and never used — invisible from any count of
 * who did sign in. "Accounts with no portal" is the rest of the book, the
 * customers who were never invited at all.
 *
 * Nothing on this page can attach a login. Staff invite an address; the
 * person at that address turns it into a login themselves, and the database
 * refuses any other route.
 */

const STATE_TONES: Record<string, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  invited: "border-sky-200 bg-sky-50 text-sky-700",
  suspended: "border-slate-200 bg-slate-100 text-slate-500",
};

const REQUEST_TONES: Record<string, string> = {
  submitted: "border-amber-200 bg-amber-50 text-amber-700",
  acknowledged: "border-sky-200 bg-sky-50 text-sky-700",
  scheduled: "border-violet-200 bg-violet-50 text-violet-700",
  resolved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  declined: "border-slate-200 bg-slate-100 text-slate-500",
};

const NEXT_STATUS = ["acknowledged", "scheduled", "resolved", "declined"] as const;

type Tab = "requests" | "clock" | "ratings" | "messages" | "logins";

const SLA_TONES: Record<SlaState, string> = {
  overdue: "border-rose-200 bg-rose-50 text-rose-700",
  breached: "border-rose-200 bg-rose-50 text-rose-700",
  waiting: "border-sky-200 bg-sky-50 text-sky-700",
  met: "border-emerald-200 bg-emerald-50 text-emerald-700",
  unrecorded: "border-slate-200 bg-slate-100 text-slate-500",
};

function SlaChip({ state, dueAt }: { state: SlaState; dueAt: string }) {
  return (
    <span className="inline-flex flex-col">
      <span className={cn("inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", SLA_TONES[state])}>
        {SLA_STATE_LABELS[state]}
      </span>
      <span className="text-[11px] text-faint">due {dueAt.slice(0, 16).replace("T", " ")}</span>
    </span>
  );
}

function waited(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${(minutes / 60).toFixed(1)} h`;
  return `${(minutes / 1440).toFixed(1)} d`;
}

export function ServicesPortalPanel() {
  const [users, setUsers] = useState<PortalUsersPayload | null>(null);
  const [requests, setRequests] = useState<PortalRequestsPayload | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("requests");
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [clock, setClock] = useState<RequestSlaPayload | null>(null);
  const [surveys, setSurveys] = useState<SurveysPayload | null>(null);
  const [threads, setThreads] = useState<PortalMessagesPayload | null>(null);
  const [thread, setThread] = useState<PortalMessagesPayload | null>(null);
  const [threadAccount, setThreadAccount] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [policyDraft, setPolicyDraft] = useState<Record<string, { acknowledgeHours: string; resolveHours: string }>>({});

  const refresh = useCallback(async () => {
    try {
      const [usersRes, requestsRes, clockRes, surveysRes, threadsRes] = await Promise.all([
        fetch("/api/services/portal", { headers: { accept: "application/json" } }),
        fetch("/api/services/portal/requests", { headers: { accept: "application/json" } }),
        fetch("/api/services/portal/sla", { headers: { accept: "application/json" } }),
        fetch("/api/services/portal/surveys", { headers: { accept: "application/json" } }),
        fetch("/api/services/portal/messages", { headers: { accept: "application/json" } }),
      ]);
      const body = (await requestsRes.json()) as PortalRequestsPayload & { error?: { message?: string } };
      if (!requestsRes.ok) {
        setListError(body.error?.message ?? "Service requests could not be read.");
        return;
      }
      setListError(null);
      setRequests(body);
      if (usersRes.ok) setUsers((await usersRes.json()) as PortalUsersPayload);
      if (clockRes.ok) {
        const clockBody = (await clockRes.json()) as Partial<RequestSlaPayload>;
        setClock(Array.isArray(clockBody.requests) ? (clockBody as RequestSlaPayload) : null);
      }
      if (surveysRes.ok) {
        const surveysBody = (await surveysRes.json()) as Partial<SurveysPayload>;
        setSurveys(Array.isArray(surveysBody.responses) ? (surveysBody as SurveysPayload) : null);
      }
      if (threadsRes.ok) {
        const threadsBody = (await threadsRes.json()) as Partial<PortalMessagesPayload>;
        setThreads(Array.isArray(threadsBody.messages) ? (threadsBody as PortalMessagesPayload) : null);
      }
    } catch {
      setListError("Service requests could not be read.");
    }
  }, []);

  const openThread = useCallback(async (accountId: string) => {
    setThreadAccount(accountId);
    setThread(null);
    try {
      const response = await fetch(`/api/services/portal/messages?accountId=${accountId}`, {
        headers: { accept: "application/json" },
      });
      if (response.ok) setThread((await response.json()) as PortalMessagesPayload);
    } catch {
      setActionError("The thread could not be read.");
    }
  }, []);

  const sendMessage = useCallback(async () => {
    if (threadAccount === null || draft.trim().length === 0) return;
    setBusy(`message:${threadAccount}`);
    setActionError(null);
    try {
      const response = await fetch("/api/services/portal/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: threadAccount, body: draft.trim() }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setActionError(body.error?.message ?? "The message could not be sent.");
        return;
      }
      setDraft("");
      await openThread(threadAccount);
      await refresh();
    } catch {
      setActionError("The message could not be sent.");
    } finally {
      setBusy(null);
    }
  }, [draft, openThread, refresh, threadAccount]);

  const markRead = useCallback(async (messageId: string) => {
    setBusy(`read:${messageId}`);
    try {
      const response = await fetch("/api/services/portal/messages", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setActionError(body.error?.message ?? "The message could not be marked read.");
        return;
      }
      if (threadAccount !== null) await openThread(threadAccount);
      await refresh();
    } catch {
      setActionError("The message could not be marked read.");
    } finally {
      setBusy(null);
    }
  }, [openThread, refresh, threadAccount]);

  const savePolicy = useCallback(async (kind: string, reset: boolean) => {
    setBusy(`policy:${kind}`);
    setActionError(null);
    try {
      const current = policyDraft[kind];
      const response = await fetch("/api/services/portal/sla", {
        method: reset ? "DELETE" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          reset
            ? { kind }
            : { kind, acknowledgeHours: Number(current?.acknowledgeHours), resolveHours: Number(current?.resolveHours) },
        ),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setActionError(body.error?.message ?? "The policy could not be saved.");
        return;
      }
      setPolicyDraft((previous) => {
        const next = { ...previous };
        delete next[kind];
        return next;
      });
      await refresh();
    } catch {
      setActionError("The policy could not be saved.");
    } finally {
      setBusy(null);
    }
  }, [policyDraft, refresh]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  const patchRequest = useCallback(
    async (requestId: string, changes: Record<string, unknown>) => {
      setBusy(requestId);
      setActionError(null);
      try {
        const response = await fetch("/api/services/portal/requests", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ requestId, ...changes }),
        });
        if (!response.ok) {
          const body = (await response.json()) as { error?: { message?: string } };
          setActionError(body.error?.message ?? "The request could not be updated.");
          return;
        }
        setReplyFor(null);
        setReply("");
        await refresh();
      } catch {
        setActionError("The request could not be updated.");
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const patchUser = useCallback(
    async (portalUserId: string, changes: Record<string, unknown>) => {
      setBusy(portalUserId);
      setActionError(null);
      try {
        const response = await fetch("/api/services/portal", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ portalUserId, ...changes }),
        });
        if (!response.ok) {
          const body = (await response.json()) as { error?: { message?: string } };
          setActionError(body.error?.message ?? "The portal login could not be updated.");
          return;
        }
        await refresh();
      } catch {
        setActionError("The portal login could not be updated.");
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  return (
    <div>
      <PageHeader
        title="Customer Portal"
        description="Invitations, and what customers have asked for. Staff invite an address; only the person holding that address can turn it into a login — the database allows no other route."
      />

      {listError !== null ? <Notice tone="warning">{listError}</Notice> : null}
      {actionError !== null ? <Notice tone="warning">{actionError}</Notice> : null}

      <Card className="mb-6">
        <SectionTitle
          title="Where the portal actually stands"
          description="The two figures on the right are the ones a rollout is judged on, and neither is visible from a count of who signed in."
        />
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="services-portal-figures">
          <Figure label="Awaiting a reply" value={requests === null ? "—" : String(requests.counts.awaitingReply)} tone={(requests?.counts.awaitingReply ?? 0) > 0 ? "amber" : undefined} />
          <Figure label="Active logins" value={users === null ? "—" : String(users.counts.active)} />
          <Figure
            label="Invited, never signed in"
            value={users === null ? "—" : String(users.counts.neverSignedIn)}
            tone={(users?.counts.neverSignedIn ?? 0) > 0 ? "amber" : undefined}
          />
          <Figure
            label="Accounts with no portal"
            value={users === null ? "—" : String(users.counts.accountsWithoutPortal)}
            tone={(users?.counts.accountsWithoutPortal ?? 0) > 0 ? "amber" : undefined}
          />
        </dl>
      </Card>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Customer portal">
        {(
          [
            ["requests", "Service requests", requests?.requests.length],
            ["clock", "Request clock", clock?.summary.overdue],
            ["ratings", "Ratings", surveys?.summary.responses],
            ["messages", "Messages", threads?.summary.unreadFromCustomers],
            ["logins", "Portal logins", users?.portalUsers.length],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn("btn px-3 py-2 text-sm", tab === key ? "btn-primary" : "btn-secondary")}
          >
            {label}
            {typeof count === "number" ? <span className="ml-1.5 text-xs opacity-70">{count}</span> : null}
          </button>
        ))}
      </div>

      {tab === "requests" ? (
        <Card>
          <SectionTitle
            title="Service requests"
            description="The customer's own words, and the answer beside them. A reply never overwrites what they wrote — they are separate columns, on purpose."
          />
          {(requests?.requests ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted" data-testid="services-portal-requests-empty">
              Nothing has come in yet. Invite a customer on the Portal logins tab, and anything they
              send lands here.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="services-portal-requests-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Request</th>
                    <th className="py-2 pr-3 font-medium">Kind</th>
                    <th className="py-2 pr-3 font-medium">Sent</th>
                    <th className="py-2 pr-3 font-medium">Preferred</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 font-medium">Reply</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(requests?.requests ?? []).slice(0, 100).map((request) => (
                    <tr key={request.id}>
                      <td className="py-2.5 pr-3 text-foreground">
                        {request.summary}
                        {request.detail === null ? null : (
                          <span className="mt-0.5 block text-xs text-muted">{request.detail}</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-muted">{request.kind}</td>
                      <td className="py-2.5 pr-3 text-muted">{request.submittedAt.slice(0, 10)}</td>
                      <td className="py-2.5 pr-3 text-muted">{request.preferredDate ?? "—"}</td>
                      <td className="py-2.5 pr-3">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                            REQUEST_TONES[request.status] ?? REQUEST_TONES.submitted,
                          )}
                        >
                          {request.status}
                        </span>
                        {request.open ? (
                          <span className="mt-1 flex flex-wrap gap-1">
                            {NEXT_STATUS.filter((value) => value !== request.status).map((value) => (
                              <button
                                key={value}
                                type="button"
                                disabled={busy === request.id}
                                onClick={() => void patchRequest(request.id, { status: value })}
                                className="btn btn-secondary px-2 py-0.5 text-xs"
                              >
                                {value}
                              </button>
                            ))}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2.5">
                        {request.response !== null ? (
                          <span className="text-muted">{request.response}</span>
                        ) : replyFor === request.id ? (
                          <span className="flex flex-col gap-1">
                            <textarea
                              value={reply}
                              onChange={(event) => setReply(event.target.value)}
                              rows={2}
                              maxLength={4000}
                              aria-label={`Reply to ${request.summary}`}
                              className="w-56 rounded-lg border border-line px-2 py-1 text-sm"
                            />
                            <span className="flex gap-1">
                              <button
                                type="button"
                                disabled={busy === request.id || reply.trim().length === 0}
                                onClick={() => void patchRequest(request.id, { response: reply.trim() })}
                                className="btn btn-primary px-2 py-0.5 text-xs"
                              >
                                Send
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setReplyFor(null);
                                  setReply("");
                                }}
                                className="btn btn-secondary px-2 py-0.5 text-xs"
                              >
                                Cancel
                              </button>
                            </span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setReplyFor(request.id);
                              setReply("");
                            }}
                            className="btn btn-secondary px-2 py-0.5 text-xs"
                          >
                            Write back
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === "clock" ? (
        <>
          <Card className="mb-6">
            <SectionTitle
              title="The clock on every request"
              description="Two promises per request — acknowledge by, resolve by — computed from stamps the request sets itself the first time its status moves and the first time somebody writes back. A moment that was never recorded reads as unrecorded, not met."
            />
            {clock === null ? (
              <p className="mt-4 text-sm text-muted">Loading the clock…</p>
            ) : clock.requests.length === 0 ? (
              <p className="mt-4 text-sm text-muted" data-testid="services-portal-clock-empty">
                No requests in the last {clock.window.days} days and nothing open.
              </p>
            ) : (
              <>
                <p className="mt-3 text-sm text-muted" data-testid="services-portal-clock-summary">
                  {clock.summary.open} open, {clock.summary.overdue} past a promise right now ·
                  acknowledged: {clock.summary.acknowledge.met} met, {clock.summary.acknowledge.breached} breached,{" "}
                  {clock.summary.acknowledge.unrecorded} unrecorded · resolved: {clock.summary.resolve.met} met,{" "}
                  {clock.summary.resolve.breached} breached
                </p>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm" data-testid="services-portal-clock-table">
                    <thead>
                      <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                        <th className="py-2 pr-3 font-medium">Request</th>
                        <th className="py-2 pr-3 font-medium">Kind</th>
                        <th className="py-2 pr-3 font-medium">Sent</th>
                        <th className="py-2 pr-3 font-medium">Waiting</th>
                        <th className="py-2 pr-3 font-medium">Acknowledge</th>
                        <th className="py-2 font-medium">Resolve</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {clock.requests.slice(0, 200).map((row) => (
                        <tr key={row.requestId}>
                          <td className="py-2.5 pr-3 text-foreground">
                            {row.summary}
                            <span className="block text-xs text-muted">{row.accountName} · {row.status}</span>
                          </td>
                          <td className="py-2.5 pr-3 text-muted">{row.kind}</td>
                          <td className="py-2.5 pr-3 text-muted">{row.submittedAt.slice(0, 16).replace("T", " ")}</td>
                          <td className="py-2.5 pr-3 tabular-nums text-muted">{waited(row.waitingMinutes)}</td>
                          <td className="py-2.5 pr-3"><SlaChip state={row.acknowledgeState} dueAt={row.acknowledgeDueAt} /></td>
                          <td className="py-2.5"><SlaChip state={row.resolveState} dueAt={row.resolveDueAt} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
          <Card>
            <SectionTitle
              title="The promises, by kind"
              description="Hours to acknowledge and hours to resolve. The defaults are the schema's; a saved row overrides one kind for this workspace, and Reset returns it to the default."
            />
            <ul className="mt-3 divide-y divide-line" data-testid="services-portal-sla-policies">
              {(clock?.policies ?? []).map((policy) => {
                const current = policyDraft[policy.kind] ?? {
                  acknowledgeHours: String(policy.acknowledgeHours),
                  resolveHours: String(policy.resolveHours),
                };
                return (
                  <li key={policy.kind} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                    <span className="w-24 font-medium text-foreground">{policy.kind}</span>
                    <label className="flex items-center gap-1 text-xs text-muted">
                      acknowledge in
                      <input
                        type="number"
                        min={1}
                        max={720}
                        value={current.acknowledgeHours}
                        aria-label={`Hours to acknowledge a ${policy.kind} request`}
                        onChange={(event) => setPolicyDraft((previous) => ({ ...previous, [policy.kind]: { ...current, acknowledgeHours: event.target.value } }))}
                        className="w-16 rounded-lg border border-line px-2 py-1 text-sm text-foreground"
                      />
                      h
                    </label>
                    <label className="flex items-center gap-1 text-xs text-muted">
                      resolve in
                      <input
                        type="number"
                        min={1}
                        max={2160}
                        value={current.resolveHours}
                        aria-label={`Hours to resolve a ${policy.kind} request`}
                        onChange={(event) => setPolicyDraft((previous) => ({ ...previous, [policy.kind]: { ...current, resolveHours: event.target.value } }))}
                        className="w-16 rounded-lg border border-line px-2 py-1 text-sm text-foreground"
                      />
                      h
                    </label>
                    <span className="text-xs text-faint">{policy.overridden ? "overridden" : "default"}</span>
                    <button
                      type="button"
                      disabled={busy === `policy:${policy.kind}` || policyDraft[policy.kind] === undefined}
                      onClick={() => void savePolicy(policy.kind, false)}
                      className="btn btn-primary px-2 py-0.5 text-xs"
                      aria-label={`Save the ${policy.kind} policy`}
                    >
                      Save
                    </button>
                    {policy.overridden ? (
                      <button
                        type="button"
                        disabled={busy === `policy:${policy.kind}`}
                        onClick={() => void savePolicy(policy.kind, true)}
                        className="btn btn-secondary px-2 py-0.5 text-xs"
                        aria-label={`Reset the ${policy.kind} policy`}
                      >
                        Reset
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      ) : null}

      {tab === "ratings" ? (
        <Card>
          <SectionTitle
            title="What customers said after their visits"
            description="Asked in the portal after a completed visit, once per visit, in the customer's own words. The average is null until somebody answers; the response rate is null until a visit was completed to answer about."
          />
          {surveys === null ? (
            <p className="mt-4 text-sm text-muted">Loading the ratings…</p>
          ) : (
            <>
              <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="services-portal-ratings-figures">
                <div className="rounded-xl border border-line bg-surface p-4">
                  <dt className="text-xs uppercase tracking-wide text-faint">Average</dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                    {surveys.summary.averageScore === null ? "—" : `${surveys.summary.averageScore.toFixed(2)} / 5`}
                  </dd>
                </div>
                <div className="rounded-xl border border-line bg-surface p-4">
                  <dt className="text-xs uppercase tracking-wide text-faint">Responses</dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{surveys.summary.responses}</dd>
                </div>
                <div className="rounded-xl border border-line bg-surface p-4">
                  <dt className="text-xs uppercase tracking-wide text-faint">Response rate</dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                    {surveys.summary.responseRateBps === null ? "—" : `${(surveys.summary.responseRateBps / 100).toFixed(1)}%`}
                  </dd>
                  <span className="text-xs text-faint">of {surveys.summary.completedVisits} completed visits, {surveys.window.days} days</span>
                </div>
                <div className="rounded-xl border border-line bg-surface p-4">
                  <dt className="text-xs uppercase tracking-wide text-faint">Distribution</dt>
                  <dd className="mt-1 text-sm tabular-nums text-foreground" data-testid="services-portal-ratings-distribution">
                    {([5, 4, 3, 2, 1] as const).map((score) => `${score}★ ${surveys.summary.distribution[score]}`).join(" · ")}
                  </dd>
                </div>
              </dl>
              {surveys.summary.detractors.length > 0 ? (
                <div className="mt-6" data-testid="services-portal-ratings-detractors">
                  <h3 className="text-sm font-semibold text-foreground">Call these back</h3>
                  <ul className="mt-2 divide-y divide-line">
                    {surveys.summary.detractors.slice(0, 20).map((response) => (
                      <li key={response.surveyId} className="py-2 text-sm">
                        <span className="font-medium text-foreground">{response.accountName}</span>
                        <span className="text-muted"> · {response.serviceType} · {response.technicianName ?? "no technician"} · {response.score}/5</span>
                        {response.comment !== null ? <span className="block text-muted">“{response.comment}”</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {surveys.summary.byTechnician.length > 0 ? (
                <div className="mt-6 overflow-x-auto">
                  <table className="w-full text-left text-sm" data-testid="services-portal-ratings-technicians">
                    <thead>
                      <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                        <th className="py-2 pr-3 font-medium">Technician</th>
                        <th className="py-2 pr-3 font-medium">Responses</th>
                        <th className="py-2 font-medium">Average</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {surveys.summary.byTechnician.map((entry) => (
                        <tr key={entry.technicianId ?? "none"}>
                          <td className="py-2 pr-3 text-foreground">{entry.technicianName}</td>
                          <td className="py-2 pr-3 tabular-nums text-muted">{entry.responses}</td>
                          <td className="py-2 tabular-nums text-muted">{entry.averageScore.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted" data-testid="services-portal-ratings-empty">
                  No ratings yet. A customer with a portal login is asked after each completed visit.
                </p>
              )}
            </>
          )}
        </Card>
      ) : null}

      {tab === "messages" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Card>
            <SectionTitle
              title="Waiting on a reply"
              description="Accounts with a customer message nobody has opened, newest first. Every message is kept as sent; only its read mark changes."
            />
            {threads === null ? (
              <p className="mt-4 text-sm text-muted">Loading…</p>
            ) : threads.summary.accountsAwaiting.length === 0 ? (
              <p className="mt-4 text-sm text-muted" data-testid="services-portal-messages-clear">
                Nothing unread from customers.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-line" data-testid="services-portal-messages-awaiting">
                {threads.summary.accountsAwaiting.map((entry) => (
                  <li key={entry.accountId} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <button type="button" onClick={() => void openThread(entry.accountId)} className="text-left font-medium text-foreground underline-offset-2 hover:underline">
                      {users?.portalUsers.find((portalUser) => portalUser.accountId === entry.accountId)?.accountName ?? entry.accountId}
                    </button>
                    <span className="text-xs text-muted">{entry.unread} unread · {entry.latestAt.slice(0, 10)}</span>
                  </li>
                ))}
              </ul>
            )}
            {(users?.portalUsers ?? []).length > 0 ? (
              <label className="mt-4 block text-sm">
                <span className="mb-1 block text-xs uppercase tracking-wide text-faint">Open a thread</span>
                <select
                  value={threadAccount ?? ""}
                  onChange={(event) => { if (event.target.value) void openThread(event.target.value); }}
                  aria-label="Open the thread for an account"
                  className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                >
                  <option value="">Choose an account with a portal login…</option>
                  {[...new Map((users?.portalUsers ?? []).map((portalUser) => [portalUser.accountId, portalUser.accountName ?? portalUser.accountId])).entries()].map(([accountId, name]) => (
                    <option key={accountId} value={accountId}>{name}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </Card>
          <Card>
            <SectionTitle
              title={threadAccount === null ? "Thread" : `Thread with ${users?.portalUsers.find((portalUser) => portalUser.accountId === threadAccount)?.accountName ?? "the account"}`}
              description="Both sides, oldest first. What the customer wrote stays exactly as written."
            />
            {threadAccount === null ? (
              <p className="mt-4 text-sm text-muted">Choose an account to read its thread.</p>
            ) : thread === null ? (
              <p className="mt-4 text-sm text-muted">Loading the thread…</p>
            ) : (
              <>
                {thread.messages.length === 0 ? (
                  <p className="mt-4 text-sm text-muted" data-testid="services-portal-thread-empty">No messages yet.</p>
                ) : (
                  <ul className="mt-3 space-y-2" data-testid="services-portal-thread">
                    {thread.messages.map((message) => (
                      <li
                        key={message.id}
                        className={cn(
                          "rounded-xl border px-3 py-2 text-sm",
                          message.authorKind === "customer" ? "border-amber-200 bg-amber-50/40" : "border-line bg-surface",
                        )}
                      >
                        <span className="block text-xs text-faint">
                          {message.authorKind === "customer" ? "Customer" : "Staff"} · {message.sentAt.slice(0, 16).replace("T", " ")}
                          {message.readAt !== null ? " · read" : message.authorKind === "customer" ? " · unread" : ""}
                        </span>
                        <span className="block text-foreground">{message.body}</span>
                        {message.authorKind === "customer" && message.readAt === null ? (
                          <button
                            type="button"
                            disabled={busy === `read:${message.id}`}
                            onClick={() => void markRead(message.id)}
                            className="btn btn-secondary mt-1 px-2 py-0.5 text-xs"
                          >
                            Mark read
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-4 flex flex-col gap-2">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    rows={3}
                    maxLength={2000}
                    aria-label="Write to the customer"
                    placeholder="Write to the customer…"
                    className="w-full rounded-lg border border-line px-2 py-1 text-sm"
                  />
                  <button
                    type="button"
                    disabled={busy === `message:${threadAccount}` || draft.trim().length === 0}
                    onClick={() => void sendMessage()}
                    className="btn btn-primary w-fit px-3 py-1.5 text-xs"
                  >
                    Send
                  </button>
                </div>
              </>
            )}
          </Card>
        </div>
      ) : null}

      {tab === "logins" ? (
        <Card>
          <SectionTitle
            title="Portal logins"
            description="An invitation is an address, not an account. It becomes a login only when the person at that address accepts it — which is why a row can sit at 'invited' indefinitely, and why that is worth seeing."
          />
          {(users?.portalUsers ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted" data-testid="services-portal-logins-empty">
              No portal invitations yet. Invite a billing contact and they can see their invoices,
              visits and paperwork without calling the office.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="services-portal-logins-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Address</th>
                    <th className="py-2 pr-3 font-medium">Account</th>
                    <th className="py-2 pr-3 font-medium">Role</th>
                    <th className="py-2 pr-3 font-medium">Invited</th>
                    <th className="py-2 pr-3 font-medium">Last seen</th>
                    <th className="py-2 font-medium">State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(users?.portalUsers ?? []).slice(0, 100).map((portalUser) => (
                    <tr key={portalUser.id}>
                      <td className="py-2.5 pr-3 text-foreground">{portalUser.email}</td>
                      <td className="py-2.5 pr-3 text-muted">{portalUser.accountName ?? "—"}</td>
                      <td className="py-2.5 pr-3 text-muted">{portalUser.role}</td>
                      <td className="py-2.5 pr-3 text-muted">{portalUser.invitedAt.slice(0, 10)}</td>
                      <td className="py-2.5 pr-3 text-muted">
                        {portalUser.lastSeenAt === null ? (
                          <span className="text-amber-700">never</span>
                        ) : (
                          portalUser.lastSeenAt.slice(0, 10)
                        )}
                      </td>
                      <td className="py-2.5">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                            STATE_TONES[portalUser.state] ?? STATE_TONES.invited,
                          )}
                        >
                          {portalUser.state}
                        </span>
                        <button
                          type="button"
                          disabled={busy === portalUser.id}
                          onClick={() => void patchUser(portalUser.id, { active: !portalUser.active })}
                          className="btn btn-secondary ml-2 px-2 py-0.5 text-xs"
                        >
                          {portalUser.active ? "Suspend" : "Restore"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "amber" | "rose" }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <dt className="flex items-center gap-2 text-xs uppercase tracking-wide text-faint">
        <UserRoundCheck className="size-3.5" aria-hidden="true" />
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "rose" ? "text-rose-700" : tone === "amber" ? "text-amber-700" : "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
