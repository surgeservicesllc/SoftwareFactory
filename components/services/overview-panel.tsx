"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import type { AccountView, AccountsPayload } from "@/components/services/types";

/**
 * The book of business at a glance: live counts by lifecycle and kind, and
 * the accounts that changed most recently. Every number is counted from the
 * same read the Customers page renders — nothing here is a second number
 * that can drift from the first, and an empty workspace says exactly what
 * to do next instead of dressing itself in zeros.
 */
export function ServicesOverviewPanel() {
  const [payload, setPayload] = useState<AccountsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const kickoff = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch("/api/services/accounts", {
            headers: { accept: "application/json" },
          });
          const body = (await response.json()) as AccountsPayload & {
            error?: { message?: string };
          };
          if (!active) return;
          if (!response.ok) {
            setError(body.error?.message ?? "The book of business could not be read.");
            return;
          }
          setPayload(body);
        } catch {
          if (active) setError("The book of business could not be read.");
        }
      })();
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(kickoff);
    };
  }, []);

  const counts = payload?.counts ?? null;

  return (
    <div>
      <PageHeader
        title="Services"
        description="The pest-services CRM: leads, customers, properties and the immutable history of everything that happened on each account."
      />

      {error !== null ? <Notice tone="warning">{error}</Notice> : null}

      {counts !== null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Leads" value={counts.byStatus.lead ?? 0} />
          <StatCard label="Prospects" value={counts.byStatus.prospect ?? 0} />
          <StatCard label="Customers" value={counts.byStatus.customer ?? 0} />
          <StatCard
            label="Commercial accounts"
            value={counts.byKind.commercial ?? 0}
            detail={`${counts.byKind.residential ?? 0} residential`}
          />
        </div>
      ) : error === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="h-24 animate-pulse">
              <span className="sr-only">Loading counts</span>
            </Card>
          ))}
        </div>
      ) : null}

      {payload !== null ? (
        <Card className="mt-6">
          <SectionTitle
            title="Recently active"
            description="The accounts whose records changed last."
            action={
              <Link href="/Services/customers" className="btn btn-secondary px-3 py-1.5 text-sm">
                All customers & leads
              </Link>
            }
          />
          {payload.accounts.length === 0 ? (
            <p className="mt-4 text-sm text-muted">
              No accounts yet. Start the book of business by recording your first lead
              on the{" "}
              <Link href="/Services/customers" className="underline underline-offset-2">
                Customers &amp; Leads
              </Link>{" "}
              page — the form there creates a real account in this workspace.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {payload.accounts.slice(0, 8).map((account) => (
                <li key={account.id} className="py-2.5">
                  <RecentRow account={account} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function StatCard({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <Card>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      {detail ? <p className="mt-1 text-xs text-faint">{detail}</p> : null}
    </Card>
  );
}

function RecentRow({ account }: { account: AccountView }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <Link
        href={`/Services/customers/${account.id}`}
        className="min-w-0 break-words font-medium underline-offset-2 hover:underline"
      >
        {account.name}
      </Link>
      <span className="shrink-0 text-xs text-muted">
        {account.kind} · {account.status}
      </span>
    </div>
  );
}
