"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Trophy } from "lucide-react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { dollars } from "@/components/services/ui";
import type { CommissionsPayload, LeaderboardPayload } from "@/components/services/types";
import { cn } from "@/lib/cn";

/**
 * The sales motion: who is selling, at what rate, and what it earned them.
 *
 * Two honesty rules run through this page. A rep with nothing decided yet
 * shows no win rate rather than a zero — zero would read as "loses
 * everything", which is a different claim. And the deals nobody owns are
 * reported at the top rather than quietly excluded, because a leaderboard
 * that drops its own denominator flatters everybody on it.
 *
 * Commission amounts are the database's arithmetic, not this page's: the
 * ledger multiplies a basis by a rate, and these are the numbers it
 * returned.
 */

const STATUS_TONES: Record<string, string> = {
  accrued: "border-sky-200 bg-sky-50 text-sky-700",
  approved: "border-amber-200 bg-amber-50 text-amber-700",
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
  void: "border-slate-200 bg-slate-100 text-slate-500",
};

export function ServicesSalesPanel() {
  const [board, setBoard] = useState<LeaderboardPayload | null>(null);
  const [commissions, setCommissions] = useState<CommissionsPayload | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [boardRes, commissionsRes] = await Promise.all([
        fetch("/api/services/sales/leaderboard", { headers: { accept: "application/json" } }),
        fetch("/api/services/commissions", { headers: { accept: "application/json" } }),
      ]);
      const body = (await boardRes.json()) as LeaderboardPayload & { error?: { message?: string } };
      if (!boardRes.ok) {
        setListError(body.error?.message ?? "The leaderboard could not be read.");
        return;
      }
      setListError(null);
      setBoard(body);
      if (commissionsRes.ok) setCommissions((await commissionsRes.json()) as CommissionsPayload);
    } catch {
      setListError("The leaderboard could not be read.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  const repName = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of board?.rows ?? []) map.set(row.employeeId, row.name);
    return map;
  }, [board]);

  const advance = useCallback(
    async (commissionId: string, status: "approved" | "paid" | "void") => {
      setBusyId(commissionId);
      setActError(null);
      try {
        const response = await fetch("/api/services/commissions", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ commissionId, status }),
        });
        if (!response.ok) {
          const body = (await response.json()) as { error?: { message?: string } };
          setActError(body.error?.message ?? "The commission could not be updated.");
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

  return (
    <div>
      <PageHeader
        title="Sales"
        description="Per-rep pipeline, close rate against quota, and the commission ledger behind it. Every figure is derived from the deals and payouts already recorded."
      />

      {listError !== null ? <Notice tone="warning">{listError}</Notice> : null}
      {actError !== null ? <Notice tone="warning">{actError}</Notice> : null}

      <Card className="mb-6">
        <SectionTitle
          title="The board"
          description="Sorted by closed value. Reps with nothing decided yet show no win rate rather than a zero."
        />
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="services-sales-figures">
          <Figure label="Closed" value={dollars(board?.totals.wonValueCents ?? null)} />
          <Figure label="In the pipeline" value={dollars(board?.totals.openValueCents ?? null)} />
          <Figure label="Commission paid" value={dollars(board?.totals.commissionPaidCents ?? null)} />
          <Figure
            label="Deals with no owner"
            value={board === null ? "—" : board.totals.unownedOpportunities.toLocaleString("en-US")}
            tone={(board?.totals.unownedOpportunities ?? 0) > 0 ? "amber" : undefined}
          />
        </dl>
      </Card>

      <Card className="mb-6">
        <SectionTitle title="Leaderboard" description="Every rep who carries a rate or a quota." />
        {(board?.rows ?? []).length === 0 ? (
          <p className="mt-4 text-sm text-muted" data-testid="services-sales-empty">
            No reps carry a commission rate or a quota yet. Give someone one on the Team page, and
            the deals they own report here.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="services-leaderboard-table">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                  <th className="py-2 pr-3 font-medium">Rep</th>
                  <th className="py-2 pr-3 font-medium">Open</th>
                  <th className="py-2 pr-3 font-medium">Closed</th>
                  <th className="py-2 pr-3 font-medium">Win rate</th>
                  <th className="py-2 pr-3 font-medium">Quota</th>
                  <th className="py-2 font-medium">Commission</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(board?.rows ?? []).slice(0, 100).map((row, position) => (
                  <tr key={row.employeeId}>
                    <td className="py-2.5 pr-3">
                      <span className="flex items-center gap-2">
                        {position === 0 && row.wonValueCents > 0 ? (
                          <Trophy className="size-3.5 text-amber-500" aria-hidden="true" />
                        ) : null}
                        <span className="font-medium text-foreground">{row.name}</span>
                      </span>
                      <span className="block text-xs capitalize text-faint">
                        {row.role.replace(/_/g, " ")}
                        {row.active ? "" : " · ended"}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-muted">
                      {dollars(row.openValueCents)}
                      <span className="block text-xs text-faint">{row.openCount} open</span>
                    </td>
                    <td className="py-2.5 pr-3 font-medium tabular-nums text-foreground">
                      {dollars(row.wonValueCents)}
                      <span className="block text-xs font-normal text-faint">{row.wonCount} won</span>
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums text-muted">
                      {row.winRate === null ? (
                        <span className="text-faint">nothing decided</span>
                      ) : (
                        `${row.winRate}%`
                      )}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums text-muted">
                      {row.quotaCents === null ? (
                        "—"
                      ) : (
                        <>
                          {dollars(row.quotaCents)}
                          {row.quotaAttainment === null ? null : (
                            <span
                              className={cn(
                                "block text-xs",
                                row.quotaAttainment >= 100 ? "text-emerald-700" : "text-faint",
                              )}
                            >
                              {row.quotaAttainment}% of quota
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="py-2.5 tabular-nums text-muted">
                      {dollars(row.commissionPaidCents)} paid
                      <span className="block text-xs text-faint">
                        {dollars(row.commissionAccruedCents)} accrued
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle
          title="Commission ledger"
          description="The payout is the database's arithmetic — a basis multiplied by a rate — never a figure typed in. Approve or pay one here; a voided commission stays on the record."
        />
        {(commissions?.commissions ?? []).length === 0 ? (
          <p className="mt-4 text-sm text-muted">No commissions recorded yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="services-commissions-table">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                  <th className="py-2 pr-3 font-medium">Earned</th>
                  <th className="py-2 pr-3 font-medium">Rep</th>
                  <th className="py-2 pr-3 font-medium">Basis × rate</th>
                  <th className="py-2 pr-3 font-medium">Payout</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 font-medium">Advance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(commissions?.commissions ?? []).slice(0, 100).map((commission) => (
                  <tr key={commission.id}>
                    <td className="py-2.5 pr-3 text-muted">{commission.earnedOn}</td>
                    <td className="py-2.5 pr-3 text-foreground">
                      {repName.get(commission.employeeId) ?? "—"}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums text-muted">
                      {dollars(commission.basisCents)} × {(commission.rateBps / 100).toFixed(2)}%
                    </td>
                    <td className="py-2.5 pr-3 font-medium tabular-nums text-foreground">
                      {dollars(commission.amountCents)}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize",
                          STATUS_TONES[commission.status] ?? STATUS_TONES.accrued,
                        )}
                      >
                        {commission.status}
                      </span>
                    </td>
                    <td className="py-2.5">
                      {commission.status === "accrued" || commission.status === "approved" ? (
                        <span className="flex gap-1.5">
                          {commission.status === "accrued" ? (
                            <button
                              type="button"
                              className="btn btn-secondary px-2.5 py-1 text-xs"
                              disabled={busyId === commission.id}
                              onClick={() => void advance(commission.id, "approved")}
                            >
                              Approve
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-secondary px-2.5 py-1 text-xs"
                            disabled={busyId === commission.id}
                            onClick={() => void advance(commission.id, "paid")}
                          >
                            {busyId === commission.id ? "Recording…" : "Mark paid"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary px-2.5 py-1 text-xs"
                            disabled={busyId === commission.id}
                            onClick={() => void advance(commission.id, "void")}
                          >
                            Void
                          </button>
                        </span>
                      ) : (
                        <span className="text-xs text-faint">
                          {commission.paidAt ? commission.paidAt.slice(0, 10) : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {commissions !== null ? (
          <p className="mt-3 text-xs text-faint">
            {dollars(commissions.totals.accruedCents)} accrued ·{" "}
            {dollars(commissions.totals.approvedCents)} approved ·{" "}
            {dollars(commissions.totals.paidCents)} paid ·{" "}
            {dollars(commissions.totals.voidCents)} voided. Voided payouts are reported apart rather
            than netted away.
          </p>
        ) : null}
      </Card>
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "amber" }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <dt className="text-xs uppercase tracking-wide text-faint">{label}</dt>
      <dd
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "amber" ? "text-amber-700" : "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
