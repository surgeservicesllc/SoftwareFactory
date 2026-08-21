"use client";

import { useState } from "react";

import { Card, SectionTitle } from "@/components/ui";

/**
 * The career profile editor: the master source of truth every generated
 * document may draw from. List fields are edited one-entry-per-line, which
 * keeps the data honest (a line is a fact) and the editor accessible.
 */

type HistoryEntry = {
  organization: string;
  title: string;
  started?: string;
  ended?: string;
  summary?: string;
  highlights?: string[];
};

export type ProfileView = {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  location: string | null;
  summary: string | null;
  salaryTarget: number | null;
  salaryCurrency: string;
  workArrangement: string;
  openToTravel: boolean;
  openToRelocation: boolean;
  employmentHistory: HistoryEntry[];
  education: HistoryEntry[];
  accomplishments: string[];
  skills: string[];
  certifications: string[];
  technologies: string[];
  industries: string[];
  updatedAt: string | null;
  resumeUpload?: { id: string; filename: string; byteSize: number } | null;
};

function toLines(list: readonly string[] | undefined): string {
  return (list ?? []).join("\n");
}

function toList(lines: string): string[] {
  return lines
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
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

function HistoryEditor({
  label,
  entries,
  onChange,
}: {
  label: string;
  entries: HistoryEntry[];
  onChange: (entries: HistoryEntry[]) => void;
}) {
  return (
    <div>
      <SectionTitle title={label} />
      <div className="mt-2 space-y-4">
        {entries.map((entry, index) => (
          <div key={index} className="rounded-md border border-[var(--border)] p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Organization">
                <input
                  className={FIELD_CLASS}
                  value={entry.organization}
                  onChange={(event) => {
                    const next = [...entries];
                    next[index] = { ...entry, organization: event.target.value };
                    onChange(next);
                  }}
                />
              </Field>
              <Field label="Title">
                <input
                  className={FIELD_CLASS}
                  value={entry.title}
                  onChange={(event) => {
                    const next = [...entries];
                    next[index] = { ...entry, title: event.target.value };
                    onChange(next);
                  }}
                />
              </Field>
              <Field label="Started" hint="Free-form, e.g. 2021 or Mar 2021">
                <input
                  className={FIELD_CLASS}
                  value={entry.started ?? ""}
                  onChange={(event) => {
                    const next = [...entries];
                    next[index] = { ...entry, started: event.target.value || undefined };
                    onChange(next);
                  }}
                />
              </Field>
              <Field label="Ended" hint="Blank means current">
                <input
                  className={FIELD_CLASS}
                  value={entry.ended ?? ""}
                  onChange={(event) => {
                    const next = [...entries];
                    next[index] = { ...entry, ended: event.target.value || undefined };
                    onChange(next);
                  }}
                />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Summary">
                <textarea
                  className={FIELD_CLASS}
                  rows={2}
                  value={entry.summary ?? ""}
                  onChange={(event) => {
                    const next = [...entries];
                    next[index] = { ...entry, summary: event.target.value || undefined };
                    onChange(next);
                  }}
                />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Highlights" hint="One accomplishment per line">
                <textarea
                  className={FIELD_CLASS}
                  rows={3}
                  value={toLines(entry.highlights)}
                  onChange={(event) => {
                    const next = [...entries];
                    const highlights = toList(event.target.value);
                    next[index] = { ...entry, highlights: highlights.length ? highlights : undefined };
                    onChange(next);
                  }}
                />
              </Field>
            </div>
            <button
              type="button"
              className="btn btn-sm mt-3"
              onClick={() => onChange(entries.filter((_, i) => i !== index))}
            >
              Remove entry
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => onChange([...entries, { organization: "", title: "" }])}
        >
          Add {label.toLowerCase()} entry
        </button>
      </div>
    </div>
  );
}

export function JobSeekerProfileForm({
  initial,
  onSaved,
}: {
  initial: ProfileView | null;
  onSaved: (profile: ProfileView) => void;
}) {
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [linkedinUrl, setLinkedinUrl] = useState(initial?.linkedinUrl ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [salaryTarget, setSalaryTarget] = useState(
    initial?.salaryTarget != null ? String(initial.salaryTarget) : "",
  );
  const [workArrangement, setWorkArrangement] = useState(initial?.workArrangement ?? "any");
  const [openToTravel, setOpenToTravel] = useState(initial?.openToTravel ?? false);
  const [openToRelocation, setOpenToRelocation] = useState(initial?.openToRelocation ?? false);
  const [employment, setEmployment] = useState<HistoryEntry[]>(initial?.employmentHistory ?? []);
  const [education, setEducation] = useState<HistoryEntry[]>(initial?.education ?? []);
  const [accomplishments, setAccomplishments] = useState(toLines(initial?.accomplishments));
  const [skills, setSkills] = useState(toLines(initial?.skills));
  const [certifications, setCertifications] = useState(toLines(initial?.certifications));
  const [technologies, setTechnologies] = useState(toLines(initial?.technologies));
  const [industries, setIndustries] = useState(toLines(initial?.industries));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  // Seeded from the stored profile so the current resume stays visible
  // across reloads, not only in the moment after uploading it.
  const [resumeUpload, setResumeUpload] = useState<{ id: string; filename: string; byteSize: number } | null>(
    initial?.resumeUpload ?? null,
  );

  async function uploadResume(file: File) {
    setBusy(true);
    setProblem("");
    setNotice("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("kind", "resume");
      const response = await fetch("/api/job-seeker/uploads", { method: "POST", body: form });
      const body = (await response.json()) as {
        upload?: { id: string; filename: string; byteSize: number };
        error?: { message?: string };
      };
      if (!response.ok || !body.upload) {
        setProblem(body.error?.message ?? "The file could not be uploaded.");
        return;
      }
      setResumeUpload(body.upload);
      setNotice(`Uploaded ${body.upload.filename} (${Math.round(body.upload.byteSize / 1024)} KB) as your current resume.`);
    } catch {
      setProblem("The file could not be uploaded.");
    } finally {
      setBusy(false);
    }
  }

  /*
   * An entry added and never filled in is a click, not a claim — drop it
   * rather than letting the API reject the whole save as invalid. Entries
   * someone started filling are kept so real mistakes still surface.
   */
  function pruneHistory(entries: HistoryEntry[]): HistoryEntry[] {
    return entries.filter(
      (entry) =>
        entry.organization.trim().length > 0
        || entry.title.trim().length > 0
        || Boolean(entry.started)
        || Boolean(entry.ended)
        || Boolean(entry.summary)
        || (entry.highlights?.length ?? 0) > 0,
    );
  }

  async function save() {
    setBusy(true);
    setNotice("");
    setProblem("");
    try {
      const response = await fetch("/api/job-seeker/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          linkedinUrl: linkedinUrl.trim() || null,
          location: location.trim() || null,
          summary: summary.trim() || null,
          salaryTarget: salaryTarget.trim() ? Number(salaryTarget) : null,
          workArrangement,
          openToTravel,
          openToRelocation,
          employmentHistory: pruneHistory(employment),
          education: pruneHistory(education),
          accomplishments: toList(accomplishments),
          skills: toList(skills),
          certifications: toList(certifications),
          technologies: toList(technologies),
          industries: toList(industries),
        }),
      });
      const body = (await response.json()) as {
        profile?: ProfileView;
        error?: { message?: string };
      };
      if (!response.ok || !body.profile) {
        setProblem(body.error?.message ?? "The profile could not be saved.");
        return;
      }
      onSaved(body.profile);
      setNotice("Profile saved.");
    } catch {
      setProblem("The profile could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <SectionTitle title="Career Profile" />
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        The single source of truth for everything generated on your behalf. Documents draw only
        on what is written here — nothing is ever invented to fill a gap.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Full name">
          <input className={FIELD_CLASS} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Email">
          <input className={FIELD_CLASS} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Phone">
          <input className={FIELD_CLASS} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="LinkedIn URL" hint="Must start with https://">
          <input className={FIELD_CLASS} value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} />
        </Field>
        <Field label="Location">
          <input className={FIELD_CLASS} value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        <Field label="Salary target" hint="Annual, in USD">
          <input
            className={FIELD_CLASS}
            inputMode="numeric"
            value={salaryTarget}
            onChange={(e) => setSalaryTarget(e.target.value)}
          />
        </Field>
        <Field label="Work arrangement">
          <select
            className={FIELD_CLASS}
            value={workArrangement}
            onChange={(e) => setWorkArrangement(e.target.value)}
          >
            <option value="any">Any</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">On-site</option>
          </select>
        </Field>
        <div className="flex items-end gap-4 pb-1">
          <label className="flex items-center gap-2 text-sm text-[var(--text)]">
            <input type="checkbox" checked={openToTravel} onChange={(e) => setOpenToTravel(e.target.checked)} />
            Open to travel
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--text)]">
            <input
              type="checkbox"
              checked={openToRelocation}
              onChange={(e) => setOpenToRelocation(e.target.checked)}
            />
            Open to relocation
          </label>
        </div>
      </div>

      <div className="mt-4">
        <Field label="Resume file" hint="PDF, DOCX, plain text, or Markdown, up to 2 MB. Stored privately; only you can read it.">
          <input
            className={FIELD_CLASS}
            type="file"
            accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadResume(file);
            }}
          />
        </Field>
        {resumeUpload ? (
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Current resume: <a className="text-[var(--accent)] underline" href={`/api/job-seeker/uploads/${resumeUpload.id}`}>{resumeUpload.filename}</a>
          </p>
        ) : null}
      </div>

      <div className="mt-4">
        <Field label="Professional summary">
          <textarea className={FIELD_CLASS} rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </Field>
      </div>

      <div className="mt-6 space-y-6">
        <HistoryEditor label="Employment history" entries={employment} onChange={setEmployment} />
        <HistoryEditor label="Education" entries={education} onChange={setEducation} />
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field label="Skills" hint="One per line">
          <textarea className={FIELD_CLASS} rows={5} value={skills} onChange={(e) => setSkills(e.target.value)} />
        </Field>
        <Field label="Technologies" hint="One per line">
          <textarea className={FIELD_CLASS} rows={5} value={technologies} onChange={(e) => setTechnologies(e.target.value)} />
        </Field>
        <Field label="Accomplishments" hint="One per line">
          <textarea className={FIELD_CLASS} rows={5} value={accomplishments} onChange={(e) => setAccomplishments(e.target.value)} />
        </Field>
        <Field label="Certifications" hint="One per line">
          <textarea className={FIELD_CLASS} rows={5} value={certifications} onChange={(e) => setCertifications(e.target.value)} />
        </Field>
        <Field label="Industries" hint="One per line">
          <textarea className={FIELD_CLASS} rows={3} value={industries} onChange={(e) => setIndustries(e.target.value)} />
        </Field>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save profile"}
        </button>
        {notice ? <p role="status" className="text-sm text-[var(--safe)]">{notice}</p> : null}
        {problem ? <p role="alert" className="text-sm text-[var(--danger)]">{problem}</p> : null}
      </div>
    </Card>
  );
}
