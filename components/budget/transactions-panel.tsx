"use client";

import { useCallback, useEffect, useState } from "react";
import { Receipt } from "lucide-react";

import {
  TRANSACTION_KIND_LABEL,
  type AccountView,
  type TransactionView,
} from "@/components/budget/types";
import { Card, EmptyState, SectionTitle } from "@/components/ui";
import { formatCents, parseMoneyToCents } from "@/lib/budget/money";

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
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ description: string; amount: string }>({
    description: "",
    amount: "",
  });
  const [rowMessage, setRowMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reconciliation, setReconciliation] = useState<{
    checkedCount: number;
    totalBreaks: number;
    note?: string;
    breaks: ReadonlyArray<{
      postedOn: string;
      description: string;
      computedCents: number;
      statedCents: number;
      deltaCents: number;
    }>;
  } | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [linkingFrom, setLinkingFrom] = useState<TransactionView | null>(null);

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
  async function saveRow(transaction: TransactionView) {
    const parsed = parseMoneyToCents(draft.amount);
    if (!parsed.ok) {
      setRowMessage("That amount could not be read. Try a figure like -42.50.");
      return;
    }
    setBusy(true);
    setRowMessage("");
    try {
      const response = await fetch(`/api/budget/transactions/${transaction.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: draft.description.trim(), amountCents: parsed.cents }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setRowMessage(failure?.error?.message ?? "The change could not be saved.");
        return;
      }
      setEditing(null);
      await load();
    } catch {
      setRowMessage("The change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function removeRow(transaction: TransactionView) {
    // A ledger delete is destructive and rare; one plain confirm is honest
    // friction, not ceremony.
    if (!window.confirm(`Delete "${transaction.description}" (${transaction.postedOn})? This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    setRowMessage("");
    try {
      const response = await fetch(`/api/budget/transactions/${transaction.id}`, { method: "DELETE" });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setRowMessage(failure?.error?.message ?? "The row could not be deleted.");
        return;
      }
      await load();
    } catch {
      setRowMessage("The row could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  async function linkTransfer(counterpart: TransactionView) {
    if (!linkingFrom) return;
    setBusy(true);
    setRowMessage("");
    try {
      const response = await fetch("/api/budget/transfers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firstId: linkingFrom.id, secondId: counterpart.id }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setRowMessage(failure?.error?.message ?? "The transfer could not be linked.");
        return;
      }
      setLinkingFrom(null);
      await load();
    } catch {
      setRowMessage("The transfer could not be linked.");
    } finally {
      setBusy(false);
    }
  }

  async function unlinkTransfer(transaction: TransactionView) {
    if (!transaction.transferGroupId) return;
    setBusy(true);
    setRowMessage("");
    try {
      const response = await fetch("/api/budget/transfers", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transferGroupId: transaction.transferGroupId }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setRowMessage(failure?.error?.message ?? "The link could not be removed.");
        return;
      }
      await load();
    } catch {
      setRowMessage("The link could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  /** Whether a row can be the second side of the link being built. */
  function isCounterpart(transaction: TransactionView): boolean {
    if (!linkingFrom || transaction.id === linkingFrom.id) return false;
    if (transaction.transferGroupId) return false;
    const kinds = new Set([linkingFrom.kind, transaction.kind]);
    return kinds.has("transfer_in") && kinds.has("transfer_out")
      && transaction.amountCents + linkingFrom.amountCents === 0
      && transaction.accountId !== linkingFrom.accountId;
  }

  async function runReconciliation() {
    if (!accountId) return;
    setReconciling(true);
    setReconciliation(null);
    try {
      const response = await fetch(`/api/budget/reconcile?accountId=${accountId}`, { cache: "no-store" });
      if (!response.ok) {
        setRowMessage("The reconciliation could not be run.");
        return;
      }
      setReconciliation((await response.json()) as typeof reconciliation);
    } catch {
      setRowMessage("The reconciliation could not be run.");
    } finally {
      setReconciling(false);
    }
  }

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
        <label className="min-w-0 max-w-full text-sm">
          <span className="mb-1.5 block font-medium text-foreground">Account</span>
          {/* max-w-full: a select's intrinsic width is its longest option, so
              one long account name would push the filter row past a phone
              viewport; the browser ellipsizes the value instead. */}
          <select
            value={accountId}
            onChange={(event) => {
              setOffset(0);
              setAccountId(event.target.value);
            }}
            className="w-full max-w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-foreground"
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
            {linkingFrom ? (
              <p className="mb-2 text-sm text-muted">
                Linking &ldquo;{linkingFrom.description}&rdquo; — choose its counterpart: the
                opposite transfer kind, the exact opposite amount, on a different account.
              </p>
            ) : null}
            {rowMessage ? (
              <p role="alert" className="mb-2 text-sm text-[var(--danger)]">
                {rowMessage}
              </p>
            ) : null}
            <table className="w-full min-w-[44rem] text-sm">
              <caption className="sr-only">Recorded transactions, newest first</caption>
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-faint">
                  <th scope="col" className="py-2 pr-3 font-medium">Date</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Description</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Account</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Kind</th>
                  <th scope="col" className="py-2 text-right font-medium">Amount</th>
                  <th scope="col" className="py-2 pl-3 text-right font-medium">
                    <span className="sr-only">Row actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td className="tabular py-2.5 pr-3 whitespace-nowrap text-muted">
                      {transaction.postedOn}
                    </td>
                    <td className="py-2.5 pr-3 text-foreground">
                      {editing === transaction.id ? (
                        <input
                          aria-label="Edit description"
                          className="w-full rounded border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
                          value={draft.description}
                          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                        />
                      ) : (
                        transaction.description
                      )}
                    </td>
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
                      {editing === transaction.id ? (
                        <input
                          aria-label="Edit amount"
                          className="w-24 rounded border border-[var(--border)] bg-transparent px-2 py-1 text-right text-sm"
                          value={draft.amount}
                          onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
                        />
                      ) : (
                        formatCents(transaction.amountCents, {
                          signed: transaction.amountCents > 0,
                        })
                      )}
                    </td>
                    <td className="py-2.5 pl-3 text-right whitespace-nowrap">
                      {editing === transaction.id ? (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            className="mr-2 text-sm underline disabled:opacity-50"
                            onClick={() => void saveRow(transaction)}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="text-sm text-muted underline"
                            onClick={() => setEditing(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          {transaction.kind === "transfer_out" || transaction.kind === "transfer_in" ? (
                            transaction.transferGroupId ? (
                              <button
                                type="button"
                                disabled={busy}
                                className="mr-2 text-sm text-muted underline disabled:opacity-50"
                                onClick={() => void unlinkTransfer(transaction)}
                              >
                                Unlink
                              </button>
                            ) : isCounterpart(transaction) ? (
                              <button
                                type="button"
                                disabled={busy}
                                className="mr-2 text-sm underline disabled:opacity-50"
                                onClick={() => void linkTransfer(transaction)}
                              >
                                Link here
                              </button>
                            ) : linkingFrom?.id === transaction.id ? (
                              <button
                                type="button"
                                className="mr-2 text-sm text-muted underline"
                                onClick={() => setLinkingFrom(null)}
                              >
                                Cancel link
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="mr-2 text-sm underline"
                                onClick={() => {
                                  setRowMessage("");
                                  setLinkingFrom(transaction);
                                }}
                              >
                                Link
                              </button>
                            )
                          ) : null}
                          <button
                            type="button"
                            className="mr-2 text-sm underline"
                            onClick={() => {
                              setEditing(transaction.id);
                              setRowMessage("");
                              setDraft({
                                description: transaction.description,
                                amount: (transaction.amountCents / 100).toFixed(2),
                              });
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className="text-sm text-muted underline disabled:opacity-50"
                            onClick={() => void removeRow(transaction)}
                          >
                            Delete
                          </button>
                        </>
                      )}
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

          {accountId ? (
            <section className="mt-6 border-t border-line pt-4" data-testid="budget-reconciliation">
              <h3 className="text-sm font-semibold">Reconciliation</h3>
              <p className="mt-1 text-sm text-muted">
                Walks this account&apos;s whole ledger and shows where the statement&apos;s own
                running balance stops agreeing with its amounts. Breaks are the statement&apos;s
                arithmetic, shown rather than papered over.
              </p>
              <button
                type="button"
                className="btn btn-secondary mt-2"
                disabled={reconciling}
                onClick={() => void runReconciliation()}
              >
                {reconciling ? "Checking…" : "Check this account"}
              </button>
              {reconciliation ? (
                reconciliation.note ? (
                  <p className="mt-3 text-sm text-muted">{reconciliation.note}</p>
                ) : reconciliation.totalBreaks === 0 ? (
                  <p className="mt-3 text-sm text-muted">
                    The statement agrees with itself at every one of the {reconciliation.checkedCount}{" "}
                    stated balances.
                  </p>
                ) : (
                  <>
                    <p className="mt-3 text-sm">
                      {reconciliation.totalBreaks} break
                      {reconciliation.totalBreaks === 1 ? "" : "s"} across{" "}
                      {reconciliation.checkedCount} stated balances
                      {reconciliation.breaks.length < reconciliation.totalBreaks
                        ? ` (first ${reconciliation.breaks.length} shown)`
                        : ""}
                      .
                    </p>
                    <ul className="mt-2 space-y-1 text-sm text-muted">
                      {reconciliation.breaks.map((entry, index) => (
                        <li key={index}>
                          {entry.postedOn} — {entry.description || "(no description)"}: statement says{" "}
                          {formatCents(entry.statedCents)}, the amounts say{" "}
                          {formatCents(entry.computedCents)} (off by {formatCents(entry.deltaCents)}).
                        </li>
                      ))}
                    </ul>
                  </>
                )
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </Card>
  );
}
