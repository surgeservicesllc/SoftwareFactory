"use client";

import { useCallback, useEffect, useState } from "react";
import { Receipt } from "lucide-react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * What a customer sees.
 *
 * Everything on this page comes from the SECURITY DEFINER functions that
 * resolve the signed-in caller to exactly one account. There is no account
 * selector, no id in a URL and no filter the customer can widen — the
 * server does not accept one, because the answer to "whose data" is never
 * theirs to give.
 *
 * Two controls are deliberately absent rather than decorative. Paying an
 * invoice needs a card processor and downloading a document needs object
 * storage; neither is connected to this project, so both are labelled
 * **Not Connected** instead of rendering a button that would do nothing.
 */

type Summary = {
  accountName: string;
  accountStatus: string;
  openInvoices: number;
  balanceCents: number;
  nextVisitOn: string | null;
  openRequests: number;
};

type Invoice = {
  id: string;
  number: string;
  status: string;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  issuedOn: string | null;
  dueOn: string | null;
  overdue: boolean;
};

type Visit = {
  id: string;
  serviceType: string;
  status: string;
  scheduledStart: string | null;
  completedAt: string | null;
  propertyLabel: string | null;
  completionNotes: string | null;
};

type PortalDocument = {
  id: string;
  title: string;
  kind: string;
  storagePath: string;
  contentType: string | null;
  byteSize: number | null;
  uploadedAt: string;
};

type Request = {
  id: string;
  kind: string;
  status: string;
  summary: string;
  detail: string | null;
  preferredDate: string | null;
  response: string | null;
  submittedAt: string;
  resolvedAt: string | null;
  open: boolean;
  answered: boolean;
};

type Tab = "overview" | "invoices" | "visits" | "documents" | "requests";

const REQUEST_KINDS = ["service", "reschedule", "question", "complaint", "cancel", "quote"] as const;

