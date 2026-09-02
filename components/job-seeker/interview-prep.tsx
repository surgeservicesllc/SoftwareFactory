"use client";

import { useState } from "react";

/**
 * The interview prep sheet (ADR-246), fetched when the person opens it.
 *
 * Every section is composed on the server from recorded rows and the
 * posting's own text and says so. The one generated section — likely
 * questions from a model — is fetched only on request and is labeled
 * with the model that wrote it, or reads **Not Connected** with the
 * reason when the server has no usable provider credential.
 */

type SheetView = {
  strengths: Array<{ term: string; evidence: string }>;
  gaps: Array<{ term: string; sentence: string }>;
  toAnswer: Array<{ line: string; verdict: "met" | "unmet" | "unknown"; reason: string }>;
  history: Array<{ organization: string; title: string; span: string | null; sharedTerms: string[]; highlights: string[] }>;
  questionsToAsk: string[];
  memory: { sentence: string } | null;
  contacts: Array<{ name: string; role: string | null; source: string | null }>;
  notes: string | null;
  basis: string;
};

type ModelAvailability = { available: boolean; model: string | null; detail: string };

type ModelView =
  | { status: "generated"; model: string; questions: string[]; detail: string }
  | { status: "not_connected"; model: null; questions: []; detail: string }
  | { status: "failed"; model: string; questions: []; detail: string };

type SheetState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ready"; sheet: SheetView; profileRecorded: boolean; model: ModelAvailability };

type ModelState = { kind: "idle" } | { kind: "asking" } | { kind: "failed" } | { kind: "answered"; result: ModelView };

function Section({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }) {
  return (
    <section data-testid={testId} className="space-y-1">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-faint)]">{title}</h4>
      {children}
    </section>
  );
}

