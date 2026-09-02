"use client";

import { useCallback, useEffect, useState } from "react";

import { Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";

/**
 * The application kit page (ADR-244).
 *
 * Two halves. The blocks are the recorded profile in the shape an ATS form
 * asks for, each with a Copy button — nothing reworded, so what is pasted
 * is what was recorded. The answers are the screening questions every
 * employer asks; they are stored per question and read back by the
 * requirements check, so answering once answers the check for every
 * posting.
 */

type KitBlock = { key: string; label: string; text: string };
type Question = { key: string; label: string; hint: string };

type KitView = {
  profileRecorded: boolean;
  blocks: KitBlock[];
  answers: Record<string, string>;
  questions: Question[];
};

const FIELD_CLASS =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className="btn btn-sm"
      aria-label={`Copy ${label}`}
      onClick={() => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(text);
            setState("copied");
          } catch {
            setState("failed");
          }
          window.setTimeout(() => setState("idle"), 2000);
        })();
      }}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed — select the text" : "Copy"}
    </button>
  );
}

export function JobSeekerApplicationKitPanel() {
  const [kit, setKit] = useState<KitView | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/job-seeker/application-kit", { cache: "no-store" });
      if (!response.ok) {
        setProblem("The application kit could not be read.");
        return;
      }
      const body = (await response.json()) as KitView;
      setKit(body);
      setAnswers(body.answers ?? {});
    } catch {
      setProblem("The application kit could not be read.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);

  async function save() {
    setBusy(true);
    setProblem("");
    setSaved(false);
    try {
      const response = await fetch("/api/job-seeker/application-kit", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const body = (await response.json()) as { answers?: Record<string, string>; error?: { message?: string } };
      if (!response.ok || !body.answers) {
        setProblem(body.error?.message ?? "The answers could not be saved.");
        return;
      }
      setAnswers(body.answers);
      setSaved(true);
      await load();
    } catch {
      setProblem("The answers could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Application Kit"
        description="What every application form asks for after the resume, copy-ready from your recorded profile — and the screening answers you keep so you type them once."
      />
      {problem ? <p role="alert" className="text-sm text-[var(--danger)]">{problem}</p> : null}

      {kit === null && !problem ? (
        <Card className="min-h-48 animate-pulse">
          <span className="sr-only">Loading the application kit</span>
        </Card>
      ) : null}

      {kit !== null && !kit.profileRecorded ? (
        <EmptyState
          title="Record your Career Profile first"
          description="The kit is copied from your recorded profile — contact, history, education, skills — and there is nothing recorded yet."
          actionLabel="Open Career Profile"
          actionHref="/job-seeker/profile"
        />
      ) : null}

      {kit !== null && kit.profileRecorded ? (
        <section aria-label="Copy-ready blocks" className="space-y-3">
          <SectionTitle
            title="Copy-ready blocks"
            description="Each block is your recorded profile exactly, in the shape an application form's field takes."
          />
          {kit.blocks.map((block) => (
            <section key={block.key} className="card p-4" data-testid={`kit-block-${block.key}`}>
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-[var(--text)]">{block.label}</h3>
                <CopyButton text={block.text} label={block.label} />
              </div>
              <pre className="mt-2 whitespace-pre-wrap text-sm text-[var(--text-muted)]">{block.text}</pre>
            </section>
          ))}
        </section>
      ) : null}

      {kit !== null ? (
        <section aria-label="Screening answers">
          <Card className="p-4">
            <SectionTitle
              title="Screening answers"
              description="The questions every applicant tracking system asks. Answer once; the requirements check on each application reads them."
            />
            <form
              className="mt-3 grid gap-3 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              {kit.questions.map((question) => (
                <label key={question.key} className="block text-sm">
                  <span className="mb-1 block font-medium text-[var(--text-muted)]">{question.label}</span>
                  <input
                    className={FIELD_CLASS}
                    type="text"
                    maxLength={500}
                    placeholder={question.hint}
                    value={answers[question.key] ?? ""}
                    onChange={(event) =>
                      setAnswers((current) => ({ ...current, [question.key]: event.target.value }))}
                  />
                </label>
              ))}
              <div className="md:col-span-2">
                <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                  {busy ? "Saving…" : "Save answers"}
                </button>
                {saved ? <span className="ml-3 text-sm text-[var(--text-muted)]">Saved.</span> : null}
              </div>
            </form>
            <p className="mt-3 text-xs text-[var(--text-faint)]">
              Stored under your own row-level security. No demographic or self-identification
              questions are kept here — those are the employer&rsquo;s to ask on their own form.
            </p>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
