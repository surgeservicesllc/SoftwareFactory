"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, ReceiptText, ScrollText, type LucideIcon } from "lucide-react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { dollars } from "@/components/services/ui";
import type {
  AccountsPayload,
  ContractsPayload,
  EstimatesPayload,
  InvoicesPayload,
  PaymentsPayload,
  RefundsPayload,
} from "@/components/services/types";
import { cn } from "@/lib/cn";

/**
 * Billing: the money half of the chain — estimates quoted, contracts
 * signed, invoices raised, payments received and the credits against them.
 *
 * Every figure on this page is a live row. Nothing is settled here: an
 * invoice becomes paid because a payment arrived and the database said so,
 * and this page reports what the ledger decided rather than asserting it.
 * There is no delete anywhere, because the schema has none — an invoice
 * raised in error is voided, and the void stays on the record.
 */

const ESTIMATE_TONES: Record<string, string> = {
  draft: "border-slate-200 bg-slate-50 text-slate-600",
  sent: "border-sky-200 bg-sky-50 text-sky-700",
  accepted: "border-emerald-200 bg-emerald-50 text-emerald-700",
  declined: "border-rose-200 bg-rose-50 text-rose-700",
  expired: "border-amber-200 bg-amber-50 text-amber-700",
};

const INVOICE_TONES: Record<string, string> = {
  draft: "border-slate-200 bg-slate-50 text-slate-600",
  open: "border-sky-200 bg-sky-50 text-sky-700",
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
  void: "border-slate-200 bg-slate-100 text-slate-500",
  uncollectible: "border-rose-200 bg-rose-50 text-rose-700",
};

const CONTRACT_TONES: Record<string, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  ended: "border-slate-200 bg-slate-50 text-slate-600",
  cancelled: "border-rose-200 bg-rose-50 text-rose-700",
};

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize",
        tone,
      )}
    >
      {children}
    </span>
  );
}

type Tab = "invoices" | "estimates" | "contracts" | "ledger";

