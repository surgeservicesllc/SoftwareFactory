"use client";

import { useCallback, useEffect, useState } from "react";

import { Card, EmptyState, SectionTitle, StatusBadge } from "@/components/ui";

/**
 * Skills and gaps, counted from the person's own recorded postings.
 *
 * Every claim on this page carries its sample. There is no market data
 * behind it, so it never says "the industry wants X" — it says how many of
 * YOUR postings asked for X, and names some of them. A row you can trace
 * back to a posting you saved is advice; a bar with no denominator is
 * decoration that looks like research.
 */

type SkillRow = {
  term: string;
  postings: number;
  recorded: boolean;
  averageScore: number | null;
  examples: string[];
};

type SkillsView = {
  analysed: number;
  skipped: number;
  gaps: SkillRow[];
  strengths: SkillRow[];
  coverage: number | null;
};

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; skills: SkillsView; profileRecorded: number; method: string };

function SkillTable({ rows, emptyNote }: { rows: SkillRow[]; emptyNote: string }) {
  if (rows.length === 0) {
    return <p className="mt-2 text-sm text-[var(--text-faint)]">{emptyNote}</p>;
  }
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead>
          <tr className="text-xs uppercase text-[var(--text-faint)]">
            <th scope="col" className="py-1 pr-3 font-medium">Term</th>
            <th scope="col" className="py-1 pr-3 font-medium">Your postings</th>
            <th scope="col" className="py-1 pr-3 font-medium">Their average match</th>
            <th scope="col" className="py-1 font-medium">Asked by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.term} className="border-t border-[var(--border)] align-top">
              <th scope="row" className="py-2 pr-3 font-medium text-[var(--text)]">{row.term}</th>
              <td className="py-2 pr-3 tabular-nums text-[var(--text-muted)]">{row.postings}</td>
              <td className="py-2 pr-3 tabular-nums text-[var(--text-muted)]">
                {/* Null when none of those postings is scored yet. An
                    invented 0 would rank a real gap last. */}
                {row.averageScore === null ? "—" : `${row.averageScore}/100`}
              </td>
              <td className="py-2 text-xs text-[var(--text-faint)]">{row.examples.join("; ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function JobSeekerSkillsPanel() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/job-seeker/skills", { cache: "no-store" });
      if (!response.ok) {
        setState({ kind: "error" });
        return;
      }
      const body = (await response.json()) as {
        skills?: SkillsView; profileRecorded?: number; method?: string;
      };
      if (!body.skills) {
        setState({ kind: "error" });
        return;
      }
      setState({
        kind: "ready",
        skills: body.skills,
        profileRecorded: body.profileRecorded ?? 0,
        method: body.method ?? "",
      });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);

  if (state.kind === "loading") {
    return (
      <Card className="min-h-48 animate-pulse">
        <span className="sr-only">Loading skill gaps</span>
      </Card>
    );
  }

  if (state.kind === "error") {
    return (
      <Card>
        <p role="alert" className="text-sm text-[var(--danger)]">
          Skill gaps could not be computed.
        </p>
      </Card>
    );
  }

  const { skills, profileRecorded, method } = state;

  if (skills.analysed === 0) {
    return (
      <Card>
        <SectionTitle
          title="Skills & Improve"
          description="What the roles on your board keep asking for, and which of it your profile records."
        />
        <EmptyState
          title="Nothing to read yet"
          description={
            skills.skipped > 0
              ? `${skills.skipped} recorded posting${skills.skipped === 1 ? " carries" : "s carry"} no description, so there is no text to read. Search or import postings, which arrive with their full text.`
              : "Search for roles or import a company board, and this fills in from the postings you collect."
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle
          title="Skills & Improve"
          description="What the roles on your board keep asking for, and which of it your profile records."
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge tone="info">
            {skills.analysed} posting{skills.analysed === 1 ? "" : "s"} read
          </StatusBadge>
          {skills.coverage !== null ? (
            <StatusBadge tone={skills.coverage >= 60 ? "safe" : "warning"}>
              You record {skills.coverage}% of what they ask for
            </StatusBadge>
          ) : null}
          {skills.skipped > 0 ? (
            <StatusBadge tone="neutral">
              {skills.skipped} skipped — no description recorded
            </StatusBadge>
          ) : null}
        </div>
        {profileRecorded === 0 ? (
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Your profile records no skills yet, so everything below reads as a gap. Fill in your
            Career Profile first and this becomes a real comparison.
          </p>
        ) : null}
        <p className="mt-2 text-xs text-[var(--text-faint)]">{method}</p>
      </Card>

      <Card>
        <SectionTitle
          title="Gaps worth closing"
          description="Terms your postings ask for that your profile does not record, ranked by how well those roles match you."
        />
        <SkillTable
          rows={skills.gaps}
          emptyNote="No term appears in two or more of your postings without also being on your profile."
        />
      </Card>

      <Card>
        <SectionTitle
          title="Strengths the market is asking for"
          description="Terms your profile records that your postings also name."
        />
        <SkillTable
          rows={skills.strengths}
          emptyNote="None of your recorded skills appears in two or more of your postings yet."
        />
      </Card>
    </div>
  );
}
