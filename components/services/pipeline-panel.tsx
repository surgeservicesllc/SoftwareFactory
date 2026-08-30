"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, TrendingUp, Trophy, XCircle } from "lucide-react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { AccountAvatar, STAGE_TONES, dollars } from "@/components/services/ui";
import { cn } from "@/lib/cn";
import type {
  AccountsPayload,
  OpportunitiesPayload,
  OpportunityView,
} from "@/components/services/types";

/**
 * The pipeline: every opportunity in this workspace, staged from first
 * contact to won or lost, over a report computed from the same table the
 * board renders. A stage move is a real PATCH; the database writes the move
 * onto the account's timeline and the board re-reads rather than inventing
 * the new state. Marking a deal lost asks for the reason first — the one
 * moment the "why" is still fresh.
 */

const STAGES = ["new", "contacted", "inspection", "proposal", "negotiation", "won", "lost"] as const;
const STAGE_LABELS: Record<(typeof STAGES)[number], string> = {
  new: "New",
  contacted: "Contacted",
  inspection: "Inspection",
  proposal: "Proposal",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};

export function ServicesPipelinePanel() {
  const [payload, setPayload] = useState<OpportunitiesPayload | null>(null);
  const [accounts, setAccounts] = useState<AccountsPayload | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [name, setName] = useState("");
  const [valueDollars, setValueDollars] = useState("");
  const [expectedClose, setExpectedClose] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const [pendingLost, setPendingLost] = useState<{ id: string; reason: string } | null>(null);
  const [actError, setActError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [pipelineResponse, accountsResponse] = await Promise.all([
        fetch("/api/services/opportunities", { headers: { accept: "application/json" } }),
        fetch("/api/services/accounts", { headers: { accept: "application/json" } }),
      ]);
      const pipelineBody = (await pipelineResponse.json()) as OpportunitiesPayload & {
        error?: { message?: string };
      };
      if (!pipelineResponse.ok) {
        setListError(pipelineBody.error?.message ?? "The pipeline could not be listed.");
        return;
      }
      setListError(null);
      setPayload(pipelineBody);
      if (accountsResponse.ok) {
        setAccounts((await accountsResponse.json()) as AccountsPayload);
      }
    } catch {
      setListError("The pipeline could not be listed.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  const create = useCallback(async () => {
    setCreating(true);
    setCreateError(null);
    setCreated(null);
    try {
      const parsedValue = valueDollars.trim() === "" ? null : Number(valueDollars);
      if (parsedValue !== null && (!Number.isFinite(parsedValue) || parsedValue < 0)) {
        setCreateError("Value must be a dollar amount.");
        return;
      }
      const response = await fetch("/api/services/opportunities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId,
          name: name.trim(),
          ...(parsedValue !== null ? { valueCents: Math.round(parsedValue * 100) } : {}),
          ...(expectedClose !== "" ? { expectedCloseDate: expectedClose } : {}),
        }),
      });
      const body = (await response.json()) as {
        opportunity?: { name: string };
        error?: { message?: string };
      };
      if (!response.ok || !body.opportunity) {
        setCreateError(body.error?.message ?? "The opportunity could not be recorded.");
        return;
      }
      setCreated(`${body.opportunity.name} is on the board, stage: new.`);
      setName("");
      setValueDollars("");
      setExpectedClose("");
      void refresh();
    } catch {
      setCreateError("The request did not reach the server.");
    } finally {
      setCreating(false);
    }
  }, [accountId, name, valueDollars, expectedClose, refresh]);

  const move = useCallback(
    async (opportunityId: string, changes: Record<string, unknown>) => {
      setActError(null);
      try {
        const response = await fetch(`/api/services/opportunities/${opportunityId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(changes),
        });
        if (!response.ok) {
          const body = (await response.json()) as { error?: { message?: string } };
          setActError(body.error?.message ?? "The move could not be recorded.");
          return;
        }
        setPendingLost(null);
        void refresh();
      } catch {
        setActError("The request did not reach the server.");
      }
    },
    [refresh],
  );

  const accountNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of accounts?.accounts ?? []) map.set(account.id, account.name);
    return map;
  }, [accounts]);

  const byStage = useMemo(() => {
    const groups = new Map<string, OpportunityView[]>();
    for (const stage of STAGES) groups.set(stage, []);
    for (const opportunity of payload?.opportunities ?? []) {
      (groups.get(opportunity.stage) ?? groups.get("new"))?.push(opportunity);
    }
    return groups;
  }, [payload]);

  const report = payload?.report ?? null;
  const opportunities = payload?.opportunities ?? null;

  return (
    <div>
      <PageHeader
        title="Pipeline"
        description="Every opportunity in this workspace, from first contact to won or lost. Stage moves land on the account's timeline, written by the database."
        action={
          <button
            type="button"
            onClick={() => setShowForm((current) => !current)}
            className="btn btn-primary px-3 py-2 text-sm"
          >
            {showForm ? "Close" : "New opportunity"}
          </button>
        }
      />

      {showForm ? (
        <Card className="mb-6">
          <SectionTitle
            title="Record a new opportunity"
            description="A deal on one account, starting in stage new. Won and lost are moves, never starting points."
          />
          {accounts !== null && accounts.accounts.length === 0 ? (
            <p className="mt-4 text-sm text-muted">
              An opportunity belongs to an account. Record the account first under{" "}
              <Link href="/Services/customers" className="underline underline-offset-2">
                Customers &amp; Leads
              </Link>
              .
            </p>
          ) : (
            <form
              className="mt-4 grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                void create();
              }}
            >
              <label className="block text-sm">
                <span className="text-muted">Account</span>
                <select
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                  required
                  className="input mt-1 w-full"
                >
                  <option value="" disabled>
                    Pick the account…
                  </option>
                  {(accounts?.accounts ?? []).map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-muted">Name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={200}
                  placeholder="Quarterly IPM service, initial treatment…"
                  className="input mt-1 w-full"
                />
              </label>
              <label className="block text-sm">
                <span className="text-muted">Value in dollars (optional)</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={valueDollars}
                  onChange={(event) => setValueDollars(event.target.value)}
                  className="input mt-1 w-full"
                />
              </label>
              <label className="block text-sm">
                <span className="text-muted">Expected close (optional)</span>
                <input
                  type="date"
                  value={expectedClose}
                  onChange={(event) => setExpectedClose(event.target.value)}
                  className="input mt-1 w-full"
                />
              </label>
              <div className="sm:col-span-2">
                <button type="submit" disabled={creating} className="btn btn-primary px-4 py-2 text-sm">
                  {creating ? "Recording…" : "Record opportunity"}
                </button>
              </div>
            </form>
          )}
          {createError !== null ? (
            <div className="mt-3">
              <Notice tone="warning">{createError}</Notice>
            </div>
          ) : null}
          {created !== null ? <p className="mt-3 text-sm text-muted">{created}</p> : null}
        </Card>
      ) : null}

      {listError !== null ? <Notice tone="warning">{listError}</Notice> : null}
      {actError !== null ? <Notice tone="warning">{actError}</Notice> : null}

      {report !== null ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="services-pipeline-report">
          <ReportTile
            label="Open pipeline"
            value={dollars(report.openValueCents)}
            detail={`${report.openCount} open ${report.openCount === 1 ? "opportunity" : "opportunities"}`}
            icon={<TrendingUp className="size-5" aria-hidden="true" />}
            iconTone="bg-[var(--accent-surface)] text-[var(--accent)]"
          />
          <ReportTile
            label="Won"
            value={dollars(report.wonValueCents)}
            detail={`${report.wonCount} ${report.wonCount === 1 ? "deal" : "deals"} won`}
            icon={<Trophy className="size-5" aria-hidden="true" />}
            iconTone="bg-emerald-100 text-emerald-700"
            valueClassName="text-emerald-700"
          />
          <ReportTile
            label="Win rate"
            value={report.winRatePercent === null ? "—" : `${report.winRatePercent}%`}
            detail={
              report.winRatePercent === null
                ? "No closed deals yet"
                : `Over ${report.wonCount + report.lostCount} closed`
            }
            icon={<CalendarDays className="size-5" aria-hidden="true" />}
            iconTone="bg-sky-100 text-sky-700"
          />
          <ReportTile
            label="Lost"
            value={String(report.lostCount)}
            detail="Reasons live on each deal and its timeline"
            icon={<XCircle className="size-5" aria-hidden="true" />}
            iconTone="bg-rose-100 text-rose-600"
          />
        </div>
      ) : null}

      {opportunities === null && listError === null ? (
        <p className="text-sm text-muted">Loading the pipeline…</p>
      ) : opportunities !== null && opportunities.length === 0 ? (
        <Card>
          <p className="text-sm text-muted" data-testid="services-pipeline-empty">
            No opportunities yet. Use New opportunity above to put the first deal on the board —
            pick its account, then move it stage by stage; every move lands on the account&apos;s
            timeline.
          </p>
        </Card>
      ) : opportunities !== null ? (
        <div
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
          data-testid="services-pipeline-board"
        >
          {STAGES.map((stage) => {
            const group = byStage.get(stage) ?? [];
            const tone = STAGE_TONES[stage] ?? STAGE_TONES.new;
            return (
              <section
                key={stage}
                className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(18,38,29,0.05)]"
              >
                <div className={cn("h-1 w-full", tone.bar)} aria-hidden="true" />
                <div className="flex items-baseline justify-between px-4 pb-2 pt-3">
                  <h3 className="text-sm font-semibold text-foreground">{STAGE_LABELS[stage]}</h3>
                  <span className="text-xs font-medium text-faint">
                    {report
                      ? `${report.byStage[stage]?.count ?? 0} · ${dollars(report.byStage[stage]?.valueCents ?? 0)}`
                      : null}
                  </span>
                </div>
                {group.length === 0 ? (
                  <p className="px-4 pb-4 text-xs text-faint">
                    Nothing in {STAGE_LABELS[stage].toLowerCase()}.
                  </p>
                ) : (
                  <ul className="space-y-2.5 px-3 pb-3">
                    {group.map((opportunity) => (
                      <li
                        key={opportunity.id}
                        className="rounded-lg border border-line bg-surface-inset p-3 transition-shadow hover:shadow-md"
                      >
                        <p className="text-sm font-semibold leading-snug text-foreground">
                          {opportunity.name}
                        </p>
                        <Link
                          href={`/Services/customers/${opportunity.accountId}`}
                          className="mt-1.5 flex items-center gap-2 text-xs text-muted underline-offset-2 hover:underline"
                        >
                          <AccountAvatar
                            name={accountNames.get(opportunity.accountId) ?? "?"}
                            size="sm"
                            className="size-5 rounded text-[9px]"
                          />
                          <span className="truncate">
                            {accountNames.get(opportunity.accountId) ?? "View account"}
                          </span>
                        </Link>
                        <p className="mt-1.5 text-xs text-muted">
                          <span className="font-semibold text-foreground">
                            {dollars(opportunity.valueCents)}
                          </span>
                          {opportunity.expectedCloseDate
                            ? ` · closes ${opportunity.expectedCloseDate}`
                            : ""}
                        </p>
                        {opportunity.stage === "lost" && opportunity.lostReason ? (
                          <p className="mt-1 text-xs text-rose-600/90">Lost: {opportunity.lostReason}</p>
                        ) : null}
                        {pendingLost?.id === opportunity.id ? (
                          <div className="mt-2 space-y-2">
                            <label className="block text-xs">
                              <span className="text-muted">Why was it lost? (optional)</span>
                              <input
                                type="text"
                                value={pendingLost.reason}
                                onChange={(event) =>
                                  setPendingLost({ id: opportunity.id, reason: event.target.value })
                                }
                                maxLength={300}
                                placeholder="Price, timing, went with another provider…"
                                className="input mt-1 w-full"
                              />
                            </label>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  void move(opportunity.id, {
                                    stage: "lost",
                                    ...(pendingLost.reason.trim()
                                      ? { lostReason: pendingLost.reason.trim() }
                                      : {}),
                                  })
                                }
                                className="btn btn-primary px-2.5 py-1 text-xs"
                              >
                                Mark lost
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingLost(null)}
                                className="btn btn-secondary px-2.5 py-1 text-xs"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <label className="mt-2 block text-xs">
                            <span className="sr-only">Stage for {opportunity.name}</span>
                            <select
                              value={opportunity.stage}
                              onChange={(event) => {
                                const next = event.target.value;
                                if (next === opportunity.stage) return;
                                if (next === "lost") {
                                  setPendingLost({ id: opportunity.id, reason: "" });
                                  return;
                                }
                                void move(opportunity.id, { stage: next });
                              }}
                              className="input min-h-8 w-full py-1 text-xs"
                            >
                              {STAGES.map((entry) => (
                                <option key={entry} value={entry}>
                                  {STAGE_LABELS[entry]}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ReportTile({
  label,
  value,
  detail,
  icon,
  iconTone,
  valueClassName,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  iconTone: string;
  valueClassName?: string;
}) {
  return (
    <Card className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-faint">{label}</p>
        <p className={cn("mt-1 text-2xl font-semibold tracking-tight text-foreground", valueClassName)}>
          {value}
        </p>
        <p className="mt-1 text-xs text-muted">{detail}</p>
      </div>
      <span
        className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", iconTone)}
        aria-hidden="true"
      >
        {icon}
      </span>
    </Card>
  );
}
