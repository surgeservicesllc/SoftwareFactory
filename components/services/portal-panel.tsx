"use client";

import { useCallback, useEffect, useState } from "react";
import { UserRoundCheck } from "lucide-react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import type { PortalRequestsPayload, PortalUsersPayload } from "@/components/services/types";
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

type Tab = "requests" | "logins";

export function ServicesPortalPanel() {
  const [users, setUsers] = useState<PortalUsersPayload | null>(null);
  const [requests, setRequests] = useState<PortalRequestsPayload | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("requests");
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [usersRes, requestsRes] = await Promise.all([
        fetch("/api/services/portal", { headers: { accept: "application/json" } }),
        fetch("/api/services/portal/requests", { headers: { accept: "application/json" } }),
      ]);
      const body = (await requestsRes.json()) as PortalRequestsPayload & { error?: { message?: string } };
      if (!requestsRes.ok) {
        setListError(body.error?.message ?? "Service requests could not be read.");
        return;
      }
      setListError(null);
      setRequests(body);
      if (usersRes.ok) setUsers((await usersRes.json()) as PortalUsersPayload);
    } catch {
      setListError("Service requests could not be read.");
    }
  }, []);

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
