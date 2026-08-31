"use client";

import { useEffect, useState } from "react";

import { Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";

/**
 * The copilot surface: ask, get a computed answer, see what is askable.
 *
 * Every answer on this page was computed from the workspace's rows at the
 * moment of asking — the transcript labels them so. Free-form drafting is
 * a model capability and models are Not Connected; the page says that
 * plainly instead of imitating a chat product it is not.
 */

type Skill = { id: string; label: string; example: string };
type Turn = { question: string; answer: string; skill: string | null };

export function ServicesCopilotPanel() {
  const [skills, setSkills] = useState<readonly Skill[]>([]);
  const [question, setQuestion] = useState("");
  const [transcript, setTranscript] = useState<readonly Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const kickoff = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch("/api/services/copilot", { cache: "no-store" });
          if (!response.ok) return;
          const body = (await response.json()) as { skills?: Skill[] };
          setSkills(body.skills ?? []);
        } catch {
          // The chips are a convenience; asking still works without them.
        }
      })();
    }, 0);
    return () => window.clearTimeout(kickoff);
  }, []);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 3 || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/services/copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setMessage(failure?.error?.message ?? "The question could not be answered.");
        return;
      }
      const body = (await response.json()) as { answer: string; skill: string | null };
      setTranscript((turns) => [...turns, { question: trimmed, answer: body.answer, skill: body.skill }]);
      setQuestion("");
    } catch {
      setMessage("The question could not be answered.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="services-copilot">
      <PageHeader
        title="Copilot"
        description="Questions answered from your own records — computed, never generated."
      />
      <Card>
        <SectionTitle
          title="Ask your workspace"
          description="Answers are computed from your own records at the moment you ask — never generated, cached, or estimated."
        />
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(question);
          }}
        >
          <input
            aria-label="Question"
            className="min-w-64 flex-1 rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
            placeholder="Which invoices are overdue?"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button
            type="submit"
            disabled={busy || question.trim().length < 3}
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            Ask
          </button>
        </form>
        {message ? (
          <p role="alert" className="mt-2 text-sm text-[var(--danger)]">
            {message}
          </p>
        ) : null}
        {skills.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {skills.map((skill) => (
              <button
                key={skill.id}
                type="button"
                disabled={busy}
                className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-muted hover:text-[var(--foreground)] disabled:opacity-50"
                onClick={() => void ask(skill.example)}
              >
                {skill.label}
              </button>
            ))}
          </div>
        ) : null}
        <p className="mt-3 text-xs text-muted">
          Free-form drafting — letters, summaries, replies — needs an AI provider, and none is
          connected: that capability is <strong>Not Connected</strong> and nothing here imitates it.
        </p>
      </Card>

      <Card>
        <SectionTitle title="Transcript" />
        {transcript.length === 0 ? (
          <EmptyState
            title="Nothing asked yet"
            description="Ask a question above, or tap one of the suggestions."
          />
        ) : (
          <ol className="mt-3 space-y-4">
            {transcript.map((turn, index) => (
              <li key={index} className="space-y-1">
                <p className="text-sm font-medium">{turn.question}</p>
                <p className="text-sm text-muted">{turn.answer}</p>
                <p className="text-xs text-muted">
                  {turn.skill === null
                    ? "Not recognized — nothing was computed."
                    : "Computed from your records just now."}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
