"use client";

import { useCallback, useEffect, useState } from "react";
import { BanknoteArrowDown } from "lucide-react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import type { BillingRunsPayload, CollectionsPayload } from "@/components/services/types";
import { cn } from "@/lib/cn";

/**
 * Recurring billing and the collections desk.
 *
 * The button on this page raises invoices from service plans that have come
 * due. Pressing it twice bills once — not because the page guards against
 * it, but because a partial unique index in the database says a plan cannot
 * be billed twice for the same period. The run reports what it skipped for
 * that reason, so a second press reads as "already billed" rather than as
 * a silent success.
 *
 * Nothing here sends anything. A collections note records what a PERSON
 * did — called, posted a letter, agreed a plan — because no email or SMS
 * provider is connected, and a queue of unsent reminders styled like sent
 * ones would be worse than no dunning at all.
 */

const ACTIONS = [
  "reminder_call",
  "reminder_letter",
  "reminder_email",
  "final_notice",
  "payment_plan",
  "sent_to_collections",
  "written_off",
] as const;

const BUCKET_TONES: Record<string, string> = {
  "1-30": "border-amber-200 bg-amber-50 text-amber-700",
  "31-60": "border-orange-200 bg-orange-50 text-orange-700",
  "61-90": "border-rose-200 bg-rose-50 text-rose-700",
  "90+": "border-rose-300 bg-rose-100 text-rose-800",
};

