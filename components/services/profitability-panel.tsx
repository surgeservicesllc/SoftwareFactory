"use client";

import { Calculator, CircleHelp, Coins, FlaskConical, HardHat } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Card, EmptyState, MetricCard, PageHeader, SectionTitle } from "@/components/ui";
import {
  unknownReasons,
  type ProfitabilityGroup,
  type VisitProfitabilityView,
} from "@/lib/services/profitability";

/**
 * Profitability: what each completed visit earned and what it cost, with
 * every input printed beside the margin and every unknown counted rather
 * than zeroed. "We lost money on Tuesday" and "we do not know what Tuesday
 * cost" are different sentences, and this page never lets one read as the
 * other.
 */

type Board = {
  window: { days: number; visitCeiling: number; truncated: boolean };
  totals: ProfitabilityGroup;
  byTechnician: ProfitabilityGroup[];
  byService: ProfitabilityGroup[];
  byBranch: ProfitabilityGroup[];
  unknowns: {
    visitsWithoutInvoice: number;
    visitsWithoutRate: number;
    visitsOnWindowBasis: number;
    uncostedApplications: number;
  };
  visits: VisitProfitabilityView[];
  costs: {
    technicians: Array<{ id: string; name: string; active: boolean; hourlyCostCents: number | null }>;
    lots: Array<{ id: string; lotNumber: string; unit: string; unitCostCents: number | null; receivedOn: string; quantityRemaining: number }>;
  };
};

async function readFailure(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}

// Cents-precise and sign-first: a margin of −$43.00 reads as a loss at a
// glance, and a $0.75 chemical cost is not "$1".
function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function bps(value: number | null): string {
  return value === null ? "—" : `${(value / 100).toFixed(1)}%`;
}

