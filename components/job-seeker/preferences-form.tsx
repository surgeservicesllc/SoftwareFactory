"use client";

import { useState } from "react";

import { Card, SectionTitle } from "@/components/ui";

/**
 * Job preferences: what the discovery and qualification lanes will hunt for.
 * The qualification threshold defaults to the design's 80 and belongs to the
 * person — a match at or above it is Qualified, below it stays Found.
 */

export type PreferencesView = {
  targetTitles: string[];
  seniority: string | null;
  compensationMinimum: number | null;
  locations: string[];
  workArrangements: string[];
  industries: string[];
  requiredCriteria: string[];
  preferredCriteria: string[];
  exclusions: string[];
  qualificationThreshold: number;
  updatedAt: string | null;
};

function toLines(list: readonly string[] | undefined): string {
  return (list ?? []).join("\n");
}

function toList(lines: string): string[] {
  return lines.split("\n").map((line) => line.trim()).filter(Boolean);
}

const FIELD_CLASS =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-[var(--text)]">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-[var(--text-faint)]">{hint}</span> : null}
    </label>
  );
}

const ARRANGEMENTS = ["remote", "hybrid", "onsite", "any"] as const;

export function JobSeekerPreferencesForm({
  initial,
  onSaved,
}: {
  initial: PreferencesView | null;
  onSaved: (preferences: PreferencesView) => void;
}) {
  const [targetTitles, setTargetTitles] = useState(toLines(initial?.targetTitles));
  const [seniority, setSeniority] = useState(initial?.seniority ?? "");
  const [compensationMinimum, setCompensationMinimum] = useState(
    initial?.compensationMinimum != null ? String(initial.compensationMinimum) : "",
  );
  const [locations, setLocations] = useState(toLines(initial?.locations));
  const [arrangements, setArrangements] = useState<string[]>(initial?.workArrangements ?? []);
  const [industries, setIndustries] = useState(toLines(initial?.industries));
  const [requiredCriteria, setRequiredCriteria] = useState(toLines(initial?.requiredCriteria));
  const [preferredCriteria, setPreferredCriteria] = useState(toLines(initial?.preferredCriteria));
  const [exclusions, setExclusions] = useState(toLines(initial?.exclusions));
  const [threshold, setThreshold] = useState(String(initial?.qualificationThreshold ?? 80));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");

  async function save() {
    setBusy(true);
    setNotice("");
    setProblem("");
    try {
      const response = await fetch("/api/job-seeker/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetTitles: toList(targetTitles),
          seniority: seniority.trim() || null,
          compensationMinimum: compensationMinimum.trim() ? Number(compensationMinimum) : null,
          locations: toList(locations),
          workArrangements: arrangements,
          industries: toList(industries),
          requiredCriteria: toList(requiredCriteria),
          preferredCriteria: toList(preferredCriteria),
          exclusions: toList(exclusions),
          qualificationThreshold: Number(threshold) || 0,
        }),
      });
      const body = (await response.json()) as {
        preferences?: PreferencesView;
        error?: { message?: string };
      };
      if (!response.ok || !body.preferences) {
        setProblem(body.error?.message ?? "The preferences could not be saved.");
        return;
      }
      onSaved(body.preferences);
      setNotice("Preferences saved.");
    } catch {
      setProblem("The preferences could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <SectionTitle title="Job Preferences" />
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        What the search hunts for, and the bar a job must clear to qualify.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Target titles" hint="One per line">
          <textarea className={FIELD_CLASS} rows={4} value={targetTitles} onChange={(e) => setTargetTitles(e.target.value)} />
        </Field>
        <Field label="Locations" hint="One per line">
          <textarea className={FIELD_CLASS} rows={4} value={locations} onChange={(e) => setLocations(e.target.value)} />
        </Field>
        <Field label="Seniority">
          <input className={FIELD_CLASS} value={seniority} onChange={(e) => setSeniority(e.target.value)} />
        </Field>
        <Field label="Compensation minimum" hint="Annual, in USD">
          <input
            className={FIELD_CLASS}
            inputMode="numeric"
            value={compensationMinimum}
            onChange={(e) => setCompensationMinimum(e.target.value)}
          />
        </Field>
      </div>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-[var(--text)]">Work arrangements</legend>
        <div className="mt-2 flex flex-wrap gap-4">
          {ARRANGEMENTS.map((arrangement) => (
            <label key={arrangement} className="flex items-center gap-2 text-sm text-[var(--text)]">
              <input
                type="checkbox"
                checked={arrangements.includes(arrangement)}
                onChange={(event) =>
                  setArrangements((current) =>
                    event.target.checked
                      ? [...current, arrangement]
                      : current.filter((entry) => entry !== arrangement),
                  )
                }
              />
              {arrangement === "onsite" ? "On-site" : arrangement[0].toUpperCase() + arrangement.slice(1)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Industries" hint="One per line">
          <textarea className={FIELD_CLASS} rows={3} value={industries} onChange={(e) => setIndustries(e.target.value)} />
        </Field>
        <Field label="Qualification threshold" hint="0–100; jobs scoring at or above qualify. Default 80.">
          <input
            className={FIELD_CLASS}
            inputMode="numeric"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </Field>
        <Field label="Required criteria" hint="One per line — a job missing any of these does not qualify">
          <textarea className={FIELD_CLASS} rows={4} value={requiredCriteria} onChange={(e) => setRequiredCriteria(e.target.value)} />
        </Field>
        <Field label="Preferred criteria" hint="One per line">
          <textarea className={FIELD_CLASS} rows={4} value={preferredCriteria} onChange={(e) => setPreferredCriteria(e.target.value)} />
        </Field>
        <Field label="Exclusions" hint="One per line — never surface jobs matching these">
          <textarea className={FIELD_CLASS} rows={3} value={exclusions} onChange={(e) => setExclusions(e.target.value)} />
        </Field>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save preferences"}
        </button>
        {notice ? <p role="status" className="text-sm text-[var(--safe)]">{notice}</p> : null}
        {problem ? <p role="alert" className="text-sm text-[var(--danger)]">{problem}</p> : null}
      </div>
    </Card>
  );
}
