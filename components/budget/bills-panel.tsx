"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";

import {
  OBLIGATION_STATUS_LABEL,
  type AccountView,
  type ObligationView,
} from "@/components/budget/types";
import { Card, EmptyState, SectionTitle } from "@/components/ui";
import { monthlyInterestCents } from "@/lib/budget/analytics";
import { formatBps, formatCents, parseMoneyToCents } from "@/lib/budget/money";

/** Recurring obligations: what is owed, when, and what carrying it costs. */

const STATUSES = ["scheduled", "paid", "repeats_monthly", "overdue", "closed"] as const;

export function BudgetBillsPanel({
  obligations,
  accounts,
  onChanged,
}: {
  obligations: readonly ObligationView[];
  accounts: readonly AccountView[];
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [dueDay, setDueDay] = useState("1");
  const [amount, setAmount] = useState("");
  const [balance, setBalance] = useState("");
  const [apr, setApr] = useState("");
  const [accountId, setAccountId] = useState("");
  const [paidFrom, setPaidFrom] = useState("");
  const [ownerLabel, setOwnerLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");

    const parsedAmount = amount.trim() === "" ? { ok: true as const, cents: 0 } : parseMoneyToCents(amount);
    if (!parsedAmount.ok) {
      setMessage("That payment amount could not be read.");
      return;
    }
    let balanceCents: number | null = null;
    if (balance.trim() !== "") {
      const parsedBalance = parseMoneyToCents(balance);
      if (!parsedBalance.ok) {
        setMessage("That balance could not be read.");
        return;
      }
      balanceCents = Math.abs(parsedBalance.cents);
    }
    const aprBps = apr.trim() === "" ? null : Math.round(Number(apr) * 100);
    if (aprBps !== null && (!Number.isFinite(aprBps) || aprBps < 0 || aprBps > 100_000)) {
      setMessage("That rate could not be read.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/budget/obligations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          dueDay: Number(dueDay),
          amountCents: Math.abs(parsedAmount.cents),
          balanceCents,
          aprBps,
          accountId: accountId === "" ? null : accountId,
          paidFrom: paidFrom.trim() === "" ? null : paidFrom.trim(),
          ownerLabel: ownerLabel.trim() === "" ? null : ownerLabel.trim(),
          status: "scheduled",
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setMessage(body?.error?.message ?? "The obligation could not be added.");
        return;
      }
      setName("");
      setAmount("");
      setBalance("");
      setApr("");
      setPaidFrom("");
      setOwnerLabel("");
      setMessage("Obligation added.");
      onChanged();
    } catch {
      setMessage("The obligation could not be added.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: string) {
    try {
      const response = await fetch("/api/budget/obligations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (response.ok) onChanged();
    } catch {
      // The list is re-read on change; a failed patch simply leaves it as it was.
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle
          title="Recurring obligations"
          description="The bill schedule: what is due, when, and what carrying the balance costs each month."
        />
        {obligations.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No obligations recorded"
              description="Add the bills that repeat — cards, loans, utilities — and the dashboard can tell you what is due next."
              icon={CalendarClock}
            />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <caption className="sr-only">Recurring obligations by due day</caption>
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-faint">
                  <th scope="col" className="py-2 pr-3 font-medium">Due</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Obligation</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Payment</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Balance</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Rate</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Interest / mo.</th>
                  <th scope="col" className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {obligations.map((obligation) => (
                  <tr key={obligation.id}>
                    <td className="tabular py-2.5 pr-3 whitespace-nowrap text-muted">
                      {ordinal(obligation.dueDay)}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className="font-medium text-foreground">{obligation.name}</span>
                      <p className="text-xs text-faint">
                        {[
                          obligation.paidFrom ? `paid from ${obligation.paidFrom}` : null,
                          obligation.ownerLabel,
                          obligation.autopay ? "autopay" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </td>
                    <td className="tabular py-2.5 pr-3 text-right text-foreground">
                      {formatCents(obligation.amountCents)}
                    </td>
                    <td className="tabular py-2.5 pr-3 text-right text-muted">
                      {formatCents(obligation.balanceCents)}
                    </td>
                    <td className="tabular py-2.5 pr-3 text-right text-muted">
                      {formatBps(obligation.aprBps)}
                    </td>
                    <td className="tabular py-2.5 pr-3 text-right text-muted">
                      {formatCents(monthlyInterestCents(obligation.balanceCents, obligation.aprBps))}
                    </td>
                    <td className="py-2.5">
                      <label className="sr-only" htmlFor={`status-${obligation.id}`}>
                        Status for {obligation.name}
                      </label>
                      <select
                        id={`status-${obligation.id}`}
                        value={obligation.status}
                        onChange={(event) => void setStatus(obligation.id, event.target.value)}
                        className="rounded-md border border-line-strong bg-surface-raised px-2 py-1 text-xs text-foreground"
                      >
                        {STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {OBLIGATION_STATUS_LABEL[status]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle title="Add an obligation" />
        <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-foreground">Name</span>
            <input
              required
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-foreground"
              placeholder="Car payment"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-foreground">Due day</span>
            <select
              value={dueDay}
              onChange={(event) => setDueDay(event.target.value)}
              className="w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-foreground"
            >
              {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                <option key={day} value={day}>
                  {ordinal(day)}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-faint">
              A 31st due day lands on the last day of shorter months.
            </span>
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-foreground">Payment</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-foreground"
              placeholder="250.00"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-foreground">Balance owed</span>
            <input
              inputMode="decimal"
              value={balance}
              onChange={(event) => setBalance(event.target.value)}
              className="w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-foreground"
              placeholder="12500.00"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-foreground">Rate (APR %)</span>
            <input
              inputMode="decimal"
              value={apr}
              onChange={(event) => setApr(event.target.value)}
              className="w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-foreground"
              placeholder="18.99"
            />
            <span className="mt-1 block text-xs text-faint">
              Left blank, this debt sorts last under the highest-rate order rather than first.
            </span>
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-foreground">Account</span>
            <select
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              className="w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-foreground"
            >
              <option value="">Not linked</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-foreground">Paid from</span>
            <input
              maxLength={160}
              value={paidFrom}
              onChange={(event) => setPaidFrom(event.target.value)}
              className="w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-foreground"
              placeholder="Optional"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-foreground">Whose</span>
            <input
              maxLength={80}
              value={ownerLabel}
              onChange={(event) => setOwnerLabel(event.target.value)}
              className="w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-foreground"
              placeholder="Optional"
            />
          </label>
          <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-3">
            <button type="submit" disabled={busy} className="btn btn-primary">
              {busy ? "Adding…" : "Add obligation"}
            </button>
            {message ? (
              <p role="status" className="text-sm text-muted">
                {message}
              </p>
            ) : null}
          </div>
        </form>
      </Card>
    </div>
  );
}

function ordinal(day: number): string {
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";
  return `${day}${suffix}`;
}
