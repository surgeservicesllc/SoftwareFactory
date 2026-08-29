"use client";

import { useCallback, useEffect, useState } from "react";

import { EVALUATION_METHOD_LABEL } from "@/lib/job-seeker/evaluate";
import { Card, EmptyState, NotConnectedBadge, SectionTitle, StatusBadge } from "@/components/ui";

/**
 * Job discovery: record postings and see their match against your recorded
 * facts. Two real ways in: manual recording, and importing from a public
 * board (Greenhouse or Lever) by its identifier — both flow through the
 * same evaluate-and-score chain. A credentialed adapter with no
 * integration (LinkedIn) still renders Not Connected with its exact needs
 * named, never a working-looking control.
 */

type SourceView = {
  key: string;
  name: string;
  summary: string;
  mode: "public" | "credentialed";
  identifierLabel: string | null;
  identifierHint: string | null;
  configured: boolean;
  requiredConfiguration: string[];
};

type ImportResult = {
  company?: string;
  totalAvailable?: number;
  considered?: number;
  imported?: number;
  duplicates?: number;
  skippedSensitive?: number;
  error?: { message?: string };
};

export type JobView = {
  id: string;
  source: string;
  externalId: string | null;
  url: string | null;
  title: string;
  company: string;
  salaryText: string | null;
  location: string | null;
  workModel: string | null;
  description: string | null;
  discoveredAt: string;
  match: {
    score: number;
    breakdown: Record<string, number>;
    reasons: string[];
    gaps: string[];
    threshold: number;
    qualified: boolean;
  } | null;
  application: {
    id: string;
    stage: string;
    approvalStatus: string;
    applicationUrl: string | null;
    notes: string | null;
    followUpAt: string | null;
  } | null;
};

const FIELD_CLASS =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-[var(--text)]">{label}</span>
      {children}
    </label>
  );
}

/** Identifier + import button for a public-API source card. */
function SourceImportForm({
  source,
  importing,
  disabled,
  onImport,
}: {
  source: SourceView;
  importing: boolean;
  disabled: boolean;
  onImport: (identifier: string) => Promise<void>;
}) {
  const [identifier, setIdentifier] = useState("");
  return (
    <div className="mt-2">
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
          {source.identifierLabel ?? "Identifier"}
        </span>
        <input
          className={FIELD_CLASS}
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
        />
      </label>
      {source.identifierHint ? (
        <p className="mt-1 text-xs text-[var(--text-faint)]">{source.identifierHint}</p>
      ) : null}
      <button
        type="button"
        className="btn btn-sm mt-2"
        disabled={disabled || !identifier.trim()}
        onClick={() => void onImport(identifier.trim())}
      >
        {importing ? "Importing…" : "Import postings"}
      </button>
    </div>
  );
}

