"use client";

import { Archive, Loader2, ScrollText, Trash2, Undo2 } from "lucide-react";
import { Children, useState } from "react";

import {
  ControlPlaneDetail,
  DetailFacts,
  ExternalEvidenceLink,
  useControlPlaneDetail,
} from "@/components/control-plane-detail";
import { TenantListShell, formatDateTime, riskTone, useTenantList } from "@/components/tenant-list";
import { StatusBadge } from "@/components/ui";

type Report = {
  id: string;
  type: string;
  status: string;
  title: string;
  summary: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  publishedAt: string | null;
  createdAt: string;
  project: { id: string; name: string } | null;
  generatedBy?: { id: string; name: string } | null;
};

type ReportDetail = Report & {
  sections?: Array<{ id?: string; title: string; body?: string | null; items?: string[] }>;
  findings?: Array<{ id?: string; title: string; summary?: string | null; severity?: string | null; status?: string | null }>;
  decisions?: Array<{ id?: string; title: string; status?: string | null; ownerAction?: string | null }>;
  runs?: Array<{ id: string; title?: string; status: string }>;
  pullRequests?: Array<{ number: number; title?: string; url?: string | null; status?: string; draft?: boolean }>;
  changedFiles?: string[];
  checks?: Array<{ id: number; name: string; status: string; conclusion: string | null; url: string | null }>;
  validations?: Array<{ name: string; status: string; durationMs: number; attempt: number; round: number }>;
  security?: { risk: string; errorCode: string | null; blocker: string | null } | null;
  evidenceGeneratedAt?: string | null;
};

function statusTone(status: string) {
  if (["published", "succeeded", "complete", "passed"].includes(status)) return "safe";
  if (["failed", "blocked", "rejected"].includes(status)) return "danger";
  if (["needs_attention", "inconclusive"].includes(status)) return "warning";
  return "neutral";
}

