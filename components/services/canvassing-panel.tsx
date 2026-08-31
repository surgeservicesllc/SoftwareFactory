"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DoorOpen } from "lucide-react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import type { CanvassingPayload, EmployeesPayload, TerritoriesPayload } from "@/components/services/types";
import { cn } from "@/lib/cn";

/**
 * Canvassing: a rep walking a territory on a day, and what happened at each
 * door.
 *
 * A knock is append-only — the schema grants insert and select and nothing
 * else — so a disposition cannot be improved after the door closed. The
 * page says so, because a canvasser who thinks a number can be edited later
 * records a different number today.
 *
 * "Productive" counts callbacks, appointments and sales. Counting "no
 * answer" alongside them would flatter every route on the board.
 */

const DISPOSITION_TONES: Record<string, string> = {
  sold: "border-emerald-200 bg-emerald-50 text-emerald-700",
  appointment_set: "border-sky-200 bg-sky-50 text-sky-700",
  callback: "border-violet-200 bg-violet-50 text-violet-700",
  not_interested: "border-slate-200 bg-slate-50 text-slate-600",
  no_answer: "border-slate-200 bg-slate-50 text-slate-500",
  not_home: "border-slate-200 bg-slate-50 text-slate-500",
  do_not_knock: "border-rose-200 bg-rose-50 text-rose-700",
};

const STATUS_TONES: Record<string, string> = {
  planned: "border-slate-200 bg-slate-50 text-slate-600",
  walking: "border-sky-200 bg-sky-50 text-sky-700",
  complete: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-rose-200 bg-rose-50 text-rose-700",
};

export function ServicesCanvassingPanel() {
  const [board, setBoard] = useState<CanvassingPayload | null>(null);
  const [territories, setTerritories] = useState<TerritoriesPayload | null>(null);
  const [employees, setEmployees] = useState<EmployeesPayload | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [boardRes, territoriesRes, employeesRes] = await Promise.all([
        fetch("/api/services/canvassing", { headers: { accept: "application/json" } }),
        fetch("/api/services/territories", { headers: { accept: "application/json" } }),
        fetch("/api/services/employees", { headers: { accept: "application/json" } }),
      ]);
      const body = (await boardRes.json()) as CanvassingPayload & { error?: { message?: string } };
      if (!boardRes.ok) {
        setListError(body.error?.message ?? "Canvassing could not be read.");
        return;
      }
      setListError(null);
      setBoard(body);
      if (territoriesRes.ok) setTerritories((await territoriesRes.json()) as TerritoriesPayload);
      if (employeesRes.ok) setEmployees((await employeesRes.json()) as EmployeesPayload);
    } catch {
      setListError("Canvassing could not be read.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  const territoryName = useMemo(() => {
    const map = new Map<string, string>();
    for (const territory of territories?.territories ?? []) map.set(territory.id, territory.name);
    return map;
  }, [territories]);

  const repName = useMemo(() => {
    const map = new Map<string, string>();
    for (const employee of employees?.employees ?? []) {
      map.set(employee.id, `${employee.firstName} ${employee.lastName ?? ""}`.trim());
    }
    return map;
  }, [employees]);

  return (
    <div>
      <PageHeader
        title="Canvassing"
        description="Door-to-door routes and what happened at each door. A knock is append-only: the disposition recorded at the door is the one that stays on the record."
      />

      {listError !== null ? <Notice tone="warning">{listError}</Notice> : null}

      <Card className="mb-6">
        <SectionTitle
          title="Doors"
          description="Productive means a callback, an appointment or a sale — the other outcomes are counted apart rather than folded in."
        />
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="services-canvassing-figures">
          <Figure label="Routes" value={board === null ? "—" : String(board.counts.routes)} />
          <Figure label="Doors knocked" value={board === null ? "—" : board.counts.knocks.toLocaleString("en-US")} />
          <Figure
            label="Productive"
            value={board === null ? "—" : `${board.counts.productive.toLocaleString("en-US")}`}
            tone="emerald"
          />
          <Figure
            label="Productive rate"
            value={
              board === null || board.counts.productiveRate === null
                ? "no doors yet"
                : `${board.counts.productiveRate}%`
            }
          />
        </dl>
        {board !== null && board.counts.sold > 0 ? (
          <p className="mt-3 text-xs text-faint">
            {board.counts.sold} {board.counts.sold === 1 ? "door" : "doors"} became a customer, and
            each names the account it produced — the schema will not hold one that does not.
          </p>
        ) : null}
      </Card>

      <Card className="mb-6">
        <SectionTitle title="Routes" description="A rep, a territory, a day." />
        {(board?.routes ?? []).length === 0 ? (
          <p className="mt-4 text-sm text-muted" data-testid="services-canvassing-empty">
            No routes yet. Plan one against a territory, and every door walked on it reports here.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="services-canvass-routes-table">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                  <th className="py-2 pr-3 font-medium">Route</th>
                  <th className="py-2 pr-3 font-medium">Territory</th>
                  <th className="py-2 pr-3 font-medium">Rep</th>
                  <th className="py-2 pr-3 font-medium">Walked</th>
                  <th className="py-2 pr-3 font-medium">Doors</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(board?.routes ?? []).slice(0, 100).map((route) => (
                  <tr key={route.id}>
                    <td className="py-2.5 pr-3 font-medium text-foreground">{route.name}</td>
                    <td className="py-2.5 pr-3 text-muted">
                      {route.territoryId === null ? "—" : (territoryName.get(route.territoryId) ?? "—")}
                    </td>
                    <td className="py-2.5 pr-3 text-muted">
                      {route.repId === null ? "—" : (repName.get(route.repId) ?? "—")}
                    </td>
                    <td className="py-2.5 pr-3 text-muted">{route.walkedOn}</td>
                    <td className="py-2.5 pr-3 tabular-nums text-muted">
                      {route.knockCount}
                      <span className="block text-xs text-emerald-700">
                        {route.productiveCount} productive
                      </span>
                    </td>
                    <td className="py-2.5">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                          STATUS_TONES[route.status] ?? STATUS_TONES.planned,
                        )}
                      >
                        {route.status}
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
          title="Recent doors"
          description="Append-only. There is no edit here and no grant that would allow one."
        />
        {(board?.knocks ?? []).length === 0 ? (
          <p className="mt-4 text-sm text-muted">No doors recorded yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="services-knocks-table">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                  <th className="py-2 pr-3 font-medium">Knocked</th>
                  <th className="py-2 pr-3 font-medium">Address</th>
                  <th className="py-2 pr-3 font-medium">Outcome</th>
                  <th className="py-2 font-medium">Follow-up</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(board?.knocks ?? []).slice(0, 100).map((knock) => (
                  <tr key={knock.id}>
                    <td className="py-2.5 pr-3 text-muted">{knock.knockedAt.slice(0, 10)}</td>
                    <td className="py-2.5 pr-3 text-foreground">
                      {knock.address}
                      {knock.note ? (
                        <span className="block text-xs text-faint">{knock.note}</span>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                          DISPOSITION_TONES[knock.disposition] ?? DISPOSITION_TONES.no_answer,
                        )}
                      >
                        {knock.disposition.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="py-2.5 text-muted">{knock.followUpOn ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "emerald" }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <dt className="flex items-center gap-2 text-xs uppercase tracking-wide text-faint">
        <DoorOpen className="size-3.5" aria-hidden="true" />
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "emerald" ? "text-emerald-700" : "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