export function ServicesBillingPanel() {
  const [estimates, setEstimates] = useState<EstimatesPayload | null>(null);
  const [contracts, setContracts] = useState<ContractsPayload | null>(null);
  const [invoices, setInvoices] = useState<InvoicesPayload | null>(null);
  const [payments, setPayments] = useState<PaymentsPayload | null>(null);
  const [refunds, setRefunds] = useState<RefundsPayload | null>(null);
  const [accounts, setAccounts] = useState<AccountsPayload | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("invoices");
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [invoicesRes, estimatesRes, contractsRes, paymentsRes, refundsRes, accountsRes] =
        await Promise.all([
          fetch("/api/services/invoices", { headers: { accept: "application/json" } }),
          fetch("/api/services/estimates", { headers: { accept: "application/json" } }),
          fetch("/api/services/contracts", { headers: { accept: "application/json" } }),
          fetch("/api/services/payments", { headers: { accept: "application/json" } }),
          fetch("/api/services/refunds", { headers: { accept: "application/json" } }),
          fetch("/api/services/accounts", { headers: { accept: "application/json" } }),
        ]);
      const invoicesBody = (await invoicesRes.json()) as InvoicesPayload & {
        error?: { message?: string };
      };
      if (!invoicesRes.ok) {
        setListError(invoicesBody.error?.message ?? "Billing could not be read.");
        return;
      }
      setListError(null);
      setInvoices(invoicesBody);
      if (estimatesRes.ok) setEstimates((await estimatesRes.json()) as EstimatesPayload);
      if (contractsRes.ok) setContracts((await contractsRes.json()) as ContractsPayload);
      if (paymentsRes.ok) setPayments((await paymentsRes.json()) as PaymentsPayload);
      if (refundsRes.ok) setRefunds((await refundsRes.json()) as RefundsPayload);
      if (accountsRes.ok) setAccounts((await accountsRes.json()) as AccountsPayload);
    } catch {
      setListError("Billing could not be read.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  const accountName = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of accounts?.accounts ?? []) map.set(account.id, account.name);
    return map;
  }, [accounts]);

  const invoiceNumber = useMemo(() => {
    const map = new Map<string, string>();
    for (const invoice of invoices?.invoices ?? []) map.set(invoice.id, invoice.number);
    return map;
  }, [invoices]);

  const paymentById = useMemo(() => {
    const map = new Map<string, PaymentsPayload["payments"][number]>();
    for (const payment of payments?.payments ?? []) map.set(payment.id, payment);
    return map;
  }, [payments]);

  /** Record the balance of one invoice as received. */
  const settle = useCallback(
    async (invoiceId: string, balanceCents: number) => {
      setBusyId(invoiceId);
      setActError(null);
      try {
        const response = await fetch("/api/services/payments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ invoiceId, amountCents: balanceCents, method: "check" }),
        });
        if (!response.ok) {
          const body = (await response.json()) as { error?: { message?: string } };
          setActError(body.error?.message ?? "The payment could not be recorded.");
          return;
        }
        await refresh();
      } catch {
        setActError("The request did not reach the server.");
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const decide = useCallback(
    async (estimateId: string, status: "sent" | "accepted" | "declined") => {
      setBusyId(estimateId);
      setActError(null);
      try {
        const response = await fetch(`/api/services/estimates/${estimateId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status }),
        });
        if (!response.ok) {
          const body = (await response.json()) as { error?: { message?: string } };
          setActError(body.error?.message ?? "The estimate could not be updated.");
          return;
        }
        await refresh();
      } catch {
        setActError("The request did not reach the server.");
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const loading = invoices === null && listError === null;

  return (
    <div>
      <PageHeader
        title="Billing"
        description="Estimates, contracts, invoices and the ledger behind them. An invoice is marked paid by the payments recorded against it, never by hand; nothing here can be deleted."
      />

      {listError !== null ? <Notice tone="warning">{listError}</Notice> : null}
      {actError !== null ? <Notice tone="warning">{actError}</Notice> : null}

      <Card className="mb-6">
        <SectionTitle
          title="The book's money"
          description="What is owed, what is late, what has been collected, and the contracted value behind it."
        />
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="services-billing-figures">
          <Figure label="Outstanding" value={dollars(invoices?.outstandingCents ?? null)} icon={ReceiptText} />
          <Figure label="Overdue" value={dollars(invoices?.overdueCents ?? null)} icon={ReceiptText} tone="rose" />
          <Figure label="Collected" value={dollars(invoices?.collectedCents ?? null)} icon={Banknote} tone="emerald" />
          <Figure
            label="Contracted value"
            value={dollars(contracts?.activeValueCents ?? null)}
            icon={ScrollText}
          />
        </dl>
        {refunds !== null && refunds.refunds.length > 0 ? (
          <p className="mt-3 text-xs text-faint">
            {dollars(refunds.refundedCents)} credited back across {refunds.refunds.length}{" "}
            {refunds.refunds.length === 1 ? "refund" : "refunds"}; every credit is capped at the payment
            it refunds by a database trigger.
          </p>
        ) : null}
      </Card>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Billing records">
        {(
          [
            ["invoices", "Invoices", invoices?.invoices.length],
            ["estimates", "Estimates", estimates?.estimates.length],
            ["contracts", "Contracts", contracts?.contracts.length],
            ["ledger", "Payments & credits", payments?.payments.length],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "btn px-3 py-2 text-sm",
              tab === key ? "btn-primary" : "btn-secondary",
            )}
          >
            {label}
            {typeof count === "number" ? <span className="ml-1.5 text-xs opacity-70">{count}</span> : null}
          </button>
        ))}
      </div>

      {loading ? (
        <Card>
          <p className="text-sm text-muted">Reading the ledger…</p>
        </Card>
      ) : null}

      {!loading && tab === "invoices" ? (
        <Card>
          <SectionTitle
            title="Invoices"
            description="Raised against a contract or a completed visit. The balance is what the ledger says is still owed."
          />
          {(invoices?.invoices ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted" data-testid="services-billing-empty">
              No invoices yet. Raise one from a completed work order, and its payments settle it here.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="services-invoices-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Invoice</th>
                    <th className="py-2 pr-3 font-medium">Customer</th>
                    <th className="py-2 pr-3 font-medium">Issued / due</th>
                    <th className="py-2 pr-3 font-medium">Total</th>
                    <th className="py-2 pr-3 font-medium">Balance</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 font-medium">Settle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(invoices?.invoices ?? []).slice(0, 100).map((invoice) => (
                    <tr key={invoice.id}>
                      <td className="py-2.5 pr-3">
                        <span className="block font-mono text-xs text-foreground">{invoice.number}</span>
                        <span className="block text-xs text-faint">
                          {invoice.lines.length} {invoice.lines.length === 1 ? "line" : "lines"}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-foreground">
                        {accountName.get(invoice.accountId) ?? "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-muted">
                        {invoice.issuedOn ?? "not issued"}
                        <span className="block text-xs text-faint">due {invoice.dueOn ?? "—"}</span>
                      </td>
                      <td className="py-2.5 pr-3 text-muted">{dollars(invoice.totalCents)}</td>
                      <td className="py-2.5 pr-3">
                        <span
                          className={cn(
                            "font-medium",
                            invoice.overdue ? "text-rose-700" : "text-foreground",
                          )}
                        >
                          {dollars(invoice.balanceCents)}
                        </span>
                        {invoice.overdue ? (
                          <span className="block text-xs text-rose-600">overdue</span>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-3">
                        <Pill tone={INVOICE_TONES[invoice.status] ?? INVOICE_TONES.draft}>
                          {invoice.status}
                        </Pill>
                        {invoice.voidReason ? (
                          <span className="block text-xs text-faint">{invoice.voidReason}</span>
                        ) : null}
                      </td>
                      <td className="py-2.5">
                        {invoice.status === "open" && invoice.balanceCents > 0 ? (
                          <button
                            type="button"
                            className="btn btn-secondary px-2.5 py-1 text-xs"
                            disabled={busyId === invoice.id}
                            onClick={() => void settle(invoice.id, invoice.balanceCents)}
                          >
                            {busyId === invoice.id ? "Recording…" : "Record payment"}
                          </button>
                        ) : (
                          <span className="text-xs text-faint">—</span>
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

      {!loading && tab === "estimates" ? (
        <Card>
          <SectionTitle
            title="Estimates"
            description="The priced proposal. Sending and deciding are the only verbs — a proposal whose numbers change after it was sent is a different proposal."
          />
          {(estimates?.estimates ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted">No estimates yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="services-estimates-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Estimate</th>
                    <th className="py-2 pr-3 font-medium">Customer</th>
                    <th className="py-2 pr-3 font-medium">Total</th>
                    <th className="py-2 pr-3 font-medium">Valid until</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 font-medium">Answer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(estimates?.estimates ?? []).slice(0, 100).map((estimate) => (
                    <tr key={estimate.id}>
                      <td className="py-2.5 pr-3">
                        <span className="block font-mono text-xs text-foreground">{estimate.number}</span>
                        <span className="block text-xs text-faint">
                          {estimate.lines.length} {estimate.lines.length === 1 ? "line" : "lines"}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-foreground">
                        {accountName.get(estimate.accountId) ?? "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-muted">{dollars(estimate.totalCents)}</td>
                      <td className="py-2.5 pr-3 text-muted">{estimate.validUntil ?? "—"}</td>
                      <td className="py-2.5 pr-3">
                        <Pill tone={ESTIMATE_TONES[estimate.status] ?? ESTIMATE_TONES.draft}>
                          {estimate.status}
                        </Pill>
                      </td>
                      <td className="py-2.5">
                        {estimate.status === "draft" || estimate.status === "sent" ? (
                          <span className="flex gap-1.5">
                            {estimate.status === "draft" ? (
                              <button
                                type="button"
                                className="btn btn-secondary px-2.5 py-1 text-xs"
                                disabled={busyId === estimate.id}
                                onClick={() => void decide(estimate.id, "sent")}
                              >
                                Send
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="btn btn-secondary px-2.5 py-1 text-xs"
                              disabled={busyId === estimate.id}
                              onClick={() => void decide(estimate.id, "accepted")}
                            >
                              Accepted
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary px-2.5 py-1 text-xs"
                              disabled={busyId === estimate.id}
                              onClick={() => void decide(estimate.id, "declined")}
                            >
                              Declined
                            </button>
                          </span>
                        ) : (
                          <span className="text-xs text-faint">
                            {estimate.decidedAt ? estimate.decidedAt.slice(0, 10) : "—"}
                          </span>
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

      {!loading && tab === "contracts" ? (
        <Card>
          <SectionTitle
            title="Contracts"
            description="What an accepted estimate became. A finished term is ended, an abandoned one cancelled; both keep the paper."
          />
          {(contracts?.contracts ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted">No contracts yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              {contracts !== null && contracts.renewingCount > 0 ? (
                <p className="mb-2 text-xs text-faint">
                  {contracts.renewingCount} {contracts.renewingCount === 1 ? "term ends" : "terms end"}{" "}
                  within 60 days.
                </p>
              ) : null}
              <table className="w-full text-left text-sm" data-testid="services-contracts-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Contract</th>
                    <th className="py-2 pr-3 font-medium">Customer</th>
                    <th className="py-2 pr-3 font-medium">Term</th>
                    <th className="py-2 pr-3 font-medium">Value</th>
                    <th className="py-2 pr-3 font-medium">Renews</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(contracts?.contracts ?? []).slice(0, 100).map((contract) => (
                    <tr key={contract.id}>
                      <td className="py-2.5 pr-3">
                        <span className="block font-mono text-xs text-foreground">{contract.number}</span>
                        <span className="block text-xs text-faint">
                          {contract.signedByName ? `signed by ${contract.signedByName}` : "unsigned"}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-foreground">
                        {accountName.get(contract.accountId) ?? "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-muted">
                        {contract.startsOn} → {contract.endsOn ?? "open"}
                      </td>
                      <td className="py-2.5 pr-3 text-muted">{dollars(contract.valueCents)}</td>
                      <td className="py-2.5 pr-3 text-muted">{contract.autoRenew ? "automatically" : "no"}</td>
                      <td className="py-2.5">
                        <Pill tone={CONTRACT_TONES[contract.status] ?? CONTRACT_TONES.ended}>
                          {contract.status}
                        </Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {!loading && tab === "ledger" ? (
        <Card>
          <SectionTitle
            title="Payments & credits"
            description="Append-only. A payment recorded in error is corrected by recording the opposite movement, exactly as a ledger is corrected by a contra entry."
          />
          {(payments?.payments ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted">No payments recorded yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="services-ledger-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Received</th>
                    <th className="py-2 pr-3 font-medium">Customer</th>
                    <th className="py-2 pr-3 font-medium">Invoice</th>
                    <th className="py-2 pr-3 font-medium">Amount</th>
                    <th className="py-2 font-medium">Method / reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(payments?.payments ?? []).slice(0, 100).map((payment) => (
                    <tr key={payment.id}>
                      <td className="py-2.5 pr-3 text-muted">{payment.receivedAt.slice(0, 10)}</td>
                      <td className="py-2.5 pr-3 text-foreground">
                        {accountName.get(payment.accountId) ?? "—"}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-xs text-muted">
                        {invoiceNumber.get(payment.invoiceId) ?? "—"}
                      </td>
                      <td className="py-2.5 pr-3 font-medium text-foreground">
                        {dollars(payment.amountCents)}
                      </td>
                      <td className="py-2.5 text-muted">
                        {payment.method}
                        {payment.reference ? (
                          <span className="block font-mono text-xs text-faint">{payment.reference}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(refunds?.refunds ?? []).length > 0 ? (
            <div className="mt-6 overflow-x-auto">
              <SectionTitle
                title="Credits"
                description="Each one capped at the payment it refunds — a trigger locks that payment and refuses the excess."
              />
              <table className="mt-3 w-full text-left text-sm" data-testid="services-refunds-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Refunded</th>
                    <th className="py-2 pr-3 font-medium">Against</th>
                    <th className="py-2 pr-3 font-medium">Amount</th>
                    <th className="py-2 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(refunds?.refunds ?? []).slice(0, 100).map((refund) => {
                    const payment = paymentById.get(refund.paymentId);
                    return (
                      <tr key={refund.id}>
                        <td className="py-2.5 pr-3 text-muted">{refund.refundedAt.slice(0, 10)}</td>
                        <td className="py-2.5 pr-3 font-mono text-xs text-muted">
                          {payment ? (invoiceNumber.get(payment.invoiceId) ?? "—") : "—"}
                        </td>
                        <td className="py-2.5 pr-3 text-foreground">{dollars(refund.amountCents)}</td>
                        <td className="py-2.5 text-muted">{refund.reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

function Figure({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: "rose" | "emerald";
}) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <dt className="flex items-center gap-2 text-xs uppercase tracking-wide text-faint">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "rose" ? "text-rose-700" : tone === "emerald" ? "text-emerald-700" : "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