type Tab = "worklist" | "runs";

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function ServicesCollectionsPanel() {
  const [collections, setCollections] = useState<CollectionsPayload | null>(null);
  const [billing, setBilling] = useState<BillingRunsPayload | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("worklist");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [action, setAction] = useState<(typeof ACTIONS)[number]>("reminder_call");
  const [outcome, setOutcome] = useState("");
  const [lastRun, setLastRun] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [collectionsRes, billingRes] = await Promise.all([
        fetch("/api/services/collections", { headers: { accept: "application/json" } }),
        fetch("/api/services/billing/recurring", { headers: { accept: "application/json" } }),
      ]);
      const body = (await collectionsRes.json()) as CollectionsPayload & { error?: { message?: string } };
      if (!collectionsRes.ok) {
        setListError(body.error?.message ?? "Collections could not be read.");
        return;
      }
      setListError(null);
      setCollections(body);
      if (billingRes.ok) setBilling((await billingRes.json()) as BillingRunsPayload);
    } catch {
      setListError("Collections could not be read.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  const runBilling = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch("/api/services/billing/recurring", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await response.json()) as {
        run?: { invoicesCreated: number; plansConsidered: number; plansAlreadyBilled: number; totalCents: number };
        error?: { message?: string };
      };
      if (!response.ok || body.run === undefined) {
        setActionError(body.error?.message ?? "The billing run could not be completed.");
        return;
      }
      setLastRun(
        body.run.invoicesCreated === 0
          ? `Considered ${body.run.plansConsidered}; every due period was already invoiced, so nothing new was raised.`
          : `Raised ${body.run.invoicesCreated} invoice${body.run.invoicesCreated === 1 ? "" : "s"} `
            + `worth ${money(body.run.totalCents)} from ${body.run.plansConsidered} due plan`
            + `${body.run.plansConsidered === 1 ? "" : "s"}`
            + (body.run.plansAlreadyBilled > 0
              ? `, skipping ${body.run.plansAlreadyBilled} already billed for the period.`
              : "."),
      );
      await refresh();
    } catch {
      setActionError("The billing run could not be completed.");
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const recordNotice = useCallback(
    async (invoice: CollectionsPayload["invoices"][number]) => {
      setBusy(true);
      setActionError(null);
      try {
        const response = await fetch("/api/services/collections", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            invoiceId: invoice.invoiceId,
            accountId: invoice.accountId,
            action,
            daysOverdue: invoice.daysOverdue,
            balanceCents: invoice.balanceCents,
            outcome: outcome.trim().length === 0 ? null : outcome.trim(),
          }),
        });
        if (!response.ok) {
          const body = (await response.json()) as { error?: { message?: string } };
          setActionError(body.error?.message ?? "The note could not be recorded.");
          return;
        }
        setNoteFor(null);
        setOutcome("");
        await refresh();
      } catch {
        setActionError("The note could not be recorded.");
      } finally {
        setBusy(false);
      }
    },
    [action, outcome, refresh],
  );

  return (
    <div>
      <PageHeader
        title="Billing & Collections"
        description="Raise the invoices that recurring plans have come due for, and work the ones that never got paid."
      />

      {listError !== null ? <Notice tone="warning">{listError}</Notice> : null}
      {actionError !== null ? <Notice tone="warning">{actionError}</Notice> : null}
      {lastRun !== null ? <Notice tone="info">{lastRun}</Notice> : null}

      <Card className="mb-6">
        <SectionTitle
          title="Where the money is"
          description="Untouched is the number this page exists for: a long worklist somebody is working and a long worklist nobody has opened look identical without it."
        />
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="services-collections-figures">
          <Figure label="Overdue" value={collections === null ? "—" : money(collections.counts.balanceCents)} tone={(collections?.counts.balanceCents ?? 0) > 0 ? "amber" : undefined} />
          <Figure label="Invoices past due" value={collections === null ? "—" : String(collections.counts.total)} />
          <Figure
            label="Untouched"
            value={collections === null ? "—" : String(collections.counts.untouched)}
            tone={(collections?.counts.untouched ?? 0) > 0 ? "amber" : undefined}
          />
          <Figure
            label="Over 90 days"
            value={collections === null ? "—" : String(collections.counts.over90)}
            tone={(collections?.counts.over90 ?? 0) > 0 ? "rose" : undefined}
          />
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void runBilling()}
            className="btn btn-primary px-4 py-2 text-sm"
            data-testid="services-run-billing"
          >
            {busy ? "Running…" : "Raise invoices now due"}
          </button>
          <span className="text-sm text-muted">
            Running this twice bills once — the database refuses a second invoice for a period
            already covered. Unattended, scheduled billing is{" "}
            <strong>{billing?.automatic.label ?? "Not Connected"}</strong>.
          </span>
        </div>
      </Card>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Billing and collections">
        {(
          [
            ["worklist", "Worklist", collections?.invoices.length],
            ["runs", "Billing runs", billing?.runs.length],
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

      {tab === "worklist" ? (
        <Card>
          <SectionTitle
            title="Overdue, oldest and largest first"
            description="The order a collections desk actually works. A note records what somebody did about it — sending is Not Connected, so nothing here claims to have been delivered."
          />
          {(collections?.invoices ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted" data-testid="services-collections-empty">
              Nothing is past due. Invoices appear here the day after their terms run out.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="services-collections-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Invoice</th>
                    <th className="py-2 pr-3 font-medium">Customer</th>
                    <th className="py-2 pr-3 font-medium">Balance</th>
                    <th className="py-2 pr-3 font-medium">Age</th>
                    <th className="py-2 pr-3 font-medium">Last action</th>
                    <th className="py-2 font-medium">Record</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(collections?.invoices ?? []).slice(0, 100).map((invoice) => (
                    <tr key={invoice.invoiceId}>
                      <td className="py-2.5 pr-3 text-foreground">{invoice.number}</td>
                      <td className="py-2.5 pr-3 text-muted">{invoice.accountName}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-foreground">
                        {money(invoice.balanceCents)}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                            BUCKET_TONES[invoice.bucket] ?? BUCKET_TONES["1-30"],
                          )}
                        >
                          {invoice.daysOverdue}d
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-muted">
                        {invoice.untouched ? (
                          <span className="text-amber-700">nobody has called</span>
                        ) : (
                          <>
                            {invoice.lastAction?.replace(/_/g, " ")}
                            <span className="ml-1.5 text-xs text-faint">
                              {invoice.lastActedAt?.slice(0, 10)}
                            </span>
                          </>
                        )}
                      </td>
                      <td className="py-2.5">
                        {noteFor === invoice.invoiceId ? (
                          <span className="flex flex-col gap-1">
                            <select
                              value={action}
                              onChange={(event) => setAction(event.target.value as (typeof ACTIONS)[number])}
                              aria-label={`Action for ${invoice.number}`}
                              className="w-44 rounded-lg border border-line px-2 py-1 text-xs"
                            >
                              {ACTIONS.map((value) => (
                                <option key={value} value={value}>
                                  {value.replace(/_/g, " ")}
                                </option>
                              ))}
                            </select>
                            <input
                              value={outcome}
                              onChange={(event) => setOutcome(event.target.value)}
                              maxLength={1000}
                              placeholder="What happened (optional)"
                              aria-label={`Outcome for ${invoice.number}`}
                              className="w-44 rounded-lg border border-line px-2 py-1 text-xs"
                            />
                            <span className="flex gap-1">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void recordNotice(invoice)}
                                className="btn btn-primary px-2 py-0.5 text-xs"
                              >
                                Record
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setNoteFor(null);
                                  setOutcome("");
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
                              setNoteFor(invoice.invoiceId);
                              setOutcome("");
                            }}
                            className="btn btn-secondary px-2 py-0.5 text-xs"
                          >
                            Log an action
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

      {tab === "runs" ? (
        <Card>
          <SectionTitle
            title="Billing runs"
            description="Every batch somebody performed, with what it raised and what it found already invoiced."
          />
          {(billing?.runs ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted" data-testid="services-billing-runs-empty">
              No runs yet. Press “Raise invoices now due” and the batch is recorded here with your
              name on it.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="services-billing-runs-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Ran</th>
                    <th className="py-2 pr-3 font-medium">Through</th>
                    <th className="py-2 pr-3 font-medium">Considered</th>
                    <th className="py-2 pr-3 font-medium">Raised</th>
                    <th className="py-2 pr-3 font-medium">Already billed</th>
                    <th className="py-2 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(billing?.runs ?? []).slice(0, 100).map((run) => (
                    <tr key={run.id}>
                      <td className="py-2.5 pr-3 text-foreground">{run.ranAt.slice(0, 10)}</td>
                      <td className="py-2.5 pr-3 text-muted">{run.throughOn}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">{run.plansConsidered}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-foreground">{run.invoicesCreated}</td>
                      <td
                        className={cn(
                          "py-2.5 pr-3 tabular-nums",
                          run.plansAlreadyBilled > 0 ? "text-sky-700" : "text-muted",
                        )}
                      >
                        {run.plansAlreadyBilled}
                      </td>
                      <td className="py-2.5 tabular-nums text-muted">{money(run.totalCents)}</td>
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
        <BanknoteArrowDown className="size-3.5" aria-hidden="true" />
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
