"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, MapPinned, Users2 } from "lucide-react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import type {
  BranchesPayload,
  EmployeesPayload,
  TerritoriesPayload,
} from "@/components/services/types";
import { cn } from "@/lib/cn";

/**
 * The company: the branches a book of business is run out of, and the map
 * each one covers.
 *
 * Every number here is counted from the rows themselves — accounts served,
 * staff on the roster, technicians in the field — so the header cannot
 * disagree with the table beneath it. The two figures a manager actually
 * looks for are the uncomfortable ones, and they are shown rather than
 * hidden: how much of the book no branch serves, and how many territories
 * nobody works.
 */

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        tone,
      )}
    >
      {children}
    </span>
  );
}

export function ServicesCompanyPanel() {
  const [branches, setBranches] = useState<BranchesPayload | null>(null);
  const [territories, setTerritories] = useState<TerritoriesPayload | null>(null);
  const [employees, setEmployees] = useState<EmployeesPayload | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [tab, setTab] = useState<"branches" | "territories">("branches");

  const refresh = useCallback(async () => {
    try {
      const [branchesRes, territoriesRes, employeesRes] = await Promise.all([
        fetch("/api/services/branches", { headers: { accept: "application/json" } }),
        fetch("/api/services/territories", { headers: { accept: "application/json" } }),
        fetch("/api/services/employees", { headers: { accept: "application/json" } }),
      ]);
      const body = (await branchesRes.json()) as BranchesPayload & { error?: { message?: string } };
      if (!branchesRes.ok) {
        setListError(body.error?.message ?? "Branches could not be read.");
        return;
      }
      setListError(null);
      setBranches(body);
      if (territoriesRes.ok) setTerritories((await territoriesRes.json()) as TerritoriesPayload);
      if (employeesRes.ok) setEmployees((await employeesRes.json()) as EmployeesPayload);
    } catch {
      setListError("Branches could not be read.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  const personName = useMemo(() => {
    const map = new Map<string, string>();
    for (const employee of employees?.employees ?? []) {
      map.set(employee.id, `${employee.firstName} ${employee.lastName ?? ""}`.trim());
    }
    return map;
  }, [employees]);

  const branchName = useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branches?.branches ?? []) map.set(branch.id, branch.name);
    return map;
  }, [branches]);

  return (
    <div>
      <PageHeader
        title="Branches & Territories"
        description="The offices a book of business is run out of, the managers who run them, and the map each one covers. Nothing here is deletable — a branch that closes keeps its history."
      />

      {listError !== null ? <Notice tone="warning">{listError}</Notice> : null}

      <Card className="mb-6">
        <SectionTitle
          title="The operation"
          description="Counted from the rows themselves, including the parts nobody has claimed yet."
        />
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="services-company-figures">
          <Figure label="Branches" value={branches?.counts.active ?? null} icon={Building2} />
          <Figure label="Territories" value={territories?.counts.active ?? null} icon={MapPinned} />
          <Figure label="On the roster" value={employees?.counts.active ?? null} icon={Users2} />
          <Figure
            label="Unassigned accounts"
            value={branches?.counts.unassignedAccounts ?? null}
            icon={Building2}
            tone={(branches?.counts.unassignedAccounts ?? 0) > 0 ? "amber" : undefined}
          />
        </dl>
        {territories !== null && territories.counts.unworked > 0 ? (
          <p className="mt-3 text-xs text-amber-700">
            {territories.counts.unworked}{" "}
            {territories.counts.unworked === 1 ? "territory has" : "territories have"} no rep
            assigned.
          </p>
        ) : null}
      </Card>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Company records">
        {(
          [
            ["branches", "Branches", branches?.branches.length],
            ["territories", "Territories", territories?.territories.length],
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

      {tab === "branches" ? (
        <Card>
          <SectionTitle
            title="Branches"
            description="Each with the manager who runs it, the time zone its route sheets are read in, and what it carries."
          />
          {(branches?.branches ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted" data-testid="services-branches-empty">
              No branches yet. Add one, and the accounts, staff and technicians it serves report
              against it.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="services-branches-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Branch</th>
                    <th className="py-2 pr-3 font-medium">Manager</th>
                    <th className="py-2 pr-3 font-medium">Where</th>
                    <th className="py-2 pr-3 font-medium">Accounts</th>
                    <th className="py-2 pr-3 font-medium">Staff / techs</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(branches?.branches ?? []).slice(0, 100).map((branch) => (
                    <tr key={branch.id}>
                      <td className="py-2.5 pr-3">
                        <span className="block font-medium text-foreground">{branch.name}</span>
                        <span className="block font-mono text-xs text-faint">{branch.code}</span>
                      </td>
                      <td className="py-2.5 pr-3 text-muted">
                        {branch.managerId === null
                          ? "—"
                          : (personName.get(branch.managerId) ?? "—")}
                      </td>
                      <td className="py-2.5 pr-3 text-muted">
                        {branch.address ?? "—"}
                        <span className="block text-xs text-faint">{branch.timeZone ?? "no zone set"}</span>
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">{branch.accountCount}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">
                        {branch.staffCount} / {branch.technicianCount}
                      </td>
                      <td className="py-2.5">
                        {branch.active ? (
                          <Pill tone="border-emerald-200 bg-emerald-50 text-emerald-700">open</Pill>
                        ) : (
                          <>
                            <Pill tone="border-slate-200 bg-slate-100 text-slate-500">closed</Pill>
                            {branch.closedOn ? (
                              <span className="block text-xs text-faint">{branch.closedOn}</span>
                            ) : null}
                          </>
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

      {tab === "territories" ? (
        <Card>
          <SectionTitle
            title="Territories"
            description="A branch's slice of the map, worked by one rep, defined by the postal codes it covers."
          />
          {(territories?.territories ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted">No territories yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="services-territories-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Territory</th>
                    <th className="py-2 pr-3 font-medium">Branch</th>
                    <th className="py-2 pr-3 font-medium">Worked by</th>
                    <th className="py-2 pr-3 font-medium">Covers</th>
                    <th className="py-2 pr-3 font-medium">Accounts</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(territories?.territories ?? []).slice(0, 100).map((territory) => (
                    <tr key={territory.id}>
                      <td className="py-2.5 pr-3">
                        <span className="block font-medium text-foreground">{territory.name}</span>
                        <span className="block font-mono text-xs text-faint">{territory.code}</span>
                      </td>
                      <td className="py-2.5 pr-3 text-muted">
                        {branchName.get(territory.branchId) ?? "—"}
                      </td>
                      <td className="py-2.5 pr-3">
                        {territory.repId === null ? (
                          <span className="text-amber-700">unworked</span>
                        ) : (
                          <span className="text-foreground">{personName.get(territory.repId) ?? "—"}</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-muted">
                        {territory.city ?? "—"}
                        {territory.region ? `, ${territory.region}` : ""}
                        <span className="block font-mono text-xs text-faint">
                          {territory.postalCodes.slice(0, 4).join(" ")}
                          {territory.postalCodes.length > 4
                            ? ` +${territory.postalCodes.length - 4}`
                            : ""}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">{territory.accountCount}</td>
                      <td className="py-2.5">
                        {territory.active ? (
                          <Pill tone="border-emerald-200 bg-emerald-50 text-emerald-700">active</Pill>
                        ) : (
                          <Pill tone="border-slate-200 bg-slate-100 text-slate-500">retired</Pill>
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

function Figure({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number | null;
  icon: typeof Building2;
  tone?: "amber";
}) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <dt className="flex items-center gap-2 text-xs uppercase tracking-wide text-faint">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "amber" ? "text-amber-700" : "text-foreground",
        )}
      >
        {value === null ? "—" : value.toLocaleString("en-US")}
      </dd>
    </div>
  );
}
