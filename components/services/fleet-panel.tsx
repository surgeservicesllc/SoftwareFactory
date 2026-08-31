"use client";

import { useCallback, useEffect, useState } from "react";
import { Truck } from "lucide-react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import type { FleetPayload } from "@/components/services/types";
import { cn } from "@/lib/cn";

/**
 * The fleet: trucks, sprayers, meters and the rest of the kit.
 *
 * Nothing on this page sets an asset's status or who holds it. Those are
 * projections of the equipment ledger, so the way to move a truck is to
 * record what happened to it — a repair opened, a transfer, a reading. A
 * control that wrote `status` directly would let the roster disagree with
 * its own history.
 *
 * Two counts here are deliberately kept out of "everything is fine".
 * **Unscheduled** assets have no service interval on file, so they have not
 * been judged at all; folding them into "ok" is how a fleet report starts
 * claiming health it never measured. **Unassigned** is kit on the roster
 * that nobody is carrying, which is what a yard walk is actually for.
 */

const STANDING_TONES: Record<string, string> = {
  overdue: "border-rose-200 bg-rose-50 text-rose-700",
  due_soon: "border-amber-200 bg-amber-50 text-amber-700",
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
  unscheduled: "border-violet-200 bg-violet-50 text-violet-700",
};

const STATUS_TONES: Record<string, string> = {
  in_service: "border-emerald-200 bg-emerald-50 text-emerald-700",
  in_repair: "border-amber-200 bg-amber-50 text-amber-700",
  out_of_service: "border-slate-200 bg-slate-100 text-slate-600",
  retired: "border-slate-200 bg-slate-100 text-slate-500",
};

type Tab = "roster" | "ledger";

