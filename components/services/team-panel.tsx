"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HardHat, UserRound } from "lucide-react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import type {
  BranchesPayload,
  EmployeesPayload,
  TechniciansPayload,
} from "@/components/services/types";
import { cn } from "@/lib/cn";

/**
 * The team: the org chart and the field roster, side by side.
 *
 * Two tables rather than one, because they are two different things. An
 * employee is a person in the business — a manager, a rep, dispatch — and
 * may never sign in. A technician is someone a work order can be assigned
 * to, carrying a licence and a service history. Both now sit in a branch
 * and report to someone, which is the whole point of this page.
 *
 * Nobody is deletable. Someone who leaves is ended, and their commissions,
 * assignments and signatures stay attached to them.
 */

const ROLE_TONES: Record<string, string> = {
  owner: "border-violet-200 bg-violet-50 text-violet-700",
  branch_manager: "border-sky-200 bg-sky-50 text-sky-700",
  sales_manager: "border-indigo-200 bg-indigo-50 text-indigo-700",
  sales_rep: "border-emerald-200 bg-emerald-50 text-emerald-700",
  csr: "border-amber-200 bg-amber-50 text-amber-700",
  dispatcher: "border-orange-200 bg-orange-50 text-orange-700",
  admin: "border-slate-200 bg-slate-50 text-slate-600",
};

function roleLabel(role: string): string {
  return role.replace(/_/g, " ");
}

