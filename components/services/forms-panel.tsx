"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardCheck } from "lucide-react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { FormAnswerSheet } from "@/components/services/form-answer-sheet";
import { FormTemplateBuilder } from "@/components/services/form-template-builder";
import type { FormsPayload, LicencesPayload, TimesheetsPayload } from "@/components/services/types";
import { cn } from "@/lib/cn";
import { describeCondition } from "@/lib/services/form-conditions";

/**
 * Forms, timesheets and licences.
 *
 * Three numbers on this page are deliberately uncomfortable and none of
 * them is rounded away. Completed forms nobody signed, because that is the
 * first thing an auditor asks for. Shifts still running, counted apart from
 * finished ones, because an open shift has no worked total and averaging it
 * in as zero would understate every technician. And licences with no expiry
 * on file, which are reported as unrecorded rather than folded into
 * "current" — an unknown is not a pass.
 */

const STATUS_TONES: Record<string, string> = {
  assigned: "border-slate-200 bg-slate-50 text-slate-600",
  in_progress: "border-sky-200 bg-sky-50 text-sky-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  void: "border-slate-200 bg-slate-100 text-slate-500",
};

const LICENCE_TONES: Record<string, string> = {
  current: "border-emerald-200 bg-emerald-50 text-emerald-700",
  expiring: "border-amber-200 bg-amber-50 text-amber-700",
  expired: "border-rose-200 bg-rose-50 text-rose-700",
  unrecorded: "border-violet-200 bg-violet-50 text-violet-700",
  none: "border-slate-200 bg-slate-50 text-slate-500",
};

type Tab = "forms" | "templates" | "timesheets" | "licences";

