"use client";

import { useCallback, useEffect, useState } from "react";
import { Receipt } from "lucide-react";

import {
  TRANSACTION_KIND_LABEL,
  type AccountView,
  type TransactionView,
} from "@/components/budget/types";
import { Card, EmptyState, SectionTitle } from "@/components/ui";
import { formatCents } from "@/lib/budget/money";

/**
 * The ledger, paged.
 *
 * Filtering and paging happen in the database. A page that fetched the whole
 * ledger and filtered in the browser would work on a sample and fail on the
 * real thing, which for this product is eight thousand rows and counting.
 */

const PAGE_SIZE = 50;

export function BudgetTransactionsPanel({ accounts }: { accounts: readonly AccountView[] }) {
  const [transactions, setTransactions] = useState<readonly TransactionView[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [accountId, setAccountId] = useState("");
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (accountId) params.set("accountId", accountId);
      if (applied) params.set("search", applied);
      const response = await fetch(`/api/budget/transactions?${params}`, { cache: "no-store" });
      if (!response.ok) {
        setState("error");
        return;
      }
      const body = (await response.json()) as { transactions: TransactionView[]; total: number };
      setTransactions(body.transactions ?? []);
      setTotal(body.total ?? 0);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [accountId, applied, offset]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);

  const accountName = (id: string) => accounts.find((account) => account.id === id)?.name ?? "—";
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const page = Math.floor(offset / PAGE_SIZE);

  return (
    <Card>
      <SectionTitle
        title="Transactions"
        description={
          state === "ready"
            ? `${total.toLocaleString("en-US")} recorded`
            : "Your ledger, newest first."
        }
      />

      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          setApplied(search.trim());
        }}
      >
        <label className="text-sm">
          <span className="mb-1.5 block font-medium text-foreground">Account</span>
          <select
            value={accountId}
            onChange={(event) => {
              setOffset(0);
              setAccountId(event.target.value);
            }}
            className="rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-foreground"
          >
            <option value="">All accounts</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block font-medium text-foreground">Search</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            maxLength={120}
            placeholder="Payee or description"
            className="rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-foreground"
          />
        </label>
        <button type="submit" className="btn btn-secondary">
          Filter
        </button>
      </form>

      {state === "loading" ? (
        <div className="mt-6 h-40 animate-pulse rounded-md bg-surface-raised">
          <span className="sr-only">Loading transactions</span>
        </div>
      ) : state === "error" ? (
        <p role="alert" className="mt-6 text-sm text-[var(--danger)]">
          Transactions could not be loaded. Reload to try again.
        </p>
      ) : transactions.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Nothing here"
            description={
              applied || accountId
                ? "No transactions match that filter."
                : "Import a statement or add a transaction and it will appear here."
            }
            icon={Receipt}
          />
        </div>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <caption className="sr-only">Recorded transactions, newest first</caption>
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-faint">
                  <th scope="col" className="py-2 pr-3 font-medium">Date</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Description</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Account</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Kind</th>
                  <th scope="col" className="py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td className="tabular py-2.5 pr-3 whitespace-nowrap text-muted">
                      {transaction.postedOn}
                    </td>
                    <td className="py-2.5 pr-3 text-foreground">{transaction.description}</td>
                    <td className="py-2.5 pr-3 text-muted">{accountName(transaction.accountId)}</td>
                    <td className="py-2.5 pr-3 text-muted">
                      {TRANSACTION_KIND_LABEL[transaction.kind] ?? transaction.kind}
                    </td>
                    <td
                      className={
                        transaction.amountCents >= 0
                          ? "tabular py-2.5 text-right font-medium text-[var(--accent)]"
                          : "tabular py-2.5 text-right font-medium text-foreground"
                      }
                    >
                      {formatCents(transaction.amountCents, {
                        signed: transaction.amountCents > 0,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav
            className="mt-4 flex items-center justify-between gap-3"
            aria-label="Transaction pages"
          >
            <button
              type="button"
              className="btn btn-secondary"
              disabled={page === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </button>
            <span className="tabular text-sm text-muted">
              Page {page + 1} of {lastPage + 1}
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={page >= lastPage}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </button>
          </nav>
        </>
      )}
    </Card>
  );
}