const STATUS_TONES: Record<string, string> = {
  open: "border-amber-200 bg-amber-50 text-amber-700",
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
  void: "border-slate-200 bg-slate-100 text-slate-500",
  uncollectible: "border-rose-200 bg-rose-50 text-rose-700",
  submitted: "border-amber-200 bg-amber-50 text-amber-700",
  acknowledged: "border-sky-200 bg-sky-50 text-sky-700",
  scheduled: "border-violet-200 bg-violet-50 text-violet-700",
  resolved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  declined: "border-slate-200 bg-slate-100 text-slate-500",
};

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function CustomerPortalPanel() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [documents, setDocuments] = useState<PortalDocument[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [noAccess, setNoAccess] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");

  const [kind, setKind] = useState<(typeof REQUEST_KINDS)[number]>("service");
  const [summaryText, setSummaryText] = useState("");
  const [detail, setDetail] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/customer-portal", { headers: { accept: "application/json" } });
      if (response.status === 403) {
        setNoAccess(true);
        setSummary(null);
        return;
      }
      const body = (await response.json()) as { summary?: Summary; error?: { message?: string } };
      if (!response.ok) {
        setLoadError(body.error?.message ?? "Your account could not be loaded.");
        return;
      }
      setNoAccess(false);
      setLoadError(null);
      setSummary(body.summary ?? null);

      const [invoicesRes, visitsRes, documentsRes, requestsRes] = await Promise.all([
        fetch("/api/customer-portal/invoices", { headers: { accept: "application/json" } }),
        fetch("/api/customer-portal/visits", { headers: { accept: "application/json" } }),
        fetch("/api/customer-portal/documents", { headers: { accept: "application/json" } }),
        fetch("/api/customer-portal/requests", { headers: { accept: "application/json" } }),
      ]);
      if (invoicesRes.ok) setInvoices(((await invoicesRes.json()) as { invoices: Invoice[] }).invoices);
      if (visitsRes.ok) setVisits(((await visitsRes.json()) as { visits: Visit[] }).visits);
      if (documentsRes.ok)
        setDocuments(((await documentsRes.json()) as { documents: PortalDocument[] }).documents);
      if (requestsRes.ok) setRequests(((await requestsRes.json()) as { requests: Request[] }).requests);
    } catch {
      setLoadError("Your account could not be loaded.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  const accept = useCallback(async () => {
    setClaiming(true);
    setActionError(null);
    try {
      const response = await fetch("/api/customer-portal/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setActionError(body.error?.message ?? "The invitation could not be accepted.");
        return;
      }
      await refresh();
    } catch {
      setActionError("The invitation could not be accepted.");
    } finally {
      setClaiming(false);
    }
  }, [refresh]);

  const send = useCallback(async () => {
    setSending(true);
    setActionError(null);
    try {
      const response = await fetch("/api/customer-portal/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          summary: summaryText.trim(),
          detail: detail.trim().length === 0 ? null : detail.trim(),
          preferredDate: preferredDate.length === 0 ? null : preferredDate,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setActionError(body.error?.message ?? "Your request could not be sent.");
        return;
      }
      setSummaryText("");
      setDetail("");
      setPreferredDate("");
      await refresh();
    } catch {
      setActionError("Your request could not be sent.");
    } finally {
      setSending(false);
    }
  }, [detail, kind, preferredDate, refresh, summaryText]);

  if (noAccess) {
    return (
      <div>
        <PageHeader
          title="Your Service"
          description="This page is for customers who have been invited to the portal by their pest-control company."
        />
        {actionError !== null ? <Notice tone="warning">{actionError}</Notice> : null}
        <Card>
          <SectionTitle
            title="Accept your invitation"
            description="If your company invited the address you are signed in with, this turns that invitation into a login. Nothing else can — an invitation is matched to your own verified address, never assigned to you."
          />
          <button
            type="button"
            disabled={claiming}
            onClick={() => void accept()}
            className="btn btn-primary mt-4 px-4 py-2 text-sm"
            data-testid="customer-portal-accept"
          >
            {claiming ? "Checking…" : "Accept my invitation"}
          </button>
          <p className="mt-3 text-sm text-muted">
            No invitation for this address? Ask your service company to send one to the address you
            signed in with.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={summary === null ? "Your Service" : summary.accountName}
        description="Your invoices, your visits, your paperwork, and a way to ask for something without calling the office."
      />

      {loadError !== null ? <Notice tone="warning">{loadError}</Notice> : null}
      {actionError !== null ? <Notice tone="warning">{actionError}</Notice> : null}

      <Card className="mb-6">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="customer-portal-figures">
          <Figure label="Balance" value={summary === null ? "—" : money(summary.balanceCents)} tone={(summary?.balanceCents ?? 0) > 0 ? "amber" : undefined} />
          <Figure label="Open invoices" value={summary === null ? "—" : String(summary.openInvoices)} />
          <Figure
            label="Next visit"
            /* Null when nothing is booked. Saying "none scheduled" is the
             * honest answer; a placeholder date would imply somebody is
             * coming when nobody is. */
            value={summary === null ? "—" : (summary.nextVisitOn ?? "none scheduled")}
          />
          <Figure label="Open requests" value={summary === null ? "—" : String(summary.openRequests)} />
        </dl>
      </Card>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Your service">
        {(
          [
            ["overview", "Overview", undefined],
            ["invoices", "Invoices", invoices.length],
            ["visits", "Visits", visits.length],
            ["documents", "Documents", documents.length],
            ["requests", "Requests", requests.length],
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

      {tab === "overview" ? (
        <Card>
          <SectionTitle
            title="Where things stand"
            description="Everything here is your account and nothing else. The server resolves who you are; it does not take an account from the page."
          />
          <p className="mt-4 text-sm text-muted">
            {summary === null
              ? "Loading your account…"
              : `Your account is ${summary.accountStatus}. ${
                  summary.openInvoices === 0
                    ? "Nothing is outstanding."
                    : `${summary.openInvoices} invoice${summary.openInvoices === 1 ? "" : "s"} open, ${money(summary.balanceCents)} in total.`
                } ${summary.nextVisitOn === null ? "No visit is scheduled — ask for one on the Requests tab." : `Your next visit is ${summary.nextVisitOn}.`}`}
          </p>
        </Card>
      ) : null}

      {tab === "invoices" ? (
        <Card>
          <SectionTitle
            title="Invoices"
            description="Issued invoices only. A draft has not been sent to anybody, so it is not here."
          />
          <Notice tone="info">
            Paying online is <strong>Not Connected</strong> — no card processor is configured for this
            workspace. Balances are accurate; settle them the way you do today.
          </Notice>
          {invoices.length === 0 ? (
            <p className="mt-4 text-sm text-muted" data-testid="customer-portal-invoices-empty">
              No invoices yet.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="customer-portal-invoices-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Invoice</th>
                    <th className="py-2 pr-3 font-medium">Issued</th>
                    <th className="py-2 pr-3 font-medium">Due</th>
                    <th className="py-2 pr-3 font-medium">Total</th>
                    <th className="py-2 pr-3 font-medium">Balance</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td className="py-2.5 pr-3 text-foreground">{invoice.number}</td>
                      <td className="py-2.5 pr-3 text-muted">{invoice.issuedOn ?? "—"}</td>
                      <td className="py-2.5 pr-3 text-muted">
                        {invoice.dueOn ?? "—"}
                        {invoice.overdue ? <span className="ml-1 text-rose-700">overdue</span> : null}
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">{money(invoice.totalCents)}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-foreground">{money(invoice.balanceCents)}</td>
                      <td className="py-2.5">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                            STATUS_TONES[invoice.status] ?? STATUS_TONES.open,
                          )}
                        >
                          {invoice.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === "visits" ? (
        <Card>
          <SectionTitle
            title="Visits"
            description="What has been done at your sites, and what is booked. The note is the one your technician wrote for you."
          />
          {visits.length === 0 ? (
            <p className="mt-4 text-sm text-muted" data-testid="customer-portal-visits-empty">
              No visits recorded yet.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="customer-portal-visits-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Service</th>
                    <th className="py-2 pr-3 font-medium">Site</th>
                    <th className="py-2 pr-3 font-medium">Scheduled</th>
                    <th className="py-2 pr-3 font-medium">Completed</th>
                    <th className="py-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {visits.map((visit) => (
                    <tr key={visit.id}>
                      <td className="py-2.5 pr-3 text-foreground">{visit.serviceType}</td>
                      <td className="py-2.5 pr-3 text-muted">{visit.propertyLabel ?? "—"}</td>
                      <td className="py-2.5 pr-3 text-muted">
                        {visit.scheduledStart === null ? "—" : visit.scheduledStart.slice(0, 10)}
                      </td>
                      <td className="py-2.5 pr-3 text-muted">
                        {visit.completedAt === null ? "—" : visit.completedAt.slice(0, 10)}
                      </td>
                      <td className="py-2.5 text-muted">{visit.completionNotes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === "documents" ? (
        <Card>
          <SectionTitle
            title="Documents"
            description="Your agreements, reports and permits. Internal photographs and staff notes are not in this list."
          />
          <Notice tone="info">
            Downloading is <strong>Not Connected</strong> — no document storage is configured for this
            workspace, so these are listed rather than opened.
          </Notice>
          {documents.length === 0 ? (
            <p className="mt-4 text-sm text-muted" data-testid="customer-portal-documents-empty">
              Nothing filed yet.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-line" data-testid="customer-portal-documents-list">
              {documents.map((document) => (
                <li key={document.id} className="py-2.5">
                  <span className="text-sm text-foreground">{document.title}</span>
                  <span className="ml-2 text-xs text-faint">
                    {document.kind.replace(/_/g, " ")} · {document.uploadedAt.slice(0, 10)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {tab === "requests" ? (
        <>
          <Card className="mb-6">
            <SectionTitle
              title="Ask for something"
              description="What you write here goes to your service company as you wrote it. Their reply appears beside it — it never replaces your words."
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-xs uppercase tracking-wide text-faint">Kind</span>
                <select
                  value={kind}
                  onChange={(event) => setKind(event.target.value as (typeof REQUEST_KINDS)[number])}
                  className="w-full rounded-lg border border-line px-2 py-1.5 text-sm"
                >
                  {REQUEST_KINDS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs uppercase tracking-wide text-faint">
                  Preferred date (optional)
                </span>
                <input
                  type="date"
                  value={preferredDate}
                  onChange={(event) => setPreferredDate(event.target.value)}
                  className="w-full rounded-lg border border-line px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block text-xs uppercase tracking-wide text-faint">In one line</span>
                <input
                  value={summaryText}
                  onChange={(event) => setSummaryText(event.target.value)}
                  maxLength={200}
                  placeholder="Ants along the back wall again"
                  className="w-full rounded-lg border border-line px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block text-xs uppercase tracking-wide text-faint">
                  Anything else (optional)
                </span>
                <textarea
                  value={detail}
                  onChange={(event) => setDetail(event.target.value)}
                  rows={3}
                  maxLength={4000}
                  className="w-full rounded-lg border border-line px-2 py-1.5 text-sm"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={sending || summaryText.trim().length === 0}
              onClick={() => void send()}
              className="btn btn-primary mt-4 px-4 py-2 text-sm"
              data-testid="customer-portal-send-request"
            >
              {sending ? "Sending…" : "Send it"}
            </button>
          </Card>

          <Card>
            <SectionTitle title="What you have asked for" description="Yours only, newest first." />
            {requests.length === 0 ? (
              <p className="mt-4 text-sm text-muted" data-testid="customer-portal-requests-empty">
                You have not sent anything yet.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-line" data-testid="customer-portal-requests-list">
                {requests.map((request) => (
                  <li key={request.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-foreground">{request.summary}</span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                          STATUS_TONES[request.status] ?? STATUS_TONES.submitted,
                        )}
                      >
                        {request.status}
                      </span>
                      <span className="text-xs text-faint">{request.submittedAt.slice(0, 10)}</span>
                    </div>
                    {request.detail === null ? null : (
                      <p className="mt-1 text-sm text-muted">{request.detail}</p>
                    )}
                    {request.response === null ? (
                      request.open ? (
                        <p className="mt-1 text-xs text-faint">Waiting on a reply.</p>
                      ) : null
                    ) : (
                      <p className="mt-1 rounded-lg bg-slate-50 p-2 text-sm text-foreground">
                        {request.response}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "amber" | "rose" }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <dt className="flex items-center gap-2 text-xs uppercase tracking-wide text-faint">
        <Receipt className="size-3.5" aria-hidden="true" />
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
