"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import type { DashboardRowsPayload, DashboardsPayload } from "@/components/services/types";
import type { ForecastAssumptionsView, ForecastScenarioMonthView, ScenarioTotals } from "@/lib/services/trust";
import { cn } from "@/lib/cn";

/**
 * How the business is actually running.
 *
 * Every figure on this page is aggregated in the database over the whole
 * book, not over the first page of a fetch, so the totals are totals. And
 * every rate that has no denominator reads as an em dash rather than a
 * zero — a month nobody was billed in has no collection rate, and printing
 * "0.0%" there would say the opposite of what happened.
 *
 * Three things are shown that a dashboard usually leaves out, because they
 * are the ones worth acting on: what is open but not yet due (kept apart
 * from what is overdue), customers with no active service plan, and shifts
 * still running — which contribute no worked minutes rather than being
 * counted as though they had ended.
 */

const BUCKET_LABELS: Record<string, string> = {
  current: "Not yet due",
  "1-30": "1–30 days",
  "31-60": "31–60 days",
  "61-90": "61–90 days",
  "90+": "Over 90 days",
  undated: "No due date",
};

type Tab = "revenue" | "forecast" | "receivable" | "technicians" | "routes";

type ScenarioPayload = {
  window: { months: number };
  assumptions: ForecastAssumptionsView | null;
  applied: { churnBps: number; growthBps: number; source: "stored" | "query" | "none" };
  months: ForecastScenarioMonthView[];
  totals: ScenarioTotals;
};

