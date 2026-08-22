"use client";

import { useRef, useState } from "react";

import { ResumeReviewPanel, type ExtractionView } from "@/components/job-seeker/resume-review-panel";

/**
 * "Upload Resume", in the page header, doing the whole job from one press.
 *
 * The control that already existed sat inside the Career Profile form, below
 * the fold and only reachable on one tab — which meant the fastest way to fill
 * a profile in was the hardest thing on the page to find. This one lives in
 * the header, visible from every section, and runs the entire path: choose a
 * file, store it, read it, and show what was found.
 *
 * It still does not write anything on its own. The review dialog is the
 * decision point, exactly as it is in the profile form, because a resume
 * reading is a set of proposals about someone's career and they are the only
 * one who can say which are right.
 */

const ACCEPT = [
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
].join(",");

type Phase = "idle" | "uploading" | "reading" | "reviewing" | "applying";

export function ResumeUploadButton({
  onApplied,
  className,
}: {
  /** Called after fields are written, so the console can refresh from Supabase. */
  onApplied: () => void | Promise<void>;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [extraction, setExtraction] = useState<ExtractionView | null>(null);
  const [problem, setProblem] = useState("");

  const busy = phase === "uploading" || phase === "reading" || phase === "applying";

  async function handleFile(file: File) {
    setProblem("");
    setExtraction(null);
    setPhase("uploading");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("kind", "resume");
      const uploaded = await fetch("/api/job-seeker/uploads", { method: "POST", body: form });
      const uploadBody = (await uploaded.json()) as {
        upload?: { id: string };
        error?: { message?: string };
      };
      if (!uploaded.ok || !uploadBody.upload) {
        setProblem(uploadBody.error?.message ?? "That file could not be uploaded.");
        setPhase("idle");
        return;
      }

      setPhase("reading");
      const read = await fetch(`/api/job-seeker/uploads/${uploadBody.upload.id}/extract`, {
        method: "POST",
      });
      const readBody = (await read.json()) as {
        extraction?: ExtractionView;
        error?: { message?: string };
      };
      if (!read.ok || !readBody.extraction) {
        setProblem(readBody.error?.message ?? "That resume could not be read.");
        setPhase("idle");
        return;
      }
      setExtraction(readBody.extraction);
      setPhase("reviewing");
    } catch {
      setProblem("That resume could not be uploaded just now.");
      setPhase("idle");
    }
  }

  async function apply(fields: string[]) {
    if (!extraction) return;
    setPhase("applying");
    setProblem("");
    try {
      const response = await fetch(`/api/job-seeker/extractions/${extraction.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      const body = (await response.json()) as {
        applied?: { fields: string[]; appliedAt: string };
        error?: { message?: string };
      };
      if (!response.ok || !body.applied) {
        setProblem(body.error?.message ?? "Those fields could not be applied.");
        setPhase("reviewing");
        return;
      }
      setExtraction({ ...extraction, appliedAt: body.applied.appliedAt });
      setPhase("reviewing");
      // Supabase is the source of truth for what the profile now holds, so the
      // console refetches rather than this component guessing at the result.
      await onApplied();
    } catch {
      setProblem("Those fields could not be applied.");
      setPhase("reviewing");
    }
  }

  const label = phase === "uploading"
    ? "Uploading…"
    : phase === "reading"
      ? "Reading resume…"
      : "Upload Resume";

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        aria-label="Resume file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset so choosing the same file twice still fires a change event —
          // otherwise a failed first attempt cannot be retried with that file.
          event.target.value = "";
          if (file) void handleFile(file);
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-contrast,#fff)] disabled:opacity-60"
      >
        {label}
      </button>
      <p className="mt-1 max-w-xs text-xs text-[var(--text-muted)]">
        PDF, DOCX, text or Markdown. We read it and fill in your profile.
      </p>

      {problem ? (
        <p role="alert" className="mt-2 max-w-xs text-xs text-[var(--danger,#f87171)]">
          {problem}
        </p>
      ) : null}

      {extraction ? (
        <div className="mt-2 max-w-xl">
          <ResumeReviewPanel
            extraction={extraction}
            busy={phase === "applying"}
            onApply={apply}
            onDismiss={() => {
              setExtraction(null);
              setPhase("idle");
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