export function ServicesFormsPanel() {
  const [forms, setForms] = useState<FormsPayload | null>(null);
  const [shifts, setShifts] = useState<TimesheetsPayload | null>(null);
  const [licences, setLicences] = useState<LicencesPayload | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("forms");
  const [openInstance, setOpenInstance] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [formsRes, shiftsRes, licencesRes] = await Promise.all([
        fetch("/api/services/forms", { headers: { accept: "application/json" } }),
        fetch("/api/services/timesheets", { headers: { accept: "application/json" } }),
        fetch("/api/services/licences", { headers: { accept: "application/json" } }),
      ]);
      const body = (await formsRes.json()) as FormsPayload & { error?: { message?: string } };
      if (!formsRes.ok) {
        setListError(body.error?.message ?? "Forms could not be read.");
        return;
      }
      setListError(null);
      setForms(body);
      if (shiftsRes.ok) setShifts((await shiftsRes.json()) as TimesheetsPayload);
      if (licencesRes.ok) setLicences((await licencesRes.json()) as LicencesPayload);
    } catch {
      setListError("Forms could not be read.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  const templateName = useMemo(() => {
    const map = new Map<string, string>();
    for (const template of forms?.templates ?? []) {
      map.set(template.id, `${template.name} v${template.version}`);
    }
    return map;
  }, [forms]);

  return (
    <div>
      <PageHeader
        title="Forms & Compliance"
        description="Inspections, service reports and checklists — assigned, answered, signed and completed. A form is complete only when every required question is answered; the database counts them."
      />

      {listError !== null ? <Notice tone="warning">{listError}</Notice> : null}

      <Card className="mb-6">
        <SectionTitle
          title="What is outstanding"
          description="The uncomfortable figures are the point of this row, so none of them is rounded away."
        />
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="services-forms-figures">
          <Figure label="Assigned" value={forms === null ? "—" : String(forms.counts.assigned)} />
          <Figure label="In progress" value={forms === null ? "—" : String(forms.counts.inProgress)} />
          <Figure
            label="Completed, unsigned"
            value={forms === null ? "—" : String(forms.counts.completedUnsigned)}
            tone={(forms?.counts.completedUnsigned ?? 0) > 0 ? "amber" : undefined}
          />
          <Figure
            label="Licences expired"
            value={licences === null ? "—" : String(licences.counts.expired)}
            tone={(licences?.counts.expired ?? 0) > 0 ? "rose" : undefined}
          />
        </dl>
      </Card>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Forms and compliance">
        {(
          [
            ["forms", "Forms", forms?.instances.length],
            ["templates", "Templates", forms?.templates.length],
            ["timesheets", "Timesheets", shifts?.shifts.length],
            ["licences", "Licences", licences?.technicians.length],
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

      {tab === "forms" ? (
        <Card>
          <SectionTitle
            title="Forms"
            description="Each one assigned against a customer, a site or a visit. A completed form has answered every required question — that is arithmetic the database does, not a status somebody set."
          />
          {(forms?.instances ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted" data-testid="services-forms-empty">
              No forms yet. Publish a template, assign it to a visit, and it appears here the moment
              a technician submits it.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="services-form-instances-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Form</th>
                    <th className="py-2 pr-3 font-medium">Assigned</th>
                    <th className="py-2 pr-3 font-medium">Completed</th>
                    <th className="py-2 pr-3 font-medium">Signature</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 font-medium">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(forms?.instances ?? []).slice(0, 100).map((instance) => (
                    <tr key={instance.id}>
                      <td className="py-2.5 pr-3 text-foreground">
                        {templateName.get(instance.templateId) ?? "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-muted">{instance.assignedAt.slice(0, 10)}</td>
                      <td className="py-2.5 pr-3 text-muted">
                        {instance.completedAt === null ? "—" : instance.completedAt.slice(0, 10)}
                      </td>
                      <td className="py-2.5 pr-3 text-muted">
                        {instance.signed ? (
                          instance.signedByName
                        ) : instance.status === "completed" ? (
                          <span className="text-amber-700">unsigned</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2.5">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                            STATUS_TONES[instance.status] ?? STATUS_TONES.assigned,
                          )}
                        >
                          {instance.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="py-2.5">
                        <button
                          type="button"
                          className="btn btn-secondary px-2.5 py-1 text-xs"
                          onClick={() => setOpenInstance((current) => (current === instance.id ? null : instance.id))}
                          aria-expanded={openInstance === instance.id}
                          data-testid={`services-form-open-${instance.id}`}
                        >
                          {openInstance === instance.id ? "Close" : instance.status === "completed" ? "Read" : "Answer"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {openInstance !== null ? (
            <FormAnswerSheet key={openInstance} instanceId={openInstance} onChanged={() => void refresh()} />
          ) : null}
        </Card>
      ) : null}

      {tab === "templates" ? (
        <Card>
          <SectionTitle
            title="Templates"
            description="A template with forms assigned from it is versioned rather than edited — a report whose questions changed underneath it is not a report. A question can be asked only when an earlier one was answered a certain way; a service type named on a template gets it on every new visit."
          />
          <button
            type="button"
            className="btn btn-primary mt-3 px-3 py-1.5 text-xs"
            onClick={() => setBuilding((current) => !current)}
            data-testid="services-forms-new-template"
          >
            {building ? "Close" : "New form"}
          </button>
          {building ? (
            <FormTemplateBuilder
              onCreated={() => {
                setBuilding(false);
                void refresh();
              }}
              onClose={() => setBuilding(false)}
            />
          ) : null}
          {(forms?.templates ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted">No templates yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="services-form-templates-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Template</th>
                    <th className="py-2 pr-3 font-medium">Kind</th>
                    <th className="py-2 pr-3 font-medium">Questions</th>
                    <th className="py-2 pr-3 font-medium">Required</th>
                    <th className="py-2 font-medium">Editing</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(forms?.templates ?? []).slice(0, 100).map((template) => (
                    <tr key={template.id}>
                      <td className="py-2.5 pr-3">
                        <span className="block font-medium text-foreground">{template.name}</span>
                        <span className="block text-xs text-faint">
                          version {template.version}
                          {template.active ? "" : " · retired"}
                          {template.triggerServiceTypes.length > 0
                            ? ` · assigned to new ${template.triggerServiceTypes.join(", ")} visits`
                            : ""}
                        </span>
                        {template.fields.some((field) => field.showWhen !== null) ? (
                          <ul className="mt-1 text-xs text-muted" data-testid={`services-form-conditions-${template.id}`}>
                            {template.fields
                              .filter((field) => field.showWhen !== null && field.dependsOnFieldId !== null)
                              .map((field) => {
                                const parent = template.fields.find((entry) => entry.id === field.dependsOnFieldId);
                                return (
                                  <li key={field.id}>
                                    “{field.label}” {field.showWhen !== null && parent !== undefined ? describeCondition(field.showWhen, parent.label) : ""}
                                  </li>
                                );
                              })}
                          </ul>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-3 text-muted">{template.kind.replace(/_/g, " ")}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">{template.fields.length}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">
                        {template.fields.filter((field) => field.required).length}
                      </td>
                      <td className="py-2.5 text-muted">
                        {template.inUse ? (
                          <span className="text-xs text-amber-700">
                            in use — publish a new version
                          </span>
                        ) : (
                          <span className="text-xs text-faint">open</span>
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

      {tab === "timesheets" ? (
        <Card>
          <SectionTitle
            title="Timesheets"
            description="A running shift reports no worked total — treating it as finished would inflate every figure built on it. A technician cannot hold two shifts over the same hour."
          />
          {(shifts?.shifts ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted">No shifts recorded yet.</p>
          ) : (
            <>
              <p className="mt-3 text-xs text-faint">
                {shifts?.counts.running ?? 0} still running ·{" "}
                {Math.round((shifts?.counts.workedMinutes ?? 0) / 60).toLocaleString("en-US")} hours
                worked across the finished ones.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm" data-testid="services-timesheets-table">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                      <th className="py-2 pr-3 font-medium">Started</th>
                      <th className="py-2 pr-3 font-medium">Ended</th>
                      <th className="py-2 pr-3 font-medium">Break</th>
                      <th className="py-2 font-medium">Worked</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {(shifts?.shifts ?? []).slice(0, 100).map((shift) => (
                      <tr key={shift.id}>
                        <td className="py-2.5 pr-3 text-muted">
                          {shift.startedAt.slice(0, 16).replace("T", " ")}
                        </td>
                        <td className="py-2.5 pr-3 text-muted">
                          {shift.endedAt === null ? (
                            <span className="text-sky-700">still running</span>
                          ) : (
                            shift.endedAt.slice(0, 16).replace("T", " ")
                          )}
                        </td>
                        <td className="py-2.5 pr-3 tabular-nums text-muted">{shift.breakMinutes}m</td>
                        <td className="py-2.5 tabular-nums text-foreground">
                          {shift.workedMinutes === null
                            ? "—"
                            : `${Math.floor(shift.workedMinutes / 60)}h ${shift.workedMinutes % 60}m`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      ) : null}

      {tab === "licences" ? (
        <Card>
          <SectionTitle
            title="Applicator licences"
            description="Expired, expiring within sixty days, current — and unrecorded. A licence with no expiry on file is not a current licence; it is an unknown, and it is counted as one."
          />
          {licences !== null ? (
            <p className="mt-3 text-xs text-faint">
              {licences.counts.current} current · {licences.counts.expiring} expiring ·{" "}
              <span className="text-rose-700">{licences.counts.expired} expired</span> ·{" "}
              <span className="text-violet-700">{licences.counts.unrecorded} unrecorded</span> ·{" "}
              {licences.counts.noLicence} with no licence on file
            </p>
          ) : null}
          {(licences?.technicians ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted">No technicians on the roster.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="services-licences-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Technician</th>
                    <th className="py-2 pr-3 font-medium">Licence</th>
                    <th className="py-2 pr-3 font-medium">Expires</th>
                    <th className="py-2 font-medium">Standing</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(licences?.technicians ?? [])
                    .filter((technician) => technician.active)
                    .slice(0, 100)
                    .map((technician) => (
                      <tr key={technician.id}>
                        <td className="py-2.5 pr-3 text-foreground">
                          {technician.firstName} {technician.lastName ?? ""}
                        </td>
                        <td className="py-2.5 pr-3 font-mono text-xs text-muted">
                          {technician.licenseNumber ?? "none on file"}
                          {technician.licenseState ? ` · ${technician.licenseState}` : ""}
                        </td>
                        <td className="py-2.5 pr-3 text-muted">
                          {technician.licenseExpiresOn ?? "—"}
                          {technician.daysRemaining !== null ? (
                            <span className="block text-xs text-faint">
                              {technician.daysRemaining < 0
                                ? `${Math.abs(technician.daysRemaining)} days ago`
                                : `in ${technician.daysRemaining} days`}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2.5">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                              LICENCE_TONES[technician.state] ?? LICENCE_TONES.none,
                            )}
                          >
                            {technician.state}
                          </span>
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
    <div className="rounded-xl border border-line bg-surface p-4">
      <dt className="flex items-center gap-2 text-xs uppercase tracking-wide text-faint">
        <ClipboardCheck className="size-3.5" aria-hidden="true" />
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
