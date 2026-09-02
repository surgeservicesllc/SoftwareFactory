"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Notice, SectionTitle } from "@/components/ui";
import {
  askedNow,
  type DraftAnswer,
  type FormQuestionView,
} from "@/lib/services/form-conditions";

/**
 * Answering a form (ADR-238). Every question comes from the database with
 * whether it is asked, given the answers so far; the page hides a question
 * the moment its parent's draft answer changes, using the same rule, and
 * says beside a hidden question what would ask it. Saving sends the
 * answers parents-first; the database refuses one for a question it is not
 * asking, so the page can never be more permissive than the record.
 */

type Instance = {
  id: string;
  status: string;
  templateId: string;
  completedAt: string | null;
};

type Answer = {
  fieldId: string;
  valueText: string | null;
  valueNumber: number | null;
  valueBoolean: boolean | null;
  valueDate: string | null;
  valueOptions: string[] | null;
};

type Payload = {
  instance: Instance;
  questions: FormQuestionView[];
  answers: Answer[];
  unansweredRequired: string[];
};

function draftFromAnswer(answer: Answer | undefined): DraftAnswer {
  if (answer === undefined) return null;
  if (answer.valueText !== null) return { kind: "text", value: answer.valueText };
  if (answer.valueNumber !== null) return { kind: "number", value: Number(answer.valueNumber) };
  if (answer.valueBoolean !== null) return { kind: "boolean", value: answer.valueBoolean };
  if (answer.valueDate !== null) return { kind: "date", value: answer.valueDate };
  if (answer.valueOptions !== null) return { kind: "options", value: answer.valueOptions };
  return null;
}

function wireAnswer(fieldId: string, draft: DraftAnswer): Record<string, unknown> | null {
  if (draft === null) return null;
  switch (draft.kind) {
    case "text": return draft.value.trim().length === 0 ? null : { fieldId, text: draft.value.trim() };
    case "number": return Number.isFinite(draft.value) ? { fieldId, number: draft.value } : null;
    case "boolean": return { fieldId, boolean: draft.value };
    case "date": return draft.value.length === 0 ? null : { fieldId, date: draft.value };
    case "options": return draft.value.length === 0 ? null : { fieldId, options: draft.value };
  }
}

async function readFailure(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}