function percent(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/** An em dash where there is no measurement, never a zero. */
function rate(bps: number | null): string {
  return bps === null ? "—" : `${(bps / 100).toFixed(1)}%`;
}

function hours(minutes: number | null): string {
  return minutes === null ? "—" : `${(minutes / 60).toFixed(1)}h`;
}

export function ServicesDashboardsPanel() {
  const [data, setData] = useState<DashboardsPayload | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("revenue");
  const [drill, setDrill] = useState<{ figure: string; key: string | null; label: string; days?: number } | null>(null);
  const [rows, setRows] = useState<DashboardRowsPayload | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<ScenarioPayload | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [churnInput, setChurnInput] = useState("");
  const [growthInput, setGrowthInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [scenarioBusy, setScenarioBusy] = useState(false);

  /*
   * The scenario is the recorded forecast with the owner's own churn and
   * growth applied, factor printed per month. Reading it with no inputs
   * applies what the workspace saved; reading it with inputs is a what-if
   * that is never saved unless Save is pressed.
   */
  const readScenario = useCallback(async (whatIf?: { churnBps: number; growthBps: number }) => {
    setScenarioError(null);
    const params = new URLSearchParams();
    if (whatIf) {
      params.set("churnBps", String(whatIf.churnBps));
      params.set("growthBps", String(whatIf.growthBps));
    }
    try {
      const response = await fetch(`/api/services/forecast/scenario${params.size > 0 ? `?${params.toString()}` : ""}`, {
        headers: { accept: "application/json" },
      });
      const body = (await response.json()) as ScenarioPayload & { error?: { message?: string } };
      if (!response.ok) {
        setScenarioError(body.error?.message ?? "The scenario could not be read.");
        return;
      }
      setScenario(body);
      if (!whatIf) {
        setChurnInput((body.applied.churnBps / 100).toFixed(1));
        setGrowthInput((body.applied.growthBps / 100).toFixed(1));
        setNoteInput(body.assumptions?.note ?? "");
      }
    } catch {
      setScenarioError("The scenario could not be read.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void readScenario(), 0);
    return () => window.clearTimeout(kickoff);
  }, [readScenario]);

  const inputBps = useCallback((value: string) => Math.min(10_000, Math.max(0, Math.round(Number(value || "0") * 100))), []);

  const saveAssumptions = useCallback(async (clear: boolean) => {
    setScenarioBusy(true);
    setScenarioError(null);
    try {
      const response = await fetch("/api/services/forecast/scenario", {
        method: clear ? "DELETE" : "PUT",
        headers: { "content-type": "application/json" },
        body: clear
          ? undefined
          : JSON.stringify({
              annualChurnBps: inputBps(churnInput),
              annualGrowthBps: inputBps(growthInput),
              note: noteInput.trim().length === 0 ? null : noteInput.trim(),
            }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setScenarioError(body.error?.message ?? "The assumptions could not be saved.");
        return;
      }
      await readScenario();
    } catch {
      setScenarioError("The assumptions could not be saved.");
    } finally {
      setScenarioBusy(false);
    }
  }, [churnInput, growthInput, inputBps, noteInput, readScenario]);

  /*
   * Every figure opens. The rows come from `crm_dashboard_rows`, which
   * repeats the figure's own predicate, so the list under a number is the
   * number — never a nearby query that happens to agree today.
   */
  const openRows = useCallback(async (figure: string, key: string | null, label: string, days?: number) => {
    setDrill({ figure, key, label, days });
    setRows(null);
    setRowsError(null);
    const params = new URLSearchParams({ figure });
    if (key !== null) params.set("key", key);
    if (days !== undefined) params.set("days", String(days));
    try {
      const response = await fetch(`/api/services/dashboards/rows?${params.toString()}`, {
        headers: { accept: "application/json" },
      });
      const body = (await response.json()) as DashboardRowsPayload & { error?: { message?: string } };
      if (!response.ok) {
        setRowsError(body.error?.message ?? "The rows behind that figure could not be read.");
        return;
      }
      setRows(body);
    } catch {
      setRowsError("The rows behind that figure could not be read.");
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/services/dashboards", {
        headers: { accept: "application/json" },
      });
      const body = (await response.json()) as DashboardsPayload & { error?: { message?: string } };
      if (!response.ok) {
        setListError(body.error?.message ?? "The dashboards could not be read.");
        return;
      }
      setListError(null);
      setData(body);
    } catch {
      setListError("The dashboards could not be read.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  /*
   * The tallest month, used to scale the bars. Null when nothing was ever
   * invoiced, which renders as an empty chart rather than as bars of
   * arbitrary height.
   */
  const peak = useMemo(() => {
    const values = (data?.revenue.months ?? []).map((month) =>
      Math.max(month.invoicedCents, month.collectedCents),
    );
    const highest = Math.max(0, ...values);
    return highest === 0 ? null : highest;
  }, [data]);

  return (
    <div>
      <PageHeader
        title="Dashboards"
        description="Revenue, receivable, retention, technician productivity and how the days are shaped — aggregated over the whole book in the database, not over the first page of a fetch."
      />

      {listError !== null ? <Notice tone="warning">{listError}</Notice> : null}

      <Card className="mb-6">
        <SectionTitle
          title="The numbers worth acting on"
          description="A rate with no denominator reads as an em dash. A month nobody was billed in has no collection rate, and printing zero there would say the opposite of what happened."
        />
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="services-dashboard-figures">
          <Figure
            label={`Invoiced, ${data?.windows.months ?? 12} months`}
            value={data === null ? "—" : money(data.revenue.totals.invoicedCents)}
            onOpen={() => void openRows("invoiced_month", `${new Date().toISOString().slice(0, 7)}-01`, "this month's invoices")}
          />
          <Figure
            label="Overdue"
            value={data === null ? "—" : money(data.receivable.overdueCents)}
            tone={(data?.receivable.overdueCents ?? 0) > 0 ? "amber" : undefined}
            onOpen={() => void openRows("overdue", null, "overdue invoices")}
          />
          <Figure
            label="Customers with no plan"
            value={data?.retention === null || data === undefined ? "—" : String(data?.retention?.customersWithoutPlan ?? "—")}
            tone={(data?.retention?.customersWithoutPlan ?? 0) > 0 ? "amber" : undefined}
            onOpen={() => void openRows("no_plan", null, "customers with no plan")}
          />
          <Figure
            label="Retention"
            value={data === null ? "—" : rate(data.retention?.retentionBps ?? null)}
            onOpen={() => void openRows("retention", "inactive", "inactive accounts (the ones retention lost)")}
          />
        </dl>
      </Card>

      {drill !== null ? (
        <section className="card mb-6" data-testid="services-dashboard-rows">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <SectionTitle
              title={`Behind ${drill.label}`}
              description="Every row this figure counts, by the same rule the figure uses — the count on the tile and the list here cannot disagree."
            />
            <button type="button" onClick={() => { setDrill(null); setRows(null); }} className="btn btn-secondary px-3 py-1.5 text-xs">
              Close
            </button>
          </div>
          {rowsError !== null ? <Notice tone="warning">{rowsError}</Notice> : null}
          {rows === null && rowsError === null ? (
            <p className="mt-3 text-sm text-muted">Reading the rows…</p>
          ) : rows !== null && rows.rows.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Nothing is behind this figure right now.</p>
          ) : rows !== null ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Account</th>
                    <th className="py-2 pr-3 font-medium">Row</th>
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Amount</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.rows.map((row) => (
                    <tr key={`${row.rowKind}:${row.rowId}`}>
                      <td className="py-2 pr-3 text-foreground">{row.accountName}</td>
                      <td className="py-2 pr-3 text-muted">{row.rowKind === "account" ? "account" : row.label}</td>
                      <td className="py-2 pr-3 tabular-nums text-muted">{row.occurredOn ?? "—"}</td>
                      <td className="py-2 pr-3 tabular-nums text-muted">{row.amountCents === null ? "—" : money(row.amountCents)}</td>
                      <td className="py-2 text-muted">{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.ceiling.reached ? (
                <p className="mt-2 text-xs text-faint">Showing the first {rows.ceiling.rows} rows; the figure counts them all.</p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Dashboards">
        {(
          [
            ["revenue", "Revenue", data?.revenue.months.length],
            ["forecast", "Forecast", data?.forecast.months.length],
            ["receivable", "Receivable", data?.receivable.buckets.length],
            ["technicians", "Technicians", data?.productivity.technicians.length],
            ["routes", "Route density", data?.routes.days.length],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn("btn px-3 py-2 text-sm", tab === key ? "btn-primary" : "btn-secondary")}
          >
            {label}
            {typeof count === "number" ? <span className="ml-1.5 text-xs opacity-70">{count}</span> : null}
          </button>
        ))}
      </div>

      {tab === "revenue" ? (
        <Card>
          <SectionTitle
            title="Invoiced and collected"
            description="Two series on purpose. An invoice is billed in the month it was issued; a payment lands in the month it arrived, which is often a different one — and that lag is exactly what a collections desk watches."
          />
          {(data?.revenue.months ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted" data-testid="services-dashboard-revenue-empty">
              Nothing billed yet. Issue an invoice on the Billing page and the month appears here.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="services-dashboard-revenue-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Month</th>
                    <th className="py-2 pr-3 font-medium">Invoices</th>
                    <th className="py-2 pr-3 font-medium">Invoiced</th>
                    <th className="py-2 pr-3 font-medium">Collected</th>
                    <th className="py-2 pr-3 font-medium">Refunded</th>
                    <th className="py-2 pr-3 font-medium">Collection rate</th>
                    <th className="py-2 font-medium">Shape</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(data?.revenue.months ?? []).map((month) => (
                    <tr key={month.month}>
                      <td className="py-2.5 pr-3 text-foreground">
                        <button type="button" className="underline-offset-2 hover:underline" onClick={() => void openRows("invoiced_month", month.month.slice(0, 10), `invoices issued in ${month.month.slice(0, 7)}`)}>
                          {month.month.slice(0, 7)}
                        </button>
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">{month.invoiceCount}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">{money(month.invoicedCents)}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-foreground">{money(month.collectedCents)}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">
                        {month.refundedCents === 0 ? "—" : money(month.refundedCents)}
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">
                        {rate(month.collectionRateBps)}
                      </td>
                      <td className="py-2.5">
                        {peak === null ? (
                          "—"
                        ) : (
                          <span className="flex h-4 w-32 items-end gap-0.5" aria-hidden="true">
                            <span
                              className="block w-3 rounded-sm bg-slate-300"
                              style={{ height: `${Math.round((month.invoicedCents / peak) * 100)}%` }}
                            />
                            <span
                              className="block w-3 rounded-sm bg-emerald-400"
                              style={{ height: `${Math.round((month.collectedCents / peak) * 100)}%` }}
                            />
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === "forecast" ? (
        <Card>
          <SectionTitle
            title="What is on the books"
            description="A projection of active plans and contracts, and nothing else."
          />
          <Notice tone="info">
            No churn rate, growth assumption or seasonality curve is applied — this system has no
            evidence for any of them, and multiplying a real number by an invented retention rate
            would look more precise than the truth while being less accurate.
          </Notice>
          {data?.forecast.basis === null || data === null ? null : (
            <p className="mt-3 text-sm text-muted" data-testid="services-forecast-basis">
              Standing on {data.forecast.basis.activePlans} active plan
              {data.forecast.basis.activePlans === 1 ? "" : "s"}
              {data.forecast.basis.unpricedPlans > 0
                ? ` (${data.forecast.basis.unpricedPlans} with no price, contributing nothing)`
                : ""}
              {" and "}
              {data.forecast.basis.activeContracts} active contract
              {data.forecast.basis.activeContracts === 1 ? "" : "s"}
              {data.forecast.basis.openEndedContracts > 0
                ? ` (${data.forecast.basis.openEndedContracts} open-ended, and therefore absent from the contracted line — a term that does not exist cannot be spread)`
                : ""}
              .
              {data.forecast.basis.customersWithoutPlan > 0
                ? ` ${data.forecast.basis.customersWithoutPlan} customer${data.forecast.basis.customersWithoutPlan === 1 ? "" : "s"} carry no active plan at all, so they contribute nothing here.`
                : ""}
              {" Each of these is a reason the figure below understates."}
            </p>
          )}
          {(data?.forecast.months ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted" data-testid="services-forecast-empty">
              Nothing recurring on the books yet. Add a priced service plan and it appears here.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="services-forecast-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Month</th>
                    <th className="py-2 pr-3 font-medium">Recurring</th>
                    <th className="py-2 pr-3 font-medium">Contracted</th>
                    <th className="py-2 pr-3 font-medium">Plans</th>
                    <th className="py-2 font-medium">Projected</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(data?.forecast.months ?? []).map((month) => (
                    <tr key={month.month}>
                      <td className="py-2.5 pr-3 text-foreground">{month.month.slice(0, 7)}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">{money(month.recurringCents)}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">
                        {month.contractedCents === 0 ? "—" : money(month.contractedCents)}
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">{month.plans}</td>
                      <td className="py-2.5 tabular-nums text-foreground">{money(month.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === "forecast" ? (
        <section className="card mt-6" data-testid="services-forecast-scenario-card">
          <SectionTitle
            title="Your assumptions, beside the figure"
            description="The recorded forecast applies no model. This card applies only what you type — an annual churn and growth, compounded month by month — and prints the factor for every month so the scenario can be checked by hand. A what-if is not saved unless you save it."
          />
          {scenarioError !== null ? <Notice tone="warning">{scenarioError}</Notice> : null}
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs uppercase tracking-wide text-faint">Annual churn %</span>
              <input type="number" min={0} max={100} step={0.1} value={churnInput} onChange={(event) => setChurnInput(event.target.value)} aria-label="Annual churn percent" className="w-24 rounded-lg border border-line px-2 py-1 text-sm text-foreground" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs uppercase tracking-wide text-faint">Annual growth %</span>
              <input type="number" min={0} max={100} step={0.1} value={growthInput} onChange={(event) => setGrowthInput(event.target.value)} aria-label="Annual growth percent" className="w-24 rounded-lg border border-line px-2 py-1 text-sm text-foreground" />
            </label>
            <label className="min-w-64 flex-1 text-sm">
              <span className="mb-1 block text-xs uppercase tracking-wide text-faint">Where the numbers came from</span>
              <input type="text" maxLength={300} value={noteInput} onChange={(event) => setNoteInput(event.target.value)} aria-label="Where the numbers came from" placeholder="e.g. last two years of cancellations" className="w-full rounded-lg border border-line px-2 py-1 text-sm text-foreground" />
            </label>
            <button type="button" onClick={() => void readScenario({ churnBps: inputBps(churnInput), growthBps: inputBps(growthInput) })} className="btn btn-secondary px-3 py-1.5 text-xs">
              Try it
            </button>
            <button type="button" disabled={scenarioBusy} onClick={() => void saveAssumptions(false)} className="btn btn-primary px-3 py-1.5 text-xs">
              Save
            </button>
            {scenario?.assumptions ? (
              <button type="button" disabled={scenarioBusy} onClick={() => void saveAssumptions(true)} className="btn btn-secondary px-3 py-1.5 text-xs">
                Clear
              </button>
            ) : null}
          </div>
          {scenario === null ? (
            <p className="mt-4 text-sm text-muted">Reading the scenario…</p>
          ) : (
            <>
              <p className="mt-3 text-sm text-muted" data-testid="services-forecast-scenario-applied">
                {scenario.applied.source === "none"
                  ? "No assumptions saved: the scenario equals the recorded forecast."
                  : `${scenario.applied.source === "query" ? "Trying" : "Applying"} ${percent(scenario.applied.churnBps)} annual churn and ${percent(scenario.applied.growthBps)} annual growth${scenario.applied.source === "query" ? " (not saved)" : ""}.`}
                {" "}Over {scenario.window.months} months: recorded {money(scenario.totals.recordedCents)}, scenario {money(scenario.totals.scenarioCents)}
                {scenario.totals.differenceCents === 0 ? "." : ` (${scenario.totals.differenceCents > 0 ? "+" : "−"}${money(Math.abs(scenario.totals.differenceCents))}).`}
              </p>
              {scenario.months.length > 0 ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm" data-testid="services-forecast-scenario-table">
                    <thead>
                      <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                        <th className="py-2 pr-3 font-medium">Month</th>
                        <th className="py-2 pr-3 font-medium">Recorded</th>
                        <th className="py-2 pr-3 font-medium">Scenario</th>
                        <th className="py-2 font-medium">Factor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {scenario.months.map((month) => (
                        <tr key={month.month}>
                          <td className="py-2 pr-3 text-foreground">{month.month.slice(0, 7)}</td>
                          <td className="py-2 pr-3 tabular-nums text-muted">{money(month.recordedCents)}</td>
                          <td className="py-2 pr-3 tabular-nums text-foreground">{money(month.scenarioCents)}</td>
                          <td className="py-2 tabular-nums text-muted">×{(month.factorBps / 10000).toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {tab === "receivable" ? (
        <Card>
          <SectionTitle
            title="Receivable, by age"
            description="What is not yet due and what has no due date at all are kept apart from what is late. Folding them in is the usual way an aging report overstates itself."
          />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="services-dashboard-aging-table">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                  <th className="py-2 pr-3 font-medium">Bucket</th>
                  <th className="py-2 pr-3 font-medium">Invoices</th>
                  <th className="py-2 font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(data?.receivable.buckets ?? []).map((bucket) => (
                  <tr key={bucket.bucket}>
                    <td className="py-2.5 pr-3 text-foreground">
                      <button type="button" className="underline-offset-2 hover:underline" onClick={() => void openRows("aging", bucket.bucket, `receivable ${BUCKET_LABELS[bucket.bucket] ?? bucket.bucket}`)}>
                        {BUCKET_LABELS[bucket.bucket] ?? bucket.bucket}
                      </button>
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums text-muted">{bucket.invoiceCount}</td>
                    <td
                      className={cn(
                        "py-2.5 tabular-nums",
                        bucket.overdue && bucket.balanceCents > 0 ? "text-amber-700" : "text-muted",
                      )}
                    >
                      {money(bucket.balanceCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data !== null && data.receivable.undatedCents > 0 ? (
            <p className="mt-3 text-sm text-muted">
              {money(data.receivable.undatedCents)} sits on invoices with no due date, so it cannot
              be aged. That is a data gap rather than a collections problem — set terms on those
              invoices and they will fall into a bucket.
            </p>
          ) : null}
        </Card>
      ) : null}

      {tab === "technicians" ? (
        <Card>
          <SectionTitle
            title="Technician productivity"
            description="Everybody on the roster appears, including anybody with nothing scheduled — an empty row is the finding, and dropping it would flatter every average above it."
          />
          {data !== null && data.productivity.runningShifts > 0 ? (
            <Notice tone="info">
              {data.productivity.runningShifts} shift
              {data.productivity.runningShifts === 1 ? " is" : "s are"} still running and
              contribute no worked hours. An open shift has no total yet, and counting it as
              finished would inflate every figure here.
            </Notice>
          ) : null}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="services-dashboard-technicians-table">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                  <th className="py-2 pr-3 font-medium">Technician</th>
                  <th className="py-2 pr-3 font-medium">Scheduled</th>
                  <th className="py-2 pr-3 font-medium">Completed</th>
                  <th className="py-2 pr-3 font-medium">Cancelled</th>
                  <th className="py-2 pr-3 font-medium">Completion</th>
                  <th className="py-2 font-medium">Worked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(data?.productivity.technicians ?? []).slice(0, 100).map((technician) => (
                  <tr key={technician.technicianId}>
                    <td className="py-2.5 pr-3 text-foreground">
                      <button type="button" className="underline-offset-2 hover:underline" onClick={() => void openRows("technician", technician.technicianId, `${technician.name}'s scheduled visits`, data?.windows.productivityDays)}>
                        {technician.name}
                      </button>
                      {technician.active ? null : (
                        <span className="ml-1.5 text-xs text-faint">off roster</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums text-muted">{technician.scheduled}</td>
                    <td className="py-2.5 pr-3 tabular-nums text-foreground">{technician.completed}</td>
                    <td className="py-2.5 pr-3 tabular-nums text-muted">{technician.cancelled}</td>
                    <td className="py-2.5 pr-3 tabular-nums text-muted">
                      {rate(technician.completionRateBps)}
                    </td>
                    <td className="py-2.5 tabular-nums text-muted">
                      {hours(technician.workedMinutes)}
                      {technician.runningShifts > 0 ? (
                        <span className="ml-1.5 text-xs text-sky-700">
                          +{technician.runningShifts} running
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {tab === "routes" ? (
        <Card>
          <SectionTitle
            title="Route density"
            description="How each day is actually shaped: how many stops, how much of the span is booked, and how much of it is a hole."
          />
          <Notice tone="info">
            Drive-time sequencing is <strong>Not Connected</strong> — no mapping provider is
            configured, so distances cannot be computed and nothing here estimates them. What is
            shown comes from real scheduled windows.
          </Notice>
          {(data?.routes.days ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted" data-testid="services-dashboard-routes-empty">
              No visits scheduled in this window. Book work on the Schedule page and the days
              appear here.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="services-dashboard-routes-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Day</th>
                    <th className="py-2 pr-3 font-medium">Stops</th>
                    <th className="py-2 pr-3 font-medium">Accounts</th>
                    <th className="py-2 pr-3 font-medium">Span</th>
                    <th className="py-2 pr-3 font-medium">Booked</th>
                    <th className="py-2 font-medium">Idle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(data?.routes.days ?? []).slice(0, 100).map((day) => (
                    <tr key={`${day.day}:${day.technicianId}`}>
                      <td className="py-2.5 pr-3 text-foreground">
                        <button type="button" className="underline-offset-2 hover:underline" onClick={() => void openRows("route_day", `${day.day}|${day.technicianId}`, `the stops on ${day.day}`)}>
                          {day.day}
                        </button>
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">{day.stops}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">{day.accounts}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">{hours(day.spanMinutes)}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">{hours(day.bookedMinutes)}</td>
                      <td
                        className={cn(
                          "py-2.5 tabular-nums",
                          (day.idleMinutes ?? 0) >= 120 ? "text-amber-700" : "text-muted",
                        )}
                      >
                        {/* Null on a one-stop day: one stop has no gaps, and a
                            zero there would read as a full day. */}
                        {hours(day.idleMinutes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function Figure({ label, value, tone, onOpen }: { label: string; value: string; tone?: "amber" | "rose"; onOpen?: () => void }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <dt className="flex items-center gap-2 text-xs uppercase tracking-wide text-faint">
        <TrendingUp className="size-3.5" aria-hidden="true" />
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "rose" ? "text-rose-700" : tone === "amber" ? "text-amber-700" : "text-foreground",
        )}
      >
        {value}
      </dd>
      {onOpen ? (
        <button type="button" onClick={onOpen} className="mt-2 text-xs text-[var(--accent)] underline-offset-2 hover:underline" aria-label={`Open the rows behind ${label}`}>
          Open the rows
        </button>
      ) : null}
    </div>
  );
}