export function InterviewPrepSheet({ jobId }: { jobId: string }) {
  const [state, setState] = useState<SheetState>({ kind: "idle" });
  const [model, setModel] = useState<ModelState>({ kind: "idle" });

  const load = async () => {
    setState({ kind: "loading" });
    try {
      const response = await fetch(`/api/job-seeker/jobs/${jobId}/prep`, { cache: "no-store" });
      if (!response.ok) {
        setState({ kind: "failed" });
        return;
      }
      const body = (await response.json()) as { sheet: SheetView; profileRecorded: boolean; model: ModelAvailability };
      setState({ kind: "ready", sheet: body.sheet, profileRecorded: body.profileRecorded, model: body.model });
    } catch {
      setState({ kind: "failed" });
    }
  };

  const ask = async () => {
    setModel({ kind: "asking" });
    try {
      const response = await fetch(`/api/job-seeker/jobs/${jobId}/prep`, { method: "POST", cache: "no-store" });
      if (!response.ok) {
        setModel({ kind: "failed" });
        return;
      }
      const body = (await response.json()) as { model: ModelView };
      setModel({ kind: "answered", result: body.model });
    } catch {
      setModel({ kind: "failed" });
    }
  };

  return (
    <details
      className="mt-3"
      data-testid="interview-prep"
      onToggle={(event) => {
        if ((event.target as HTMLDetailsElement).open && state.kind === "idle") void load();
      }}
    >
      <summary className="cursor-pointer text-sm text-[var(--text-muted)]">Interview prep sheet</summary>
      <div className="mt-2 space-y-3 text-sm">
        {state.kind === "idle" || state.kind === "loading" ? (
          <p className="text-[var(--text-faint)]">Composing the sheet from your recorded facts…</p>
        ) : state.kind === "failed" ? (
          <p className="text-[var(--danger)]">The prep sheet could not be composed.</p>
        ) : (
          <>
            <p className="text-xs text-[var(--text-muted)]">{state.sheet.basis}</p>
            {!state.profileRecorded ? (
              <p className="text-xs text-[var(--warning)]">
                No Career Profile is recorded, so the strengths, gaps and history sections have nothing to draw on.
              </p>
            ) : null}

            <Section title="Lead with these" testId="prep-strengths">
              {state.sheet.strengths.length === 0 ? (
                <p className="text-[var(--text-muted)]">The posting names none of your recorded skills, technologies or certifications.</p>
              ) : (
                <ul className="list-disc pl-4">
                  {state.sheet.strengths.map((strength) => (
                    <li key={strength.term}>
                      <span className="font-medium text-[var(--text)]">{strength.term}</span>
                      <span className="text-[var(--text-muted)]"> — {strength.evidence}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Expect a question on these" testId="prep-gaps">
              {state.sheet.gaps.length === 0 ? (
                <p className="text-[var(--text-muted)]">Every term the posting names is in your profile.</p>
              ) : (
                <ul className="list-disc pl-4">
                  {state.sheet.gaps.map((gap) => (
                    <li key={gap.term} className="text-[var(--text)]">{gap.sentence}</li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Requirement lines to have an answer for" testId="prep-to-answer">
              {state.sheet.toAnswer.length === 0 ? (
                <p className="text-[var(--text-muted)]">Every requirement line the posting states is met by a recorded fact.</p>
              ) : (
                <ul className="space-y-1">
                  {state.sheet.toAnswer.map((check) => (
                    <li key={check.line} className="rounded-md border border-[var(--border)] p-2">
                      <span className={`mr-2 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${check.verdict === "unmet" ? "border-[var(--warning)] text-[var(--warning)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>
                        {check.verdict === "unmet" ? "Not met" : "Unknown"}
                      </span>
                      <span className="text-[var(--text)]">{check.line}</span>
                      <p className="mt-1 text-xs text-[var(--text-muted)]">{check.reason}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Your history that fits" testId="prep-history">
              {state.sheet.history.length === 0 ? (
                <p className="text-[var(--text-muted)]">No recorded employment entry shares a term with the posting.</p>
              ) : (
                <ul className="space-y-1.5">
                  {state.sheet.history.map((entry) => (
                    <li key={`${entry.organization}:${entry.title}`}>
                      <p className="text-[var(--text)]">
                        <span className="font-medium">{entry.title}</span> at {entry.organization}
                        {entry.span ? <span className="text-[var(--text-muted)]"> ({entry.span})</span> : null}
                        <span className="text-[var(--text-muted)]"> — shares {entry.sharedTerms.join(", ")}</span>
                      </p>
                      {entry.highlights.length > 0 ? (
                        <ul className="list-disc pl-4 text-[var(--text-muted)]">
                          {entry.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Ask them" testId="prep-questions">
              {state.sheet.questionsToAsk.length === 0 ? (
                <p className="text-[var(--text-muted)]">The posting states pay, place, work model and level, and shows no red flag.</p>
              ) : (
                <ul className="list-disc pl-4 text-[var(--text)]">
                  {state.sheet.questionsToAsk.map((question) => <li key={question}>{question}</li>)}
                </ul>
              )}
            </Section>

            {state.sheet.memory !== null ? (
              <Section title="Your history with this company" testId="prep-memory">
                <p className="text-[var(--text)]">{state.sheet.memory.sentence}</p>
              </Section>
            ) : null}

            {state.sheet.contacts.length > 0 ? (
              <Section title="People on this application" testId="prep-contacts">
                <ul className="list-disc pl-4 text-[var(--text)]">
                  {state.sheet.contacts.map((contact) => (
                    <li key={`${contact.name}:${contact.role ?? ""}`}>
                      {contact.name}
                      {contact.role ? ` — ${contact.role}` : ""}
                      {contact.source ? <span className="text-[var(--text-muted)]"> ({contact.source})</span> : null}
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {state.sheet.notes ? (
              <Section title="Your notes" testId="prep-notes">
                <p className="whitespace-pre-wrap text-[var(--text)]">{state.sheet.notes}</p>
              </Section>
            ) : null}

            <Section title="Likely questions from a model" testId="prep-model">
              {!state.model.available ? (
                <p className="text-[var(--text-muted)]">
                  <span className="font-semibold">Not Connected</span> — {state.model.detail}
                </p>
              ) : model.kind === "idle" ? (
                <div className="space-y-1">
                  <p className="text-xs text-[var(--text-muted)]">{state.model.detail}</p>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void ask()}>
                    Ask the model for likely questions
                  </button>
                </div>
              ) : model.kind === "asking" ? (
                <p className="text-[var(--text-faint)]">Asking {state.model.model}…</p>
              ) : model.kind === "failed" ? (
                <p className="text-[var(--danger)]">The model questions could not be requested.</p>
              ) : model.result.status === "generated" ? (
                <div className="space-y-1">
                  <p className="text-xs text-[var(--text-muted)]" data-testid="prep-model-label">{model.result.detail}</p>
                  <ol className="list-decimal pl-4 text-[var(--text)]">
                    {model.result.questions.map((question) => <li key={question}>{question}</li>)}
                  </ol>
                </div>
              ) : model.result.status === "not_connected" ? (
                <p className="text-[var(--text-muted)]">
                  <span className="font-semibold">Not Connected</span> — {model.result.detail}
                </p>
              ) : (
                <p className="text-[var(--danger)]">{model.result.detail}</p>
              )}
            </Section>
          </>
        )}
      </div>
    </details>
  );
}