export function ServicesTeamPanel() {
  const [employees, setEmployees] = useState<EmployeesPayload | null>(null);
  const [technicians, setTechnicians] = useState<TechniciansPayload | null>(null);
  const [branches, setBranches] = useState<BranchesPayload | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [employeesRes, techniciansRes, branchesRes] = await Promise.all([
        fetch("/api/services/employees", { headers: { accept: "application/json" } }),
        fetch("/api/services/technicians", { headers: { accept: "application/json" } }),
        fetch("/api/services/branches", { headers: { accept: "application/json" } }),
      ]);
      const body = (await employeesRes.json()) as EmployeesPayload & { error?: { message?: string } };
      if (!employeesRes.ok) {
        setListError(body.error?.message ?? "The team could not be read.");
        return;
      }
      setListError(null);
      setEmployees(body);
      if (techniciansRes.ok) setTechnicians((await techniciansRes.json()) as TechniciansPayload);
      if (branchesRes.ok) setBranches((await branchesRes.json()) as BranchesPayload);
    } catch {
      setListError("The team could not be read.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  const branchName = useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branches?.branches ?? []) map.set(branch.id, branch.name);
    return map;
  }, [branches]);

  const personName = useMemo(() => {
    const map = new Map<string, string>();
    for (const employee of employees?.employees ?? []) {
      map.set(employee.id, `${employee.firstName} ${employee.lastName ?? ""}`.trim());
    }
    return map;
  }, [employees]);

  const visibleEmployees = useMemo(
    () =>
      (employees?.employees ?? []).filter(
        (employee) =>
          (branchFilter === "" || employee.branchId === branchFilter)
          && (roleFilter === "" || employee.role === roleFilter),
      ),
    [employees, branchFilter, roleFilter],
  );

  const visibleTechnicians = useMemo(
    () =>
      (technicians?.technicians ?? []).filter(
        (technician) => branchFilter === "" || technician.branchId === branchFilter,
      ),
    [technicians, branchFilter],
  );

  return (
    <div>
      <PageHeader
        title="Team"
        description="The org chart and the field roster. Everyone sits in a branch and reports to someone; nobody is deletable, because commissions, assignments and signatures hang off a person."
      />

      {listError !== null ? <Notice tone="warning">{listError}</Notice> : null}

      <Card className="mb-6">
        <SectionTitle title="Who works here" description="Filter the whole page by branch or role." />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm">
            <span className="text-muted">Branch</span>
            <select
              value={branchFilter}
              onChange={(event) => setBranchFilter(event.target.value)}
              className="input mt-1 w-full"
            >
              <option value="">Every branch</option>
              {(branches?.branches ?? []).map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-muted">Role</span>
            <select
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
              className="input mt-1 w-full"
            >
              <option value="">Every role</option>
              {Object.keys(employees?.counts.byRole ?? {})
                .sort()
                .map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
            </select>
          </label>
          <div className="rounded-xl border border-line bg-white p-4">
            <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-faint">
              <UserRound className="size-3.5" aria-hidden="true" />
              Org chart
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {employees?.counts.active ?? "—"}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-white p-4">
            <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-faint">
              <HardHat className="size-3.5" aria-hidden="true" />
              Field roster
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {technicians === null
                ? "—"
                : technicians.technicians.filter((technician) => technician.active).length}
            </p>
          </div>
        </div>
      </Card>

      <Card className="mb-6">
        <SectionTitle
          title="Org chart"
          description="Owners, managers, sales, customer service, dispatch and admin — with the branch each one sits in and the person they report to."
        />
        {visibleEmployees.length === 0 ? (
          <p className="mt-4 text-sm text-muted" data-testid="services-team-empty">
            Nobody on the roster matches. Add a team member, and they can own accounts, work a
            territory and earn commission.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="services-employees-table">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                  <th className="py-2 pr-3 font-medium">Person</th>
                  <th className="py-2 pr-3 font-medium">Role</th>
                  <th className="py-2 pr-3 font-medium">Branch</th>
                  <th className="py-2 pr-3 font-medium">Reports to</th>
                  <th className="py-2 pr-3 font-medium">Commission</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visibleEmployees.slice(0, 150).map((employee) => (
                  <tr key={employee.id}>
                    <td className="py-2.5 pr-3">
                      <span className="block font-medium text-foreground">
                        {employee.firstName} {employee.lastName ?? ""}
                      </span>
                      <span className="block font-mono text-xs text-faint">
                        {employee.employeeCode}
                        {employee.hasLogin ? " · has a login" : ""}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize",
                          ROLE_TONES[employee.role] ?? ROLE_TONES.admin,
                        )}
                      >
                        {roleLabel(employee.role)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-muted">
                      {employee.branchId === null ? "—" : (branchName.get(employee.branchId) ?? "—")}
                    </td>
                    <td className="py-2.5 pr-3 text-muted">
                      {employee.reportsToId === null
                        ? "—"
                        : (personName.get(employee.reportsToId) ?? "—")}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums text-muted">
                      {employee.commissionBps === null
                        ? "—"
                        : `${(employee.commissionBps / 100).toFixed(2)}%`}
                    </td>
                    <td className="py-2.5">
                      {employee.active ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                          active
                        </span>
                      ) : (
                        <>
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">
                            ended
                          </span>
                          {employee.endDate ? (
                            <span className="block text-xs text-faint">{employee.endDate}</span>
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

      <Card>
        <SectionTitle
          title="Field roster"
          description="The technicians a work order can be assigned to — now with the branch they run out of and the manager they answer to."
        />
        {visibleTechnicians.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No technicians match this filter.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="services-roster-table">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                  <th className="py-2 pr-3 font-medium">Technician</th>
                  <th className="py-2 pr-3 font-medium">Licence</th>
                  <th className="py-2 pr-3 font-medium">Branch</th>
                  <th className="py-2 pr-3 font-medium">Reports to</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visibleTechnicians.slice(0, 150).map((technician) => (
                  <tr key={technician.id}>
                    <td className="py-2.5 pr-3">
                      <span className="block font-medium text-foreground">
                        {technician.firstName} {technician.lastName ?? ""}
                      </span>
                      <span className="block text-xs text-faint">{technician.email ?? "—"}</span>
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-xs text-muted">
                      {technician.licenseNumber ?? "none recorded"}
                    </td>
                    <td className="py-2.5 pr-3 text-muted">
                      {technician.branchId == null
                        ? "—"
                        : (branchName.get(technician.branchId) ?? "—")}
                    </td>
                    <td className="py-2.5 pr-3 text-muted">
                      {technician.reportsToId == null
                        ? "—"
                        : (personName.get(technician.reportsToId) ?? "—")}
                    </td>
                    <td className="py-2.5">
                      {technician.active ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                          active
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">
                          inactive
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
    </div>
  );
}
