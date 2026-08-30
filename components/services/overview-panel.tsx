"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  Building2,
  Sparkles,
  Target,
  TrendingUp,
  UserCheck,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

import { Card, DemoNotice, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { DEMO_SOURCE } from "@/lib/services/demo-data";
import {
  AccountAvatar,
  AccountStatusBadge,
  STAGE_TONES,
  dollars,
} from "@/components/services/ui";
import { cn } from "@/lib/cn";
import type {
  AccountView,
  AccountsPayload,
  OpportunitiesPayload,
} from "@/components/services/types";

/**
 * The book of business at a glance: live counts by lifecycle and kind, the
 * pipeline's headline numbers with its stage distribution, and the accounts
 * that changed most recently. Every number is counted from the same reads
 * the Customers and Pipeline pages render — nothing here is a second number
 * that can drift from the first, and an empty workspace says exactly what
 * to do next instead of dressing itself in zeros. An empty workspace can
 * also seed the clearly-labeled Demo Data book — real rows through the same
 * live path, every record marked "Demo Data" in its source.
 */
export function ServicesOverviewPanel() {
  const [payload, setPayload] = useState<AccountsPayload | null>(null);
  const [pipeline, setPipeline] = useState<OpportunitiesPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [accountsResponse, pipelineResponse] = await Promise.all([
        fetch("/api/services/accounts", { headers: { accept: "application/json" } }),
        fetch("/api/services/opportunities", { headers: { accept: "application/json" } }),
      ]);
      const accountsBody = (await accountsResponse.json()) as AccountsPayload & {
        error?: { message?: string };
      };
      if (!accountsResponse.ok) {
        setError(accountsBody.error?.message ?? "The book of business could not be read.");
        return;
      }
      setError(null);
      setPayload(accountsBody);
      if (pipelineResponse.ok) {
        setPipeline((await pipelineResponse.json()) as OpportunitiesPayload);
      }
    } catch {
      setError("The book of business could not be read.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  const loadDemoData = useCallback(async () => {
    setSeeding(true);
    setSeedError(null);
    try {
      const response = await fetch("/api/services/demo-seed", { method: "POST" });
      const body = (await response.json()) as {
        seeded?: { accounts: number; timelineEvents: number };
        error?: { message?: string };
      };
      if (!response.ok || !body.seeded) {
        setSeedError(body.error?.message ?? "The demo data could not be seeded.");
        return;
      }
      setSeeded(
        `Demo Data loaded: ${body.seeded.accounts} accounts with contacts, properties, deals and ${body.seeded.timelineEvents} timeline entries — every record marked "Demo Data".`,
      );
      void refresh();
    } catch {
      setSeedError("The request did not reach the server.");
    } finally {
      setSeeding(false);
    }
  }, [refresh]);

  const counts = payload?.counts ?? null;
  const report = pipeline?.report ?? null;
  const hasDemoData = (payload?.accounts ?? []).some((account) => account.source === DEMO_SOURCE);

  return (
    <div>
      <PageHeader
        title="Services"
        description="The pest-services CRM: leads, customers, properties, the sales pipeline, and the immutable history of everything that happened on each account."
      />

      {error !== null ? <Notice tone="warning">{error}</Notice> : null}
      {hasDemoData ? (
        <DemoNotice>
          This workspace holds the seeded demonstration book: every seeded record carries the
          source &ldquo;Demo Data&rdquo;, with fictional companies, reserved .example email
          domains and 555 phone numbers.
        </DemoNotice>
      ) : null}
      {seeded !== null ? <Notice tone="info">{seeded}</Notice> : null}

      {counts !== null ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Leads"
            value={counts.byStatus.lead ?? 0}
            icon={UserPlus}
            iconTone="bg-amber-100 text-amber-700"
            detail="Waiting on first contact"
          />
          <StatCard
            label="Prospects"
            value={counts.byStatus.prospect ?? 0}
            icon={Target}
            iconTone="bg-sky-100 text-sky-700"
            detail="In active conversation"
          />
          <StatCard
            label="Customers"
            value={counts.byStatus.customer ?? 0}
            icon={UserCheck}
            iconTone="bg-emerald-100 text-emerald-700"
            detail="Under service"
          />
          <StatCard
            label="Commercial accounts"
            value={counts.byKind.commercial ?? 0}
            icon={Building2}
            iconTone="bg-violet-100 text-violet-700"
            detail={`${counts.byKind.residential ?? 0} residential`}
          />
        </div>
      ) : error === null ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="h-28 animate-pulse">
              <span className="sr-only">Loading counts</span>
            </Card>
          ))}
        </div>
      ) : null}

      {report !== null ? (
        <Card className="mt-6">
          <SectionTitle
            title="Pipeline"
            description="The sales motion, from the same read the Pipeline board renders."
            action={
              <Link href="/Services/pipeline" className="btn btn-secondary px-3 py-1.5 text-sm">
                Work the board
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            }
          />
          <dl className="mt-4 grid gap-4 sm:grid-cols-3" data-testid="services-overview-pipeline">
            <div className="rounded-lg bg-surface-raised p-4">
              <dt className="flex items-center gap-2 text-sm text-muted">
                <TrendingUp className="size-4 text-[var(--accent)]" aria-hidden="true" />
                Open pipeline
              </dt>
              <dd className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
                {dollars(report.openValueCents)}
              </dd>
              <dd className="mt-1 text-xs text-faint">
                {report.openCount} open {report.openCount === 1 ? "opportunity" : "opportunities"}
              </dd>
            </div>
            <div className="rounded-lg bg-surface-raised p-4">
              <dt className="text-sm text-muted">Won</dt>
              <dd className="mt-1 text-2xl font-semibold tracking-tight text-emerald-700">
                {dollars(report.wonValueCents)}
              </dd>
              <dd className="mt-1 text-xs text-faint">{report.wonCount} closed won</dd>
            </div>
            <div className="rounded-lg bg-surface-raised p-4">
              <dt className="text-sm text-muted">Win rate</dt>
              <dd className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
                {report.winRatePercent === null ? "—" : `${report.winRatePercent}%`}
              </dd>
              <dd className="mt-1 text-xs text-faint">
                {report.winRatePercent === null
                  ? "No closed deals yet"
                  : `Over ${report.wonCount + report.lostCount} closed deals`}
              </dd>
            </div>
          </dl>
          <StageDistribution byStage={report.byStage} />
        </Card>
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
            <div className="mt-4 space-y-4">
              <p className="text-sm text-muted">
                No accounts yet. Start the book of business by recording your first lead
                on the{" "}
                <Link href="/Services/customers" className="underline underline-offset-2">
                  Customers &amp; Leads
                </Link>{" "}
                page — the form there creates a real account in this workspace.
              </p>
              <div
                className="rounded-xl border border-dashed border-[var(--accent-border)] bg-[var(--accent-surface)] p-5"
                data-testid="services-demo-seed"
              >
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Sparkles className="size-4 text-[var(--accent)]" aria-hidden="true" />
                  Or load Demo Data
                </p>
                <p className="mt-1.5 text-sm text-muted">
                  Seeds this workspace with a fictional pest-services clientele — commercial and
                  residential accounts, contacts, properties, deals across every stage, and months
                  of history. Every record is created through the same live path as a real one and
                  carries the source label &ldquo;Demo Data&rdquo;; emails and phone numbers are
                  reserved fictional ranges. It loads only into an empty workspace.
                </p>
                <button
                  type="button"
                  onClick={() => void loadDemoData()}
                  disabled={seeding}
                  className="btn btn-primary mt-3 px-3 py-2 text-sm"
                >
                  {seeding ? "Seeding…" : "Load Demo Data"}
                </button>
                {seedError !== null ? (
                  <div className="mt-3">
                    <Notice tone="warning">{seedError}</Notice>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {payload.accounts.slice(0, 8).map((account) => (
                <li key={account.id} className="py-2">
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

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  iconTone,
}: {
  label: string;
  value: number;
  detail?: string;
  icon: LucideIcon;
  iconTone: string;
}) {
  return (
    <Card className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm text-muted">{label}</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
        {detail ? <p className="mt-1 text-xs text-faint">{detail}</p> : null}
      </div>
      <span
        className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", iconTone)}
        aria-hidden="true"
      >
        <Icon className="size-5" />
      </span>
    </Card>
  );
}

/**
 * One horizontal bar, split by stage, so the board's shape is readable
 * before opening it. Rendered only when something is on the board.
 */
function StageDistribution({
  byStage,
}: {
  byStage: Record<string, { count: number; valueCents: number }>;
}) {
  const stages = ["new", "contacted", "inspection", "proposal", "negotiation", "won", "lost"];
  const total = stages.reduce((sum, stage) => sum + (byStage[stage]?.count ?? 0), 0);
  if (total === 0) return null;
  return (
    <div className="mt-4">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-raised">
        {stages.map((stage) => {
          const count = byStage[stage]?.count ?? 0;
          if (count === 0) return null;
          return (
            <span
              key={stage}
              className={(STAGE_TONES[stage] ?? STAGE_TONES.new).bar}
              style={{ width: `${(count / total) * 100}%` }}
              title={`${stage}: ${count}`}
            />
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {stages.map((stage) => {
          const count = byStage[stage]?.count ?? 0;
          if (count === 0) return null;
          return (
            <span key={stage} className="flex items-center gap-1.5 text-xs text-muted">
              <span
                className={cn("size-2 rounded-full", (STAGE_TONES[stage] ?? STAGE_TONES.new).bar)}
                aria-hidden="true"
              />
              <span className="capitalize">{stage}</span> {count}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function RecentRow({ account }: { account: AccountView }) {
  return (
    <Link
      href={`/Services/customers/${account.id}`}
      className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-raised"
    >
      <AccountAvatar name={account.name} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{account.name}</span>
        <span className="block text-xs capitalize text-faint">{account.kind}</span>
      </span>
      <AccountStatusBadge status={account.status} />
    </Link>
  );
}
