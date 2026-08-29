"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { BudgetAccountsPanel } from "@/components/budget/accounts-panel";
import { BudgetBillsPanel } from "@/components/budget/bills-panel";
import { BudgetImportPanel } from "@/components/budget/import-panel";
import { BudgetOverviewPanel } from "@/components/budget/overview-panel";
import { BudgetTransactionsPanel } from "@/components/budget/transactions-panel";
import type { BudgetOverview } from "@/components/budget/types";
import { Card, PageHeader } from "@/components/ui";
import type { PayoffStrategy } from "@/lib/budget/analytics";
import { cn } from "@/lib/cn";

/**
 * The Budget Tracker.
 *
 * The page above this is gated server-side, so this renders for signed-in
 * people only. Every read and write below still passes through row-level
 * security that scopes rows to the person — not to the organization — so a
 * colleague, including an administrator, sees none of it.
 *
 * The page heading is rendered by `framed` in every state, including the
 * failed and empty ones. A blocked state that replaces the whole page removes
 * its `h1` along with everything else, which breaks the document outline
 * exactly when a person most needs to know where they are.
 */

const PAGE_DESCRIPTION =
  "Your accounts, bills and ledger in one place — every figure computed from rows you own.";

export type BudgetSection = "overview" | "accounts" | "transactions" | "bills" | "import";

const SECTIONS: ReadonlyArray<{ key: BudgetSection; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "accounts", label: "Accounts" },
  { key: "transactions", label: "Transactions" },
  { key: "bills", label: "Bills & Debt" },
  { key: "import", label: "Import" },
];

type State = "loading" | "ready" | "error" | "onboarding";

const EMPTY: BudgetOverview = {
  accounts: [],
  obligations: [],
  flows: [],
  recent: [],
  imports: [],
};

export function BudgetTrackerConsole() {
  const [section, setSection] = useState<BudgetSection>("overview");
  const [state, setState] = useState<State>("loading");
  const [data, setData] = useState<BudgetOverview>(EMPTY);
  const [strategy, setStrategy] = useState<PayoffStrategy>("avalanche");
  const [message, setMessage] = useState("");

  /*
   * Fixed once per mount rather than read at render time. `upcomingBills`
   * takes today as an argument so "due in three days" cannot change between
   * two renders of the same list, and so the tests can state a date.
   */
  const today = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/budget/overview", { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 409) {
          const body = (await response.json().catch(() => null)) as
            | { error?: { code?: string } }
            | null;
          if (body?.error?.code === "organization_onboarding_required") {
            setState("onboarding");
            return;
          }
        }
        setState("error");
        setMessage("Your budget could not be loaded. Reload to try again.");
        return;
      }
      const body = (await response.json()) as Partial<BudgetOverview>;
      setData({
        accounts: body.accounts ?? [],
        obligations: body.obligations ?? [],
        flows: body.flows ?? [],
        recent: body.recent ?? [],
        imports: body.imports ?? [],
      });
      setState("ready");
    } catch {
      setState("error");
      setMessage("Your budget could not be loaded. Reload to try again.");
    }
  }, []);

  useEffect(() => {
    // Deferred a tick, matching the other consoles: neither the lint rule nor
    // React wants state set synchronously in the effect body.
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);

  const framed = (children: React.ReactNode) => (
    <div className="space-y-6">
      <PageHeader title="Budget Tracker" description={PAGE_DESCRIPTION} />
      <nav aria-label="Budget Tracker sections" className="flex flex-wrap gap-1.5">
        {SECTIONS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setSection(entry.key)}
            aria-current={section === entry.key ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm",
              section === entry.key
                ? "border-[var(--accent)] bg-[var(--accent-soft)] font-medium text-foreground"
                : "border-line-strong text-muted hover:text-foreground",
            )}
          >
            {entry.label}
          </button>
        ))}
      </nav>
      {children}
    </div>
  );

  if (state === "loading") {
    return framed(
      <Card className="min-h-64 animate-pulse">
        <span className="sr-only">Loading your budget</span>
      </Card>,
    );
  }

  if (state === "onboarding") {
    return framed(
      <Card>
        <p className="text-sm text-muted">
          The Budget Tracker stores your finances inside a workspace, and you do not have one yet.
          Create yours and you will land right back here.
        </p>
      </Card>,
    );
  }

  if (state === "error") {
    return framed(
      <Card>
        <p role="alert" className="text-sm text-[var(--danger)]">
          {message}
        </p>
      </Card>,
    );
  }

  return framed(
    <>
      {section === "overview" ? (
        <BudgetOverviewPanel
          data={data}
          today={today}
          strategy={strategy}
          onStrategyChange={setStrategy}
        />
      ) : null}
      {section === "accounts" ? (
        <BudgetAccountsPanel accounts={data.accounts} onAdded={() => void load()} />
      ) : null}
      {section === "transactions" ? <BudgetTransactionsPanel accounts={data.accounts} /> : null}
      {section === "bills" ? (
        <BudgetBillsPanel
          obligations={data.obligations}
          accounts={data.accounts}
          onChanged={() => void load()}
        />
      ) : null}
      {section === "import" ? (
        <BudgetImportPanel
          accounts={data.accounts}
          imports={data.imports}
          onImported={() => void load()}
        />
      ) : null}
    </>,
  );
}