export function JobSeekerJobsPanel() {
  const [jobs, setJobs] = useState<JobView[] | null>(null);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [url, setUrl] = useState("");
  const [externalId, setExternalId] = useState("");
  const [salaryText, setSalaryText] = useState("");
  const [location, setLocation] = useState("");
  const [workModel, setWorkModel] = useState("");
  const [description, setDescription] = useState("");
  const [sources, setSources] = useState<SourceView[]>([]);

  const load = useCallback(async () => {
    try {
      const [jobsResponse, sourcesResponse] = await Promise.all([
        fetch("/api/job-seeker/jobs", { cache: "no-store" }),
        fetch("/api/job-seeker/import-sources", { cache: "no-store" }),
      ]);
      if (!jobsResponse.ok) {
        setProblem("Recorded jobs could not be listed.");
        return;
      }
      const body = (await jobsResponse.json()) as { jobs?: JobView[] };
      setJobs(body.jobs ?? []);
      if (sourcesResponse.ok) {
        const sourcesBody = (await sourcesResponse.json()) as { sources?: typeof sources };
        setSources(sourcesBody.sources ?? []);
      }
    } catch {
      setProblem("Recorded jobs could not be listed.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);

  const [importBusy, setImportBusy] = useState("");

  async function importFrom(sourceKey: string, identifier: string) {
    setImportBusy(sourceKey);
    setProblem("");
    setNotice("");
    try {
      const response = await fetch("/api/job-seeker/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sourceKey, identifier }),
      });
      const body = (await response.json()) as ImportResult;
      if (!response.ok) {
        setProblem(body.error?.message ?? "The import could not be completed.");
        return;
      }
      const extras: string[] = [];
      if (body.duplicates) extras.push(`${body.duplicates} already recorded`);
      if (body.skippedSensitive) extras.push(`${body.skippedSensitive} skipped by the credential scanner`);
      const beyondCap = (body.totalAvailable ?? 0) - (body.considered ?? 0);
      if (beyondCap > 0) {
        extras.push(`the board lists ${body.totalAvailable} in total; this import reads the first ${body.considered}`);
      }
      setNotice(
        `Imported ${body.imported ?? 0} of ${body.considered ?? 0} postings from ${body.company ?? identifier}`
        + `${extras.length ? ` — ${extras.join("; ")}` : ""}.`,
      );
      await load();
    } catch {
      setProblem("The import could not be completed.");
    } finally {
      setImportBusy("");
    }
  }

  async function record() {
    setBusy(true);
    setProblem("");
    setNotice("");
    try {
      const response = await fetch("/api/job-seeker/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          company: company.trim(),
          url: url.trim() || null,
          externalId: externalId.trim() || null,
          salaryText: salaryText.trim() || null,
          location: location.trim() || null,
          workModel: workModel || null,
          description: description.trim() || null,
        }),
      });
      const body = (await response.json()) as { job?: JobView; error?: { message?: string } };
      if (!response.ok || !body.job) {
        setProblem(body.error?.message ?? "The job could not be recorded.");
        return;
      }
      setJobs((current) => [body.job as JobView, ...(current ?? [])]);
      setNotice(
        body.job.match
          ? `Recorded and scored ${body.job.match.score}/100 — ${body.job.match.qualified ? "qualified" : "below your threshold"}.`
          : "Recorded.",
      );
      setShowForm(false);
      setTitle(""); setCompany(""); setUrl(""); setExternalId("");
      setSalaryText(""); setLocation(""); setWorkModel(""); setDescription("");
    } catch {
      setProblem("The job could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  if (jobs === null && !problem) {
    return (
      <Card className="min-h-48 animate-pulse">
        <span className="sr-only">Loading recorded jobs</span>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionTitle
            title="Job Discovery"
            description="Record a posting or import from ten public job boards — every one is scored immediately against your profile and preferences."
          />
          <button type="button" className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "Record a job"}
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--text-faint)]">{EVALUATION_METHOD_LABEL}</p>
        <p className="mt-1 text-xs text-[var(--text-faint)]">
          Record a posting yourself, or import from one of ten public job boards. The first
          six read a single employer&apos;s board and ask for that company&apos;s identifier
          from its public URL; the last four search across every employer on them and ask
          for a search term instead. All ten are keyless. A source that needs credentials
          activates only when its named configuration actually exists — never before.
        </p>

        {sources.length > 0 ? (
          <div className="mt-3 grid items-start gap-2 sm:grid-cols-3">
            {sources.map((adapter) => (
              <div key={adapter.key} className="rounded-md border border-[var(--border)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-[var(--text)]">{adapter.name}</p>
                  {adapter.mode === "public" ? (
                    <StatusBadge tone="safe">Public API</StatusBadge>
                  ) : adapter.configured ? (
                    <StatusBadge tone="safe">Connected</StatusBadge>
                  ) : (
                    <NotConnectedBadge />
                  )}
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">{adapter.summary}</p>
                {adapter.mode === "public" ? (
                  <SourceImportForm
                    source={adapter}
                    importing={importBusy === adapter.key}
                    disabled={importBusy !== "" || busy}
                    onImport={(identifier) => importFrom(adapter.key, identifier)}
                  />
                ) : !adapter.configured ? (
                  <p className="mt-1 text-xs text-[var(--text-faint)]">
                    Needs: {adapter.requiredConfiguration.join(", ")}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {showForm ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Job title">
              <input className={FIELD_CLASS} value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Company">
              <input className={FIELD_CLASS} value={company} onChange={(e) => setCompany(e.target.value)} />
            </Field>
            <Field label="Job URL">
              <input className={FIELD_CLASS} value={url} onChange={(e) => setUrl(e.target.value)} />
            </Field>
            <Field label="Job ID">
              <input className={FIELD_CLASS} value={externalId} onChange={(e) => setExternalId(e.target.value)} />
            </Field>
            <Field label="Salary (as stated)">
              <input className={FIELD_CLASS} value={salaryText} onChange={(e) => setSalaryText(e.target.value)} />
            </Field>
            <Field label="Location">
              <input className={FIELD_CLASS} value={location} onChange={(e) => setLocation(e.target.value)} />
            </Field>
            <Field label="Work model">
              <select className={FIELD_CLASS} value={workModel} onChange={(e) => setWorkModel(e.target.value)}>
                <option value="">Not stated</option>
                <option value="remote">Remote</option>
                <option value="hybrid">Hybrid</option>
                <option value="onsite">On-site</option>
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Full description">
                <textarea className={FIELD_CLASS} rows={6} value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void record()}
                disabled={busy || !title.trim() || !company.trim()}
              >
                {busy ? "Recording…" : "Record and score"}
              </button>
            </div>
          </div>
        ) : null}

        {notice ? <p role="status" className="mt-3 text-sm text-[var(--safe)]">{notice}</p> : null}
        {problem ? <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{problem}</p> : null}
      </Card>

      {jobs && jobs.length === 0 ? (
        <EmptyState
          title="No jobs recorded yet"
          description="Record your first posting above — it is scored the moment it lands, with the reasons and gaps written out."
        />
      ) : null}

      {(jobs ?? []).map((job) => (
        <Card key={job.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-[var(--text)]">{job.title}</h3>
              <p className="text-sm text-[var(--text-muted)]">
                {job.company}
                {job.location ? ` · ${job.location}` : ""}
                {job.workModel ? ` · ${job.workModel}` : ""}
                {job.salaryText ? ` · ${job.salaryText}` : ""}
                {job.source !== "manual" ? ` · via ${job.source}` : ""}
              </p>
              {job.url ? (
                <a href={job.url} target="_blank" rel="noreferrer" className="text-xs text-[var(--accent)] underline">
                  Posting
                </a>
              ) : null}
            </div>
            {job.match ? (
              <div className="text-right">
                <p className="text-2xl font-semibold tabular-nums text-[var(--text)]">
                  {job.match.score}
                  <span className="text-sm text-[var(--text-faint)]">/100</span>
                </p>
                <StatusBadge tone={job.match.qualified ? "safe" : "neutral"}>
                  {job.match.qualified ? "Qualified" : `Below ${job.match.threshold}`}
                </StatusBadge>
              </div>
            ) : null}
          </div>

          {job.match ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-[var(--text-muted)]">
                Score breakdown, reasons, and gaps
              </summary>
              <div className="mt-2 grid gap-4 sm:grid-cols-2">
                <div>
                  <h4 className="text-xs font-semibold uppercase text-[var(--text-faint)]">Breakdown</h4>
                  <ul className="mt-1 space-y-0.5 text-sm text-[var(--text)]">
                    {Object.entries(job.match.breakdown).map(([component, value]) => (
                      <li key={component} className="flex justify-between gap-4">
                        <span className="text-[var(--text-muted)]">{component.replaceAll("_", " ")}</span>
                        <span className="tabular-nums">{value}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="space-y-3">
                  {job.match.reasons.length > 0 ? (
                    <div>
                      <h4 className="text-xs font-semibold uppercase text-[var(--text-faint)]">Reasons</h4>
                      <ul className="mt-1 list-disc pl-4 text-sm text-[var(--text)]">
                        {job.match.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {job.match.gaps.length > 0 ? (
                    <div>
                      <h4 className="text-xs font-semibold uppercase text-[var(--text-faint)]">Gaps</h4>
                      <ul className="mt-1 list-disc pl-4 text-sm text-[var(--text-muted)]">
                        {job.match.gaps.map((gap) => <li key={gap}>{gap}</li>)}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>
            </details>
          ) : null}

          {job.application ? (
            <p className="mt-3 text-xs text-[var(--text-faint)]">
              Pipeline stage: <span className="font-medium text-[var(--text-muted)]">{job.application.stage.replaceAll("_", " ")}</span>
            </p>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
