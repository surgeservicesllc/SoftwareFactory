import { describe, expect, it } from "vitest";

import {
  buildFunnel,
  describeSilence,
  DEFAULT_WAIT_DAYS,
  MAX_WAIT_DAYS,
  toReplyStats,
  type ReplyStats,
} from "@/lib/job-seeker/silence";

/**
 * Silence arithmetic (ADR-243), asserted sentence by sentence: the number
 * of days, the baseline it is compared against, and the follow-up date
 * derived from it — with the default named as a default and the clamp
 * visible when it bites.
 */

const NOW = new Date("2026-09-02T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const stats: ReplyStats[] = [
  { source: null, applied: 6, replied: 4, silent: 2, medianDaysToReply: 12 },
  { source: "remotive", applied: 2, replied: 2, silent: 0, medianDaysToReply: 9 },
];

describe("describeSilence", () => {
  it("is nothing before an application is submitted", () => {
    expect(describeSilence({ appliedAt: null, repliedAt: null, stage: "FOUND", source: "manual", stats, now: NOW })).toBeNull();
  });

  it("measures silence against the source's own median and suggests applied + median", () => {
    const view = describeSilence({ appliedAt: daysAgo(5), repliedAt: null, stage: "APPLIED", source: "remotive", stats, now: NOW });
    expect(view).toMatchObject({ daysSinceApplied: 5, daysSilent: 5, repliedAfterDays: null });
    expect(view!.sentence).toBe("Silent for 5 days. Your median reply took 9 days across 2 replies on remotive.");
    expect(view!.suggestedFollowUpOn).toBe(daysAgo(5 - 9).slice(0, 10));
    expect(view!.suggestionSentence).toBe(
      `Follow up on ${daysAgo(-4).slice(0, 10)}: applied ${daysAgo(5).slice(0, 10)} + 9 days (your median 9 on remotive, held between 7 and 21).`,
    );
  });

  it("falls back to every source together, and says a due date has passed", () => {
    const view = describeSilence({ appliedAt: daysAgo(30), repliedAt: null, stage: "FOLLOW_UP", source: "manual", stats, now: NOW });
    expect(view!.sentence).toBe("Silent for 30 days. Your median reply took 12 days across 4 replies across all sources.");
    expect(view!.suggestionSentence).toMatch(/^A follow-up was due \d{4}-\d{2}-\d{2}: applied \d{4}-\d{2}-\d{2} \+ 12 days \(your median 12 across all sources, held between 7 and 21\)\.$/);
  });

  it("names the default when no reply is recorded anywhere, and clamps a long median", () => {
    const none = describeSilence({ appliedAt: daysAgo(2), repliedAt: null, stage: "APPLIED", source: "manual", stats: [], now: NOW });
    expect(none!.sentence).toBe("Silent for 2 days. You have no recorded replies yet to compare against.");
    expect(none!.suggestionSentence).toContain(`+ ${DEFAULT_WAIT_DAYS} days (the default ${DEFAULT_WAIT_DAYS} days while no reply is recorded)`);

    const slow = describeSilence({
      appliedAt: daysAgo(2), repliedAt: null, stage: "APPLIED", source: "manual",
      stats: [{ source: null, applied: 3, replied: 3, silent: 0, medianDaysToReply: 40 }], now: NOW,
    });
    expect(slow!.suggestionSentence).toContain(`+ ${MAX_WAIT_DAYS} days (your median 40 across all sources, held between 7 and 21)`);
  });

  it("stops measuring once a reply is recorded, and says when the stage outran the ledger", () => {
    const replied = describeSilence({ appliedAt: daysAgo(20), repliedAt: daysAgo(8), stage: "INTERVIEW", source: "manual", stats, now: NOW });
    expect(replied).toMatchObject({ daysSilent: null, repliedAfterDays: 12, suggestedFollowUpOn: null });
    expect(replied!.sentence).toBe("Replied after 12 days.");

    const outran = describeSilence({ appliedAt: daysAgo(20), repliedAt: null, stage: "INTERVIEW", source: "manual", stats, now: NOW });
    expect(outran!.sentence).toBe("A reply is recorded by the stage, but its date predates the transitions ledger.");
  });

  it("says a closed application ended unanswered rather than suggesting a follow-up", () => {
    const closed = describeSilence({ appliedAt: daysAgo(40), repliedAt: null, stage: "CLOSED", source: "manual", stats, now: NOW });
    expect(closed!.sentence).toBe("Closed after 40 days with no reply recorded.");
    expect(closed!.suggestionSentence).toBeNull();
  });
});

describe("buildFunnel", () => {
  it("counts applications, not events, per stage in pipeline order", () => {
    const funnel = buildFunnel([
      { applicationId: "a", toStage: "FOUND" },
      { applicationId: "a", toStage: "APPLIED" },
      { applicationId: "a", toStage: "APPLIED" },
      { applicationId: "b", toStage: "FOUND" },
      { applicationId: "b", toStage: "CLOSED" },
    ]);
    expect(funnel[0]).toEqual({ stage: "FOUND", reached: 2 });
    expect(funnel.find((row) => row.stage === "APPLIED")).toEqual({ stage: "APPLIED", reached: 1 });
    expect(funnel.find((row) => row.stage === "CLOSED")).toEqual({ stage: "CLOSED", reached: 1 });
    expect(funnel.find((row) => row.stage === "OFFER")).toEqual({ stage: "OFFER", reached: 0 });
    expect(funnel).toHaveLength(11);
  });
});

describe("toReplyStats", () => {
  it("maps a stats row and keeps a missing median null", () => {
    expect(toReplyStats({ source: null, applied: "3", replied: "0", silent: "3", median_days_to_reply: null }))
      .toEqual({ source: null, applied: 3, replied: 0, silent: 3, medianDaysToReply: null });
    expect(toReplyStats({ source: "remotive", applied: 2, replied: 2, silent: 0, median_days_to_reply: "9.5" }).medianDaysToReply).toBe(9.5);
  });
});
