// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { evaluateJob } from "@/lib/job-seeker/evaluate";
import {
  insertScoredJob,
  type EvaluationInputs,
  type RecordableJob,
} from "@/lib/job-seeker/record";

const inputs: EvaluationInputs = {
  profileRecorded: true,
  profile: {
    skills: ["TypeScript", "PostgreSQL"],
    technologies: ["Next.js"],
    industries: ["Software"],
    employmentTitles: ["Senior Engineer"],
    hasLeadershipEvidence: true,
    salaryTarget: 800_000,
    location: "København",
    workArrangement: "hybrid",
    openToRelocation: false,
  },
  preferences: {
    targetTitles: ["Senior Engineer"],
    compensationMinimum: 750_000,
    locations: ["København"],
    workArrangements: ["hybrid"],
    industries: ["Software"],
    exclusions: [],
    qualificationThreshold: 80,
  },
};

const job: RecordableJob = {
  externalId: "jobnet-42",
  url: "https://jobnet.example/jobs/42",
  title: "Senior Engineer",
  company: "Example A/S",
  salaryText: "DKK 850,000",
  location: "København",
  workModel: "hybrid",
  description: "Lead TypeScript and PostgreSQL delivery for a software platform.",
};

function harness(result: Readonly<{ data: unknown; error: unknown }>) {
  const single = vi.fn().mockResolvedValue(result);
  const rpc = vi.fn(() => ({ single }));
  const from = vi.fn(() => {
    throw new Error("insertScoredJob must not perform independent table writes");
  });
  const client = { rpc, from } as unknown as Parameters<typeof insertScoredJob>[0];

  return { client, from, rpc, single };
}

describe("atomic job recording client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends one complete scored posting to the atomic RPC and performs no table insert", async () => {
    const evaluated = evaluateJob(inputs.profile, inputs.preferences, {
      title: job.title,
      company: job.company,
      description: job.description,
      salaryText: job.salaryText,
      location: job.location,
      workModel: job.workModel,
    });
    const { client, from, rpc, single } = harness({
      data: {
        outcome: "recorded",
        job_id: "88888888-8888-4888-8888-888888888888",
        score: evaluated.score,
        qualified: evaluated.qualified,
      },
      error: null,
    });

    await expect(
      insertScoredJob(client, {
        organizationId: "44444444-4444-4444-8444-444444444444",
        // Deliberately not part of the RPC payload: ownership is auth.uid().
        userId: "99999999-9999-4999-8999-999999999999",
        source: "jobnet",
        job,
        inputs,
      }),
    ).resolves.toEqual({
      outcome: "recorded",
      jobId: "88888888-8888-4888-8888-888888888888",
      score: evaluated.score,
      qualified: evaluated.qualified,
    });

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("record_job_seeker_job", {
      p_organization_id: "44444444-4444-4444-8444-444444444444",
      p_source: "jobnet",
      p_external_id: job.externalId,
      p_url: job.url,
      p_title: job.title,
      p_company: job.company,
      p_salary_text: job.salaryText,
      p_location: job.location,
      p_work_model: job.workModel,
      p_description: job.description,
      p_score: evaluated.score,
      p_breakdown: evaluated.breakdown,
      p_reasons: evaluated.reasons,
      p_gaps: evaluated.gaps,
      p_threshold_used: evaluated.threshold,
      p_qualified: evaluated.qualified,
    });
    expect(single).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalled();
  });

  it("preserves the existing duplicate outcome", async () => {
    const { client } = harness({
      data: { outcome: "duplicate", job_id: null, score: null, qualified: null },
      error: null,
    });

    await expect(
      insertScoredJob(client, {
        organizationId: "44444444-4444-4444-8444-444444444444",
        userId: "55555555-5555-4555-8555-555555555555",
        source: "jobnet",
        job,
        inputs,
      }),
    ).resolves.toEqual({ outcome: "duplicate" });
  });

  it("propagates database refusals and rejects malformed success rows", async () => {
    const refusal = { code: "42501", message: "organization membership is required" };
    const rejected = harness({ data: null, error: refusal });
    await expect(
      insertScoredJob(rejected.client, {
        organizationId: "44444444-4444-4444-8444-444444444444",
        userId: "55555555-5555-4555-8555-555555555555",
        source: "jobnet",
        job,
        inputs,
      }),
    ).rejects.toBe(refusal);

    const malformed = harness({
      data: { outcome: "recorded", job_id: null, score: 85, qualified: true },
      error: null,
    });
    await expect(
      insertScoredJob(malformed.client, {
        organizationId: "44444444-4444-4444-8444-444444444444",
        userId: "55555555-5555-4555-8555-555555555555",
        source: "jobnet",
        job,
        inputs,
      }),
    ).rejects.toThrow(/incomplete recorded outcome/i);
  });
});
