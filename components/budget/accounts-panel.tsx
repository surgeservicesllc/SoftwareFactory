"use client";

import { useState } from "react";
import { Landmark } from "lucide-react";

import { UtilizationBar } from "@/components/budget/charts";
import { ACCOUNT_KIND_LABEL, type AccountView } from "@/components/budget/types";
import { Card, EmptyState, SectionTitle } from "@/components/ui";
import { utilizationPercent } from "@/lib/budget/analytics";
import { formatBps, formatCents, parseMoneyToCents } from "@/lib/budget/money";

/** Accounts, and the form that adds one. */

const KINDS = [
  "checking",
  "savings",
  "credit_card",
  "loan",
  "mortgage",
  "brokerage",
  "other",
] as const;

export function BudgetAccountsPanel({
  accounts,
  onAdded,
}: {
  accounts: readonly AccountView[];
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("checking");
  const [balance, setBalance] = useState("");
  const [limit, setLimit] = useState("");
  const [apr, setApr] = useState("");
  const [last4, setLast4] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");

    const parsedBalance = balance.trim() === "" ? { ok: true as const, cents: 0 } : parseMoneyToCents(balance);
    if (!parsedBalance.ok) {
      setMessage("That balance could not be read. Try a figure like 1234.56.");
      return;
    }
    let creditLimitCents: number | null = null;
    if (limit.trim() !== "") {
      const parsedLimit = parseMoneyToCents(limit);
      if (!parsedLimit.ok) {
        setMessage("That credit limit could not be read.");
        return;
      }
      creditLimitCents = Math.abs(parsedLimit.cents);
    }
    if (creditLimitCents !== null && kind !== "credit_card") {
      setMessage("A credit limit belongs to a credit card. Utilization means nothing without one.");
      return;
    }
    const aprBps = apr.trim() === "" ? null : Math.round(Number(apr) * 100);
    if (aprBps !== null && (!Number.isFinite(aprBps) || aprBps < 0 || aprBps > 100_000)) {
      setMessage("That rate could not be read. Try a figure like 18.99.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/budget/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          institution: institution.trim() === "" ? null : institution.trim(),
          kind,
          last4: last4.trim() === "" ? null : last4.trim(),
          currentBalanceCents: parsedBalance.cents,
          creditLimitCents,
          aprBps,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setMessage(body?.error?.message ?? "The account could not be added.");
        return;
      }
      setName("");
      setInstitution("");
      setBalance("");
      setLimit("");
      setApr("");
      setLast4("");
      setMessage("Account added.");
      onAdded();
    } catch {
      setMessage("The account could not be added.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle
          title="Accounts"
          description="What your money sits in, and what it is owed on."
        />
        {accounts.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No accounts yet"
              description="Add one below. Balances are what you record — this product has no bank connection."
              icon={Landmark}
            />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <caption className="sr-only">Your recorded accounts</caption>
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-faint">
                  <th scope="col" className="py-2 pr-3 font-medium">Account</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Kind</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Balance</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Rate</th>
                  <th scope="col" className="py-2 font-medium">Credit used</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td className="py-3 pr-3">
                      <span className="font-medium text-foreground">{account.name}</span>
                      {account.last4 ? (
                        <span className="ml-1.5 text-xs text-faint">••{account.last4}</span>
                      ) : null}
                      {account.institution ? (
                        <p className="text-xs text-faint">{account.institution}</p>
                      ) : null}
                    </td>
                    <td className="py-3 pr-3 text-muted">
                      {ACCOUNT_KIND_LABEL[account.kind] ?? account.kind}
                    </td>
                    <td className="tabular py-3 pr-3 text-right text-foreground">
                      {formatCents(account.currentBalanceCents)}
                    </td>
                    <td className="tabular py-3 pr-3 text-right text-muted">
                      {formatBps(account.aprBps)}
                      {account.promoAprEndsOn ? (
                        <p className="text-xs text-[var(--warning)]">
                          promo ends {account.promoAprEndsOn}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-3 min-w-40">
                      <UtilizationBar
                        percent={utilizationPercent({
                          id: account.id,
                          name: account.name,
                          kind: account.kind,
                          currentBalanceCents: account.currentBalanceCents,
                          creditLimitCents: account.creditLimitCents,
                        })}
                        label={account.name}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle title="Add an account" />
        <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-foreground">Name</span>
            <input
              required
              maxLength={160}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-foreground"
              placeholder="Everyday checking"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-foreground">Institution</span>
            <input
              maxLength={160}
              value={institution}
              onChange={(event) => setInstitution(event.target.value)}
              className="w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-foreground"
              placeholder="Optional"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-foreground">Kind</span>
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as (typeof KINDS)[number])}
              className="w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-foreground"
            >
              {KINDS.map((option) => (
                <option key={option} value={option}>
                  {ACCOUNT_KIND_LABEL[option]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-foreground">Current balance</span>
            <input
              inputMode="decimal"
              value={balance}
              onChange={(event) => setBalance(event.target.value)}
              className="w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-foreground"
              placeholder="0.00"
            />
            <span className="mt-1 block text-xs text-faint">
              Money owed is negative — a card balance of $3,200.00 is -3200.00.
            </span>
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-foreground">Credit limit</span>
            <input
              inputMode="decimal"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              disabled={kind !== "credit_card"}
              className="w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-foreground disabled:opacity-50"
              placeholder={kind === "credit_card" ? "5000" : "Credit cards only"}
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
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-foreground">Last four digits</span>
            <input
              inputMode="numeric"
              maxLength={4}
              value={last4}
              onChange={(event) => setLast4(event.target.value.replace(/\D/g, ""))}
              className="w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-foreground"
              placeholder="4321"
            />
            <span className="mt-1 block text-xs text-faint">
              Four digits, to tell two cards apart. Never enter a full number — there is nowhere to
              store one.
            </span>
          </label>
          <div className="flex items-end gap-3 sm:col-span-2">
            <button type="submit" disabled={busy} className="btn btn-primary">
              {busy ? "Adding…" : "Add account"}
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