export function FormAnswerSheet({ instanceId, onChanged }: { instanceId: string; onChanged?: () => void }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [drafts, setDrafts] = useState<Map<string, DraftAnswer>>(new Map());
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/services/forms/instances?instanceId=${encodeURIComponent(instanceId)}`, { headers: { accept: "application/json" } });
      if (!response.ok) {
        setError(await readFailure(response, "The form could not be read."));
        return;
      }
      const body = (await response.json()) as Payload;
      setPayload(body);
      setDrafts(new Map(body.questions.map((question) => [
        question.fieldId,
        draftFromAnswer(body.answers.find((answer) => answer.fieldId === question.fieldId)),
      ])));
      setError("");
    } catch {
      setError("The form could not be read.");
    }
  }, [instanceId]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);

  const byId = useMemo(
    () => new Map((payload?.questions ?? []).map((question) => [question.fieldId, question])),
    [payload],
  );

  const asked = useCallback(
    (question: FormQuestionView) => askedNow(question, byId, drafts),
    [byId, drafts],
  );

  const setDraft = (fieldId: string, draft: DraftAnswer) => {
    setDrafts((current) => {
      const next = new Map(current);
      next.set(fieldId, draft);
      return next;
    });
  };

  const save = useCallback(async (status?: "in_progress" | "completed") => {
    if (payload === null) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      // Only asked questions are sent, parents first; an unasked question's
      // draft stays on the page and is neither sent nor counted.
      const answers = payload.questions
        .filter((question) => asked(question))
        .map((question) => wireAnswer(question.fieldId, drafts.get(question.fieldId) ?? null))
        .filter((entry): entry is Record<string, unknown> => entry !== null);
      const body: Record<string, unknown> = { instanceId };
      if (answers.length > 0) body.answers = answers;
      if (status !== undefined) body.status = status;
      if (answers.length === 0 && status === undefined) {
        setMessage("Nothing to save yet.");
        return;
      }
      const response = await fetch("/api/services/forms/instances", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setError(await readFailure(response, "The answers could not be saved."));
        await load();
        return;
      }
      setMessage(status === "completed" ? "Completed." : "Saved.");
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }, [asked, drafts, instanceId, load, onChanged, payload]);

  if (payload === null) {
    return error ? <div className="mt-3"><Notice tone="warning">{error}</Notice></div> : <p className="mt-3 text-sm text-muted">Loading the form…</p>;
  }

  const completed = payload.instance.status === "completed";
  const outstanding = payload.questions.filter((question) => question.required && asked(question) && (drafts.get(question.fieldId) ?? null) === null);

  return (
    <div className="mt-4 rounded-lg border border-line bg-surface-inset p-4" data-testid="form-answer-sheet">
      <SectionTitle
        title="Answer the form"
        description="A question is asked only when the answer before it calls for it; a hidden question says what would ask it. Complete counts only the required questions being asked."
      />
      <ol className="mt-3 space-y-3">
        {payload.questions.map((question) => {
          const isAsked = asked(question);
          const draft = drafts.get(question.fieldId) ?? null;
          return (
            <li key={question.fieldId} className="text-sm" data-testid={`form-question-${question.position}`} data-asked={isAsked ? "true" : "false"}>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className={isAsked ? "font-medium text-foreground" : "text-faint line-through"}>
                  {question.position}. {question.label}
                </span>
                {question.required ? <span className="text-[11px] uppercase tracking-wide text-faint">required</span> : null}
                {question.condition !== null ? (
                  <span className="text-xs text-muted" data-testid={`form-question-condition-${question.position}`}>{question.condition}</span>
                ) : null}
              </div>
              {question.helpText ? <p className="text-xs text-faint">{question.helpText}</p> : null}
              {isAsked && !completed ? (
                <div className="mt-1">
                  {question.fieldType === "boolean" ? (
                    <div className="flex gap-2">
                      {[true, false].map((value) => (
                        <button
                          key={String(value)}
                          type="button"
                          className={`btn px-2.5 py-1 text-xs ${draft?.kind === "boolean" && draft.value === value ? "btn-primary" : "btn-secondary"}`}
                          onClick={() => setDraft(question.fieldId, { kind: "boolean", value })}
                          aria-pressed={draft?.kind === "boolean" && draft.value === value}
                          aria-label={`${question.label}: ${value ? "yes" : "no"}`}
                        >
                          {value ? "Yes" : "No"}
                        </button>
                      ))}
                    </div>
                  ) : question.fieldType === "select" ? (
                    <select
                      value={draft?.kind === "text" ? draft.value : ""}
                      onChange={(event) => setDraft(question.fieldId, event.target.value === "" ? null : { kind: "text", value: event.target.value })}
                      className="rounded-lg border border-line px-2 py-1 text-sm"
                      aria-label={question.label}
                    >
                      <option value="">—</option>
                      {question.options.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  ) : question.fieldType === "multi_select" ? (
                    <div className="flex flex-wrap gap-2">
                      {question.options.map((option) => {
                        const chosen = draft?.kind === "options" ? draft.value : [];
                        const on = chosen.includes(option);
                        return (
                          <label key={option} className="flex items-center gap-1 text-xs text-muted">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => {
                                const next = on ? chosen.filter((entry) => entry !== option) : [...chosen, option];
                                setDraft(question.fieldId, next.length === 0 ? null : { kind: "options", value: next });
                              }}
                              aria-label={`${question.label}: ${option}`}
                            />
                            {option}
                          </label>
                        );
                      })}
                    </div>
                  ) : question.fieldType === "number" ? (
                    <input
                      type="number"
                      value={draft?.kind === "number" ? draft.value : ""}
                      onChange={(event) => setDraft(question.fieldId, event.target.value === "" ? null : { kind: "number", value: Number(event.target.value) })}
                      className="w-40 rounded-lg border border-line px-2 py-1 text-sm"
                      aria-label={question.label}
                    />
                  ) : question.fieldType === "date" ? (
                    <input
                      type="date"
                      value={draft?.kind === "date" ? draft.value : ""}
                      onChange={(event) => setDraft(question.fieldId, event.target.value === "" ? null : { kind: "date", value: event.target.value })}
                      className="rounded-lg border border-line px-2 py-1 text-sm"
                      aria-label={question.label}
                    />
                  ) : question.fieldType === "long_text" ? (
                    <textarea
                      value={draft?.kind === "text" ? draft.value : ""}
                      onChange={(event) => setDraft(question.fieldId, event.target.value === "" ? null : { kind: "text", value: event.target.value })}
                      rows={3}
                      className="w-full rounded-lg border border-line px-2 py-1 text-sm"
                      aria-label={question.label}
                    />
                  ) : (
                    <input
                      value={draft?.kind === "text" ? draft.value : ""}
                      onChange={(event) => setDraft(question.fieldId, event.target.value === "" ? null : { kind: "text", value: event.target.value })}
                      className="w-full rounded-lg border border-line px-2 py-1 text-sm"
                      aria-label={question.label}
                    />
                  )}
                </div>
              ) : isAsked && completed && draft !== null ? (
                <p className="mt-1 text-sm text-muted" data-testid={`form-answer-${question.position}`}>
                  {draft.kind === "options" ? draft.value.join(", ") : draft.kind === "boolean" ? (draft.value ? "Yes" : "No") : String(draft.value)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      {!completed ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} className="btn btn-primary px-3 py-1.5 text-xs" onClick={() => void save("in_progress")} data-testid="form-save">
            Save answers
          </button>
          <button
            type="button"
            disabled={busy || outstanding.length > 0}
            className="btn btn-secondary px-3 py-1.5 text-xs"
            onClick={() => void save("completed")}
            data-testid="form-complete"
          >
            Mark complete
          </button>
          {outstanding.length > 0 ? (
            <span className="text-xs text-muted" data-testid="form-outstanding">
              Still required: {outstanding.map((question) => question.label).join(", ")}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted">Completed {payload.instance.completedAt?.slice(0, 10)}.</p>
      )}
      {message ? <p className="mt-2 text-sm text-emerald-700" data-testid="form-message">{message}</p> : null}
      {error ? <div className="mt-2"><Notice tone="warning">{error}</Notice></div> : null}
    </div>
  );
}
