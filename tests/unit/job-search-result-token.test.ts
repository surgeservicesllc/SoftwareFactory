// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  SEARCH_RESULT_TOKEN_TTL_MS,
  SearchResultTokenError,
  sealSearchResult,
  verifySearchResult,
} from "@/lib/job-seeker/search-result-token";

const originalKey = process.env.SOFTWAREFACTORY_CREDENTIAL_KEY;
const context = {
  organizationId: "10000000-0000-4000-8000-000000000042",
  userId: "20000000-0000-4000-8000-000000000042",
  board: "jobnet",
  job: {
    externalId: "5901234",
    url: "https://jobnet.dk/find-job/5901234",
    title: "Senior Platform Engineer",
    company: "Nordisk Teknik A/S",
    salaryText: null,
    location: "København K",
    workModel: null,
    description: "Kubernetes depth wanted.",
  },
} as const;

beforeEach(() => {
  process.env.SOFTWAREFACTORY_CREDENTIAL_KEY = Buffer.alloc(32, 7).toString("base64");
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.SOFTWAREFACTORY_CREDENTIAL_KEY;
  else process.env.SOFTWAREFACTORY_CREDENTIAL_KEY = originalKey;
});

describe("search result tokens", () => {
  it("accepts the exact result for the same person and organization", () => {
    const token = sealSearchResult({ ...context, now: 1_000 });
    expect(() => verifySearchResult({ ...context, token, now: 2_000 })).not.toThrow();
  });

  it("refuses a changed job or board", () => {
    const token = sealSearchResult({ ...context, now: 1_000 });
    expect(() => verifySearchResult({
      ...context,
      token,
      job: { ...context.job, company: "Invented Company" },
      now: 2_000,
    })).toThrow(SearchResultTokenError);
    expect(() => verifySearchResult({ ...context, token, board: "freehire", now: 2_000 }))
      .toThrow(SearchResultTokenError);
  });

  it("refuses another person, another organization, tampering, and expiry", () => {
    const token = sealSearchResult({ ...context, now: 1_000 });
    const parts = token.split(".");
    parts[3] = `${parts[3]?.startsWith("A") ? "B" : "A"}${parts[3]?.slice(1) ?? ""}`;
    const tampered = parts.join(".");
    expect(() => verifySearchResult({ ...context, token, userId: "other-user", now: 2_000 }))
      .toThrow(SearchResultTokenError);
    expect(() => verifySearchResult({ ...context, token, organizationId: "other-org", now: 2_000 }))
      .toThrow(SearchResultTokenError);
    expect(() => verifySearchResult({ ...context, token: tampered, now: 2_000 }))
      .toThrow(SearchResultTokenError);
    expect(() => verifySearchResult({
      ...context,
      token,
      now: 1_000 + SEARCH_RESULT_TOKEN_TTL_MS + 1,
    })).toThrow(SearchResultTokenError);
  });
});