function GroupTable({ title, groups, testId }: { title: string; groups: ProfitabilityGroup[]; testId: string }) {
  return (
    <Card>
      <SectionTitle title={title} description="Sums over visits whose margin is known; the unknown ones are counted, not assumed." />
      {groups.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Nothing completed in the window.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm" data-testid={testId}>
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 pr-3">Group</th>
                <th className="py-1 pr-3">Visits</th>
                <th className="py-1 pr-3">Known</th>
                <th className="py-1 pr-3">Revenue</th>
                <th className="py-1 pr-3">Labour</th>
                <th className="py-1 pr-3">Chemicals</th>
                <th className="py-1 pr-3">Margin</th>
                <th className="py-1">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.key} className="border-t border-[var(--border)]">
                  <td className="py-1 pr-3">{group.name}</td>
                  <td className="tabular py-1 pr-3">{group.visits}</td>
                  <td className="tabular py-1 pr-3">
                    {group.known}
                    {group.unknown > 0 ? <span className="text-faint"> · {group.unknown} unknown</span> : null}
                  </td>
                  <td className="tabular py-1 pr-3">{money(group.revenueCents)}</td>
                  <td className="tabular py-1 pr-3">{money(group.labourCostCents)}</td>
                  <td className="tabular py-1 pr-3">{money(group.chemicalCostCents)}</td>
                  <td className={`tabular py-1 pr-3 ${group.marginCents < 0 ? "text-[var(--danger)]" : ""}`}>
                    {group.known === 0 ? "—" : money(group.marginCents)}
                  </td>
                  <td className="tabular py-1">{bps(group.marginBps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function ServicesProfitabilityPanel() {
  const [days, setDays] = useState(90);
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async (window: number) => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(`/api/services/profitability?days=${window}`, { cache: "no-store" });
      if (!response.ok) {
        setLoadError(await readFailure(response, "Profitability could not be computed."));
        return;
      }
      const body = (await response.json()) as Board;
      setBoard(body);
      setDrafts({
        ...Object.fromEntries(body.costs.technicians.map((t) => [`t:${t.id}`, t.hourlyCostCents === null ? "" : String(t.hourlyCostCents / 100)])),
        ...Object.fromEntries(body.costs.lots.map((l) => [`l:${l.id}`, l.unitCostCents === null ? "" : String(l.unitCostCents / 100)])),
      });
    } catch {
      setLoadError("Profitability could not be computed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(days), 0);
    return () => window.clearTimeout(kickoff);
  }, [load, days]);

  async function saveCost(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/services/profitability/costs", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setMessage(await readFailure(response, "The cost could not be saved."));
        return;
      }
      await load(days);
    } catch {
      setMessage("The cost could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function centsFromDraft(key: string): number | null {
    const raw = (drafts[key] ?? "").trim();
    if (raw === "") return null;
    return Math.round(Number(raw) * 100);
  }

  const totals = board?.totals;

  return (
    <div className="space-y-6" data-testid="services-profitability">
      <PageHeader
        title="Profitability"
        description="What each completed visit earned and what it cost — every input beside the margin, every unknown counted rather than zeroed."
        action={
          <label className="flex items-center gap-2 text-sm text-muted">
            Window
            <select
              aria-label="Window in days"
              className="rounded border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            >
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={365}>365 days</option>
            </select>
          </label>
        }
      />
      {loadError ? <p role="alert" className="text-sm text-[var(--danger)]">{loadError}</p> : null}
      {message ? <p role="alert" className="text-sm text-[var(--danger)]">{message}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Revenue (known visits)"
          value={loading || !totals ? "—" : money(totals.revenueCents)}
          detail={totals ? `${totals.known} of ${totals.visits} visits with every input on file` : "Completed visits in the window"}
          icon={Coins}
        />
        <MetricCard
          label="Labour"
          value={loading || !totals ? "—" : money(totals.labourCostCents)}
          detail={board ? `${board.unknowns.visitsOnWindowBasis} on the scheduled window, not a timesheet` : ""}
          icon={HardHat}
        />
        <MetricCard
          label="Chemicals"
          value={loading || !totals ? "—" : money(totals.chemicalCostCents)}
          detail={board ? `${board.unknowns.uncostedApplications} application${board.unknowns.uncostedApplications === 1 ? "" : "s"} with no lot cost` : ""}
          icon={FlaskConical}
        />
        <MetricCard
          label="Margin"
          value={loading || !totals || totals.known === 0 ? "—" : money(totals.marginCents)}
          detail={totals ? `${bps(totals.marginBps)} of known revenue · ${totals.unknown} unknown` : ""}
          icon={Calculator}
          tone={totals && totals.known > 0 && totals.marginCents < 0 ? "danger" : "neutral"}
        />
      </div>

      {board && board.totals.unknown > 0 ? (
        <Card>
          <SectionTitle title="What is unknown, and why" description="A margin is never guessed. Each of these makes a visit's margin unknown until the input is on file." />
          <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2" data-testid="profitability-unknowns">
            <li><CircleHelp className="mr-1 inline size-4 text-faint" aria-hidden="true" />{board.unknowns.visitsWithoutInvoice} visit{board.unknowns.visitsWithoutInvoice === 1 ? "" : "s"} with no invoice linked</li>
            <li><CircleHelp className="mr-1 inline size-4 text-faint" aria-hidden="true" />{board.unknowns.visitsWithoutRate} visit{board.unknowns.visitsWithoutRate === 1 ? "" : "s"} whose technician has no hourly cost</li>
            <li><CircleHelp className="mr-1 inline size-4 text-faint" aria-hidden="true" />{board.unknowns.uncostedApplications} application{board.unknowns.uncostedApplications === 1 ? "" : "s"} with no lot cost or a mismatched unit</li>
            <li><CircleHelp className="mr-1 inline size-4 text-faint" aria-hidden="true" />{board.unknowns.visitsOnWindowBasis} visit{board.unknowns.visitsOnWindowBasis === 1 ? "" : "s"} costed on the scheduled window (an estimate, labelled)</li>
          </ul>
        </Card>
      ) : null}

      <Card>
        <SectionTitle title="Visits, worst margin first" description="Every input is printed. A dash is an unknown, and the reason is beside it." />
        {loading ? (
          <p className="mt-3 text-sm text-muted">Computing from your records…</p>
        ) : (board?.visits.length ?? 0) === 0 ? (
          <EmptyState title="No completed visits in the window" description="Profitability is computed from completed visits; widen the window or complete some work." icon={Calculator} />
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border)]" data-testid="profitability-visits">
            {board!.visits.slice(0, 40).map((visit) => {
              const reasons = unknownReasons(visit);
              return (
                <li key={visit.workOrderId} className="py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">
                      {visit.accountName} <span className="text-faint">· {visit.serviceType} · {visit.completedAt.slice(0, 10)} · {visit.technicianName ?? "no technician"}</span>
                    </span>
                    <span className={`tabular text-base font-semibold ${visit.marginCents !== null && visit.marginCents < 0 ? "text-[var(--danger)]" : ""}`}>
                      {visit.marginCents === null ? "—" : `${money(visit.marginCents)} (${bps(visit.marginBps)})`}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    revenue {visit.revenueCents === null ? "unknown" : money(visit.revenueCents)}
                    {" − labour "}
                    {visit.labourCostCents === null
                      ? `unknown (${visit.labourMinutes} min, no hourly cost)`
                      : `${money(visit.labourCostCents)} (${visit.labourMinutes} min at ${money(visit.hourlyCostCents ?? 0)}/h, ${visit.labourBasis})`}
                    {" − chemicals "}
                    {money(visit.chemicalCostCents)} ({visit.applications} application{visit.applications === 1 ? "" : "s"}
                    {visit.uncostedApplications > 0 ? `, ${visit.uncostedApplications} uncosted` : ""})
                  </p>
                  {reasons.length > 0 ? (
                    <p className="mt-0.5 text-xs text-[var(--warning)]">Unknown because {reasons.join("; ")}.</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {board ? (
        <>
          <GroupTable title="By technician" groups={board.byTechnician} testId="profitability-by-technician" />
          <GroupTable title="By service" groups={board.byService} testId="profitability-by-service" />
          <GroupTable title="By branch" groups={board.byBranch} testId="profitability-by-branch" />
        </>
      ) : null}

      <Card>
        <SectionTitle
          title="Costs on file"
          description="A technician's fully loaded hourly cost and a lot's cost per unit as received. Leave one blank and it is unknown — which the figures above say, rather than treating it as free."
        />
        {board ? (
          <div className="mt-3 grid gap-6 lg:grid-cols-2">
            <div>
              <p className="text-sm font-medium">Technicians — hourly cost ($)</p>
              <ul className="mt-2 divide-y divide-[var(--border)]" data-testid="cost-technicians">
                {board.costs.technicians.map((technician) => (
                  <li key={technician.id} className="flex items-center gap-2 py-1.5 text-sm">
                    <span className="min-w-0 flex-1">{technician.name}{technician.active ? "" : <span className="text-faint"> (inactive)</span>}</span>
                    <input
                      aria-label={`Hourly cost for ${technician.name}`}
                      type="number"
                      min={0}
                      step="0.01"
                      className="w-24 rounded border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
                      value={drafts[`t:${technician.id}`] ?? ""}
                      onChange={(event) => setDrafts((current) => ({ ...current, [`t:${technician.id}`]: event.target.value }))}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded bg-[var(--accent)] px-3 py-1 text-xs text-white disabled:opacity-50"
                      onClick={() => void saveCost({ technicianId: technician.id, hourlyCostCents: centsFromDraft(`t:${technician.id}`) })}
                    >
                      Save
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-sm font-medium">Lots — cost per unit ($)</p>
              <ul className="mt-2 divide-y divide-[var(--border)]" data-testid="cost-lots">
                {board.costs.lots.map((lot) => (
                  <li key={lot.id} className="flex items-center gap-2 py-1.5 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-mono text-xs">{lot.lotNumber}</span>
                      <span className="text-faint"> · per {lot.unit} · {lot.quantityRemaining} left</span>
                    </span>
                    <input
                      aria-label={`Unit cost for lot ${lot.lotNumber}`}
                      type="number"
                      min={0}
                      step="0.01"
                      className="w-24 rounded border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
                      value={drafts[`l:${lot.id}`] ?? ""}
                      onChange={(event) => setDrafts((current) => ({ ...current, [`l:${lot.id}`]: event.target.value }))}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded bg-[var(--accent)] px-3 py-1 text-xs text-white disabled:opacity-50"
                      onClick={() => void saveCost({ lotId: lot.id, unitCostCents: centsFromDraft(`l:${lot.id}`) })}
                    >
                      Save
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