export function ReportsConsole() {
  const { state, reload } = useTenantList<Report>(
    "/api/reports",
    (body) => (body.reports as Report[]) ?? [],
    "Reports could not be loaded.",
  );
  const detail = useControlPlaneDetail<ReportDetail>("reports", "report");

  // Archiving and deleting act from the list, because the list is where a
  // person decides a report has served its purpose.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [deleting, setDeleting] = useState<Report | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [clearing, setClearing] = useState(false);
  const [clearReason, setClearReason] = useState("");

  async function setArchived(report: Report, archived: boolean) {
    setBusyId(report.id);
    setMessage("");
    setFailed(false);
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(report.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          archived,
          reason: archived ? "Archived from the Reports page." : undefined,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The report could not be updated.");
      setMessage(archived ? "Report archived." : "Report restored.");
      reload();
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "The report could not be updated.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteReport(report: Report) {
    setBusyId(report.id);
    setMessage("");
    setFailed(false);
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(report.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: deleteReason.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The report could not be deleted.");
      setMessage("Report deleted.");
      setDeleting(null);
      setDeleteReason("");
      reload();
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "The report could not be deleted.");
    } finally {
      setBusyId(null);
    }
  }

  async function clearArchived() {
    setBusyId("clear");
    setMessage("");
    setFailed(false);
    try {
      const response = await fetch("/api/reports/clear-archived", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: clearReason.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        cleared?: { deleted: number; kept: number };
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "Archived reports could not be cleared.");
      const cleared = body.cleared ?? { deleted: 0, kept: 0 };
      // Says what stayed as well as what went; a bare count would hide a refusal.
      setMessage(cleared.kept > 0
        ? `Deleted ${cleared.deleted}. ${cleared.kept} were kept because they were refused.`
        : `Deleted ${cleared.deleted} archived ${cleared.deleted === 1 ? "report" : "reports"}.`);
      setClearing(false);
      setClearReason("");
      reload();
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "Archived reports could not be cleared.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {message ? (
        <p
          className={`rounded-lg border p-3 text-sm ${failed ? "border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger)]" : "border-[var(--info-border)] bg-[var(--info-surface)] text-[var(--info)]"}`}
          aria-live="polite"
        >
          {message}
        </p>
      ) : null}
      {state.kind === "ready" && state.items.some((report) => report.status === "archived") ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {clearing ? (
            <>
              <input
                type="text"
                className="rounded border border-line bg-surface px-3 py-2 text-sm"
                maxLength={400}
                value={clearReason}
                onChange={(event) => setClearReason(event.target.value)}
                placeholder="Why clear the archived reports"
                aria-label="Reason for clearing archived reports"
              />
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={busyId !== null || clearReason.trim().length < 10}
                onClick={() => void clearArchived()}
              >
                {busyId === "clear"
                  ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  : <Trash2 className="size-4" aria-hidden="true" />}
                Delete all archived
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setClearing(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setClearing(true); setMessage(""); }}>
              <Trash2 className="size-4" aria-hidden="true" />
              Clear archived reports
            </button>
          )}
        </div>
      ) : null}

      {deleting ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Delete ${deleting.title}`}
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
        >
          <div className="w-full max-w-lg rounded-xl border border-line bg-surface p-5 shadow-lg">
            <h2 className="text-lg font-semibold text-foreground">Delete this report</h2>
            <p className="mt-1 text-sm text-muted">{deleting.title}</p>
            <p className="mt-2 text-xs text-muted">
              The report is removed. The deletion is recorded in the activity trail first, so the
              account of it survives — but the report itself does not, and the runs and pull
              requests it summarised are untouched. To keep it and take it out of the way, archive
              it instead.
            </p>
            <label className="mt-4 flex flex-col gap-1">
              <span className="text-xs text-muted">Reason (required, at least ten characters)</span>
              <input
                type="text"
                className="rounded border border-line bg-surface px-3 py-2 text-sm"
                maxLength={400}
                value={deleteReason}
                onChange={(event) => setDeleteReason(event.target.value)}
                placeholder="Why this report is being removed"
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={busyId !== null || deleteReason.trim().length < 10}
                onClick={() => void deleteReport(deleting)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Delete permanently
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDeleting(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <TenantListShell
        state={state}
        reload={reload}
        title="Reports"
        icon={ScrollText}
        signedOutTitle="Sign in to see your reports"
        signedOutDescription="Reports belong to your workspace."
        returnPath="/solutions/reports"
        emptyTitle="No reports yet"
        emptyDescription="Reports summarize work that actually happened — requests, runs, checks and pull requests. The first one appears after a bot completes a piece of work."
        emptyActionHref="/solutions/bot-manager"
        emptyActionLabel="Give a bot something to do"
      >
        {(reports) => (
          <ul className="divide-y divide-[var(--border)]">
            {reports.map((report) => (
              <li key={report.id} className="p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="font-medium text-foreground">{report.title}</h3>
                    <p className="mt-0.5 text-sm text-faint">
                      {report.type.replace(/_/g, " ")}
                      {report.project ? ` · ${report.project.name}` : " · Organization"}
                      {report.generatedBy ? ` · ${report.generatedBy.name}` : ""}
                      {" · "}
                      {report.publishedAt ? `published ${formatDateTime(report.publishedAt)}` : `created ${formatDateTime(report.createdAt)}`}
                    </p>
                    {report.summary ? <p className="mt-2 line-clamp-2 text-sm text-muted">{report.summary}</p> : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <StatusBadge tone={statusTone(report.status)}>{report.status.replace(/_/g, " ")}</StatusBadge>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void detail.open(report.id)}>
                      Open report
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busyId === report.id}
                      aria-label={report.status === "archived"
                        ? `Restore ${report.title}`
                        : `Archive ${report.title}`}
                      onClick={() => void setArchived(report, report.status !== "archived")}
                    >
                      {busyId === report.id
                        ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        : report.status === "archived"
                          ? <Undo2 className="size-4" aria-hidden="true" />
                          : <Archive className="size-4" aria-hidden="true" />}
                      {report.status === "archived" ? "Restore" : "Archive"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={busyId === report.id}
                      aria-label={`Delete ${report.title}`}
                      onClick={() => { setDeleting(report); setDeleteReason(""); setMessage(""); }}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </TenantListShell>

      <ControlPlaneDetail state={detail.state} title="Report" onClose={detail.close} onRetry={() => void detail.reload()}>
        {(report) => (
          <article className="space-y-6 p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-xl font-semibold text-foreground">{report.title}</h3>
                <p className="mt-2 text-muted">{report.summary ?? "No summary has been recorded."}</p>
              </div>
              <StatusBadge tone={statusTone(report.status)}>{report.status.replace(/_/g, " ")}</StatusBadge>
            </div>

            <DetailFacts facts={[
              { label: "Type", value: report.type.replace(/_/g, " ") },
              { label: "Project", value: report.project?.name ?? "Organization-wide" },
              { label: "Generated by", value: report.generatedBy?.name ?? "System evidence" },
              { label: "Created", value: formatDateTime(report.createdAt) },
              { label: "Period start", value: formatDateTime(report.periodStart) },
              { label: "Period end", value: formatDateTime(report.periodEnd) },
              { label: "Published", value: formatDateTime(report.publishedAt) },
              { label: "Evidence current", value: formatDateTime(report.evidenceGeneratedAt ?? report.createdAt) },
            ]} />

            {(report.sections ?? []).map((section, index) => (
              <section key={section.id ?? `${index}-${section.title}`} className="rounded-lg border border-line p-4">
                <h3 className="font-semibold text-foreground">{section.title}</h3>
                {section.body ? <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{section.body}</p> : null}
                {section.items?.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                    {section.items.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                ) : null}
              </section>
            ))}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ReportSection title="Deterministic validation" empty="No validation evidence is recorded.">
                {(report.validations ?? []).map((validation, index) => (
                  <li key={`${validation.attempt}-${validation.round}-${validation.name}-${index}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 text-foreground">
                      {validation.name} <span className="text-faint">· attempt {validation.attempt}, round {validation.round}</span>
                    </span>
                    <StatusBadge tone={statusTone(validation.status)}>{validation.status}</StatusBadge>
                  </li>
                ))}
              </ReportSection>
              <ReportSection title="GitHub checks" empty="No GitHub check evidence is recorded.">
                {(report.checks ?? []).map((check) => (
                  <li key={check.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <ExternalEvidenceLink href={check.url}>{check.name}</ExternalEvidenceLink>
                    <StatusBadge tone={statusTone(check.conclusion ?? check.status)}>
                      {check.conclusion ?? check.status}
                    </StatusBadge>
                  </li>
                ))}
              </ReportSection>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ReportSection title="Changed files" empty="No changed-file evidence is recorded.">
                {(report.changedFiles ?? []).map((file) => (
                  <li key={file} className="break-all py-2 font-mono text-xs text-foreground">{file}</li>
                ))}
              </ReportSection>
              <section className="rounded-lg border border-line p-4">
                <h3 className="font-semibold text-foreground">Security boundary</h3>
                {report.security ? (
                  <div className="mt-2 space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted">Risk</span>
                      <StatusBadge tone={riskTone(report.security.risk)}>{report.security.risk}</StatusBadge>
                    </div>
                    {report.security.errorCode ? <p className="text-muted">Error: {report.security.errorCode}</p> : null}
                    {report.security.blocker ? <p className="whitespace-pre-wrap text-muted">{report.security.blocker}</p> : null}
                    {!report.security.errorCode && !report.security.blocker ? (
                      <p className="text-faint">No security blocker was recorded.</p>
                    ) : null}
                  </div>
                ) : <p className="mt-2 text-sm text-faint">No security evidence is recorded.</p>}
              </section>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ReportSection title="Findings" empty="No findings are recorded.">
                {(report.findings ?? []).map((finding, index) => (
                  <li key={finding.id ?? `${index}-${finding.title}`} className="py-2 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-medium text-foreground">{finding.title}</span>
                      {finding.severity ? <StatusBadge tone={riskTone(finding.severity)}>{finding.severity}</StatusBadge> : null}
                    </div>
                    {finding.summary ? <p className="mt-1 text-muted">{finding.summary}</p> : null}
                  </li>
                ))}
              </ReportSection>
              <ReportSection title="Owner decisions" empty="No owner decision is requested.">
                {(report.decisions ?? []).map((decision, index) => (
                  <li key={decision.id ?? `${index}-${decision.title}`} className="py-2 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-medium text-foreground">{decision.title}</span>
                      {decision.status ? <StatusBadge tone={statusTone(decision.status)}>{decision.status}</StatusBadge> : null}
                    </div>
                    {decision.ownerAction ? <p className="mt-1 text-muted">{decision.ownerAction}</p> : null}
                  </li>
                ))}
              </ReportSection>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ReportSection title="Linked runs" empty="No run is linked to this report.">
                {(report.runs ?? []).map((run) => (
                  <li key={run.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 break-all text-foreground">{run.title ?? run.id}</span>
                    <StatusBadge tone={statusTone(run.status)}>{run.status}</StatusBadge>
                  </li>
                ))}
              </ReportSection>
              <ReportSection title="Linked pull requests" empty="No pull request is linked to this report.">
                {(report.pullRequests ?? []).map((pullRequest) => (
                  <li key={pullRequest.number} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <ExternalEvidenceLink href={pullRequest.url}>PR #{pullRequest.number}{pullRequest.title ? ` · ${pullRequest.title}` : ""}</ExternalEvidenceLink>
                    <StatusBadge tone="neutral">{pullRequest.draft ? "draft" : pullRequest.status ?? "open"}</StatusBadge>
                  </li>
                ))}
              </ReportSection>
            </div>
          </article>
        )}
      </ControlPlaneDetail>
    </div>
  );
}

function ReportSection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const entries = Children.toArray(children);
  return (
    <section className="rounded-lg border border-line p-4">
      <h3 className="font-semibold text-foreground">{title}</h3>
      {entries.length ? <ul className="mt-2 divide-y divide-[var(--border)]">{children}</ul> : <p className="mt-2 text-sm text-faint">{empty}</p>}
    </section>
  );
}
