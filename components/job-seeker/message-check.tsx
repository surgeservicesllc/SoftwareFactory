"use client";

import { useMemo, useState } from "react";

import { Card, SectionTitle } from "@/components/ui";
import { scanRedFlags } from "@/lib/job-seeker/board-search/signals";

/**
 * Check a recruiter message against the FTC's warning signs (ADR-242).
 *
 * Runs in the browser over the same deterministic patterns the search
 * applies to postings, so a message and a posting are judged by one rule.
 * Nothing is stored or sent: a person pasting a suspicious message should
 * not have to hand it to anyone to find out. The absence of a flag is said
 * as exactly that — not as proof the message is genuine.
 */
export function RecruiterMessageCheck() {
  const [text, setText] = useState("");
  const flags = useMemo(() => (text.trim().length === 0 ? null : scanRedFlags(text)), [text]);

  return (
    <Card className="p-4">
      <SectionTitle
        title="Check a recruiter message"
        description="Paste a message or posting you were sent. The check runs in your browser against seven warning signs the FTC names and shows the exact phrase; nothing is stored or sent anywhere."
      />
      <label className="mt-3 block">
        <span className="sr-only">Message to check</span>
        <textarea
          data-testid="message-check-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={5}
          maxLength={20_000}
          placeholder="Hi! We reviewed your profile and would like to move forward. Please message us on WhatsApp…"
          className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </label>
      {flags === null ? null : flags.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--muted)]" data-testid="message-check-result">
          No red flags found in this text. That is not proof it is genuine — only that none of the
          seven warning signs appears in what you pasted.
        </p>
      ) : (
        <div className="mt-3 text-sm" data-testid="message-check-result">
          <p className="font-medium text-[var(--warning)]">
            {flags.length === 1 ? "1 red flag" : `${flags.length} red flags`} in this text:
          </p>
          <ul className="mt-1 list-disc pl-5 text-[var(--muted)]">
            {flags.map((flag) => (
              <li key={flag.code}>
                {flag.label} Matched: “{flag.phrase}”.
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