export function ServicesFleetPanel() {
  const [data, setData] = useState<FleetPayload | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("roster");
  const [readingFor, setReadingFor] = useState<string | null>(null);
  const [reading, setReading] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/services/equipment", {
        headers: { accept: "application/json" },
      });
      const body = (await response.json()) as FleetPayload & { error?: { message?: string } };
      if (!response.ok) {
        setListError(body.error?.message ?? "The fleet could not be read.");
        return;
      }
      setListError(null);
      setData(body);
    } catch {
      setListError("The fleet could not be read.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  const record = useCallback(
    async (equipmentId: string, kind: string, meterReading?: number) => {
      setBusy(true);
      setActionError(null);
      try {
        const response = await fetch("/api/services/equipment", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            equipmentId,
            kind,
            ...(meterReading === undefined ? {} : { meterReading }),
          }),
        });
        if (!response.ok) {
          const body = (await response.json()) as { error?: { message?: string } };
          // A backwards meter comes back with both readings in it. That is
          // the message a technician needs, so it is shown as sent.
          setActionError(body.error?.message ?? "That could not be recorded.");
          return;
        }
        setReadingFor(null);
        setReading("");
        await refresh();
      } catch {
        setActionError("That could not be recorded.");
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return (
    <div>
      <PageHeader
        title="Equipment & Fleet"
        description="Trucks, sprayers, meters and the rest of the kit — where each one is, when it was last serviced, and what has happened to it."
      />

      {listError !== null ? <Notice tone="warning">{listError}</Notice> : null}
      {actionError !== null ? <Notice tone="warning">{actionError}</Notice> : null}

      <Card className="mb-6">
        <SectionTitle
          title="What needs attention"
          description="Unscheduled is counted apart from ok on purpose: an asset with no service interval on file has not been judged, and calling it fine would be claiming health nobody measured."
        />
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="services-fleet-figures">
          <Figure
            label="Service overdue"
            value={data === null ? "—" : String(data.counts.overdue)}
            tone={(data?.counts.overdue ?? 0) > 0 ? "rose" : undefined}
          />
          <Figure
            label="Due within 14 days"
            value={data === null ? "—" : String(data.counts.dueSoon)}
            tone={(data?.counts.dueSoon ?? 0) > 0 ? "amber" : undefined}
          />
          <Figure
            label="No schedule on file"
            value={data === null ? "—" : String(data.counts.unscheduled)}
            tone={(data?.counts.unscheduled ?? 0) > 0 ? "amber" : undefined}
          />
          <Figure
            label="Assigned to nobody"
            value={data === null ? "—" : String(data.counts.unassigned)}
            tone={(data?.counts.unassigned ?? 0) > 0 ? "amber" : undefined}
          />
        </dl>
        <Notice tone="info">
          GPS and fleet telemetry are <strong>{data?.telemetry.label ?? "Not Connected"}</strong> — no
          provider is configured, so location and live engine data are absent rather than estimated.
          Everything here comes from what somebody recorded.
        </Notice>
      </Card>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Fleet">
        {(
          [
            ["roster", "Roster", data?.fleet.length],
            ["ledger", "Ledger", data?.events.length],
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

      {tab === "roster" ? (
        <Card>
          <SectionTitle
            title="Roster"
            description="Status and who holds each asset are read from the ledger, not set here. To move something, record what happened to it."
          />
          {(data?.fleet ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted" data-testid="services-fleet-empty">
              No equipment yet. Add a truck or a sprayer and every service, transfer and reading
              against it is kept from that moment on.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="services-fleet-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Tag</th>
                    <th className="py-2 pr-3 font-medium">Asset</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Meter</th>
                    <th className="py-2 pr-3 font-medium">Service</th>
                    <th className="py-2 font-medium">Record</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(data?.fleet ?? []).slice(0, 200).map((asset) => (
                    <tr key={asset.equipmentId}>
                      <td className="py-2.5 pr-3 text-foreground">{asset.assetTag}</td>
                      <td className="py-2.5 pr-3 text-muted">
                        {asset.name}
                        <span className="ml-1.5 text-xs text-faint">{asset.kind.replace(/_/g, " ")}</span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                            STATUS_TONES[asset.status] ?? STATUS_TONES.in_service,
                          )}
                        >
                          {asset.status.replace(/_/g, " ")}
                        </span>
                        {asset.unassigned ? (
                          <span className="ml-1.5 text-xs text-amber-700">unassigned</span>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">
                        {asset.meterReading === null
                          ? "—"
                          : `${asset.meterReading.toLocaleString()} ${asset.meterUnit ?? ""}`}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                            STANDING_TONES[asset.standing] ?? STANDING_TONES.unscheduled,
                          )}
                        >
                          {asset.standing === "unscheduled"
                            ? "no schedule"
                            : asset.standing === "overdue"
                              ? `${Math.abs(asset.daysUntilService ?? 0)}d overdue`
                              : `${asset.daysUntilService}d`}
                        </span>
                      </td>
                      <td className="py-2.5">
                        {asset.status === "retired" ? (
                          <span className="text-xs text-faint">closed</span>
                        ) : readingFor === asset.equipmentId ? (
                          <span className="flex flex-col gap-1">
                            <input
                              value={reading}
                              onChange={(event) => setReading(event.target.value)}
                              inputMode="decimal"
                              aria-label={`Meter reading for ${asset.assetTag}`}
                              className="w-28 rounded-lg border border-line px-2 py-1 text-xs"
                            />
                            <span className="flex gap-1">
                              <button
                                type="button"
                                disabled={busy || Number.isNaN(Number(reading)) || reading.trim() === ""}
                                onClick={() =>
                                  void record(asset.equipmentId, "meter_reading", Number(reading))
                                }
                                className="btn btn-primary px-2 py-0.5 text-xs"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setReadingFor(null);
                                  setReading("");
                                }}
                                className="btn btn-secondary px-2 py-0.5 text-xs"
                              >
                                Cancel
                              </button>
                            </span>
                          </span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setReadingFor(asset.equipmentId);
                                setReading("");
                              }}
                              className="btn btn-secondary px-2 py-0.5 text-xs"
                            >
                              Meter
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void record(asset.equipmentId, "service")}
                              className="btn btn-secondary px-2 py-0.5 text-xs"
                            >
                              Serviced
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void record(
                                  asset.equipmentId,
                                  asset.status === "in_repair" ? "repair_closed" : "repair_opened",
                                )
                              }
                              className="btn btn-secondary px-2 py-0.5 text-xs"
                            >
                              {asset.status === "in_repair" ? "Back in service" : "Into repair"}
                            </button>
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

      {tab === "ledger" ? (
        <Card>
          <SectionTitle
            title="Equipment ledger"
            description="Append-only. An asset's status is a reading of this, which is why a mistake is corrected by recording what actually happened rather than by editing the past."
          />
          {(data?.events ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted" data-testid="services-fleet-ledger-empty">
              Nothing recorded yet.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="services-fleet-ledger-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">When</th>
                    <th className="py-2 pr-3 font-medium">Event</th>
                    <th className="py-2 pr-3 font-medium">Meter</th>
                    <th className="py-2 pr-3 font-medium">Cost</th>
                    <th className="py-2 font-medium">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(data?.events ?? []).slice(0, 200).map((event) => (
                    <tr key={event.id}>
                      <td className="py-2.5 pr-3 text-muted">{event.occurredAt.slice(0, 10)}</td>
                      <td className="py-2.5 pr-3 text-foreground">{event.kind.replace(/_/g, " ")}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">
                        {event.meterReading === null ? "—" : event.meterReading.toLocaleString()}
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">
                        {event.costCents === null ? "—" : `$${(event.costCents / 100).toLocaleString()}`}
                      </td>
                      <td className="py-2.5 text-muted">
                        {event.note ?? "—"}
                        {event.vendor === null ? null : (
                          <span className="ml-1.5 text-xs text-faint">{event.vendor}</span>
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
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "amber" | "rose" }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <dt className="flex items-center gap-2 text-xs uppercase tracking-wide text-faint">
        <Truck className="size-3.5" aria-hidden="true" />
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
    </div>
  );
}
