"use client";

import { useState } from "react";

/**
 * What was read out of a resume, and which of it the person wants.
 *
 * The panel exists because applying silently would be the wrong shape for this
 * feature. A resume reading is a set of guesses about someone's career — very
 * good guesses about their email, weaker ones about which line was the
 * employer — and the person is the only one who can tell which is which. So
 * every field is shown with its value and where it came from, ticked by
 * default because most will be right, and nothing is written until they say so.
 *
 * The two sources are labelled differently on purpose. "AI" and "Pattern" are
 * not decoration: a field a model proposed deserves a closer look than one a
 * regular expression lifted verbatim out of the text.
 */

export type ExtractionView = {
  id: string;
  status: "reviewed" | "pattern_only" | "failed";
  model: string | null;
  detail: string;
  reason?: string;
  proposal: Record<string, unknown>;
  sources: Record<string, string>;
  proposedFieldCount: number;
  characterCount: number;
  truncated: boolean;
  appliedAt: string | null;
};

/** Display names, and the order a person expects to read them in. */
const FIELD_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["fullName", "Full name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["linkedinUrl", "LinkedIn"],
  ["location", "Location"],
  ["summary", "Professional summary"],
  ["employmentHistory", "Employment history"],
  ["education", "Education"],
  ["skills", "Skills"],
  ["technologies", "Technologies"],
  ["certifications", "Certifications"],
  ["industries", "Industries"],
  ["accomplishments", "Accomplishments"],
];

type HistoryEntry = {
  organization?: string;
  title?: string;
  started?: string;
  ended?: string;
  highlights?: string[];
};

/** A short, readable rendering of a proposed value. */
function preview(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return String(value ?? "");
  if (value.length === 0) return "";
  if (typeof value[0] === "string") return (value as string[]).join(", ");
  return (value as HistoryEntry[])
    .map((entry) => {
      const dates = [entry.started, entry.ended].filter(Boolean).join(" – ");
      return `${entry.title ?? "?"} — ${entry.organization ?? "?"}${dates ? ` (${dates})` : ""}`;
    })
    .join("\n");
}

function countOf(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? "entry" : "entries"}`;
  return "";
}

export function ResumeReviewPanel({
  extraction,
  busy,
  onApply,
  onDismiss,
}: {
  extraction: ExtractionView;
  busy: boolean;
  onApply: (fields: string[]) => void | Promise<void>;
  onDismiss: () => void;
}) {
  const available = FIELD_LABELS.filter(([key]) => {
    const value = extraction.proposal[key];
    if (value === undefined || value === null) return false;
    if (Array.isArray(value)) return value.length > 0;
    return String(value).trim().length > 0;
  });

  // Everything ticked to start with: most proposals are right, and asking
  // someone to tick thirteen boxes to get the benefit would waste the feature.
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(available.map(([key]) => key)),
  );

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (extraction.status === "failed") {
    return (
      <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
        <p className="text-sm font-medium text-[var(--text)]">That file could not be read</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{extraction.detail}</p>
        <button
          type="button"
          className="mt-2 text-xs text-[var(--accent)] underline"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (extraction.appliedAt) {
    return (
      <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
        <p className="text-sm text-[var(--text)]">
          Applied to your profile. Review the fields below and save when they look right.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-[var(--text)]">
          {available.length > 0
            ? `Found ${available.length} ${available.length === 1 ? "field" : "fields"} in your resume`
            : "Nothing could be read from that resume"}
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          {/*
            * The honest label. "Reviewed by <model>" and "patterns only" are
            * genuinely different reads, and a surface that showed the same
            * words for both would be claiming an AI review on a deployment
            * that has no provider configured.
            */}
          {extraction.status === "reviewed" && extraction.model
            ? `Reviewed by ${extraction.model}`
            : "Pattern extraction only — Not Connected"}
        </p>
      </div>

      {extraction.status !== "reviewed" ? (
        <p className="mt-1 text-xs text-[var(--text-muted)]">{extraction.detail}</p>
      ) : null}
      {extraction.truncated ? (
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Only the first part of a long document was read ({extraction.characterCount.toLocaleString()} characters in total).
        </p>
      ) : null}

      {available.length === 0 ? (
        <button type="button" className="mt-2 text-xs text-[var(--accent)] underline" onClick={onDismiss}>
          Dismiss
        </button>
      ) : (
        <>
          <ul className="mt-3 space-y-2">
            {available.map(([key, label]) => {
              const value = extraction.proposal[key];
              const fromModel = extraction.sources[key] === "model";
              return (
                <li key={key} className="flex gap-2">
                  <input
                    id={`resume-field-${key}`}
                    type="checkbox"
                    className="mt-1"
                    checked={selected.has(key)}
                    onChange={() => toggle(key)}
                  />
                  <div className="min-w-0 flex-1">
                    <label
                      htmlFor={`resume-field-${key}`}
                      className="flex flex-wrap items-baseline gap-2 text-sm text-[var(--text)]"
                    >
                      <span className="font-medium">{label}</span>
                      <span className="rounded-sm border border-[var(--border)] px-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                        {fromModel ? "AI" : "Pattern"}
                      </span>
                      {countOf(value) ? (
                        <span className="text-xs text-[var(--text-muted)]">{countOf(value)}</span>
                      ) : null}
                    </label>
                    <p className="mt-0.5 whitespace-pre-line break-words text-xs text-[var(--text-muted)]">
                      {preview(value)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-contrast,#fff)] disabled:opacity-60"
              disabled={busy || selected.size === 0}
              onClick={() => void onApply([...selected])}
            >
              {busy ? "Applying…" : `Apply ${selected.size} selected`}
            </button>
            <button
              type="button"
              className="text-xs text-[var(--accent)] underline"
              onClick={onDismiss}
              disabled={busy}
            >
              Discard this reading
            </button>
          </div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Applying overwrites those profile fields with the values above. Nothing
            else on your profile changes, and a field left unticked is not touched.
          </p>
        </>
      )}
    </div>
  );
}
