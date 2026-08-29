import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import type { RecordableJob } from "@/lib/job-seeker/record";
import { codesMatch, openSecret, sealSecret } from "@/lib/server/secret-box";

const TOKEN_VERSION = 1;
export const SEARCH_RESULT_TOKEN_TTL_MS = 30 * 60 * 1_000;
const CLOCK_SKEW_MS = 60_000;

const payloadSchema = z.object({
  v: z.literal(TOKEN_VERSION),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  issuedAt: z.number().int().nonnegative(),
}).strict();

export class SearchResultTokenError extends Error {
  constructor() {
    super("The search result token is invalid or expired.");
    this.name = "SearchResultTokenError";
  }
}

function tokenPurpose(userId: string): string {
  return `job_search_result:${userId}`;
}

function digestResult(board: string, job: RecordableJob): string {
  /*
   * Construct the object in one fixed order. JSON object order from a browser
   * is not an authority; this normalized shape is what both issuance and
   * verification hash.
   */
  return createHash("sha256").update(JSON.stringify({
    board,
    job: {
      externalId: job.externalId,
      url: job.url,
      title: job.title,
      company: job.company,
      salaryText: job.salaryText,
      location: job.location,
      workModel: job.workModel,
      description: job.description,
    },
  })).digest("hex");
}

/**
 * Bind a returned posting to the organization, person, board, exact normalized
 * fields and a short lifetime. The browser may carry the posting back, but it
 * cannot invent one and attribute it to a board the server never queried.
 */
export function sealSearchResult(args: Readonly<{
  organizationId: string;
  userId: string;
  board: string;
  job: RecordableJob;
  now?: number;
}>): string {
  return sealSecret(JSON.stringify({
    v: TOKEN_VERSION,
    digest: digestResult(args.board, args.job),
    issuedAt: args.now ?? Date.now(),
  }), {
    organizationId: args.organizationId,
    purpose: tokenPurpose(args.userId),
  });
}

export function verifySearchResult(args: Readonly<{
  token: string;
  organizationId: string;
  userId: string;
  board: string;
  job: RecordableJob;
  now?: number;
}>): void {
  try {
    const payload = payloadSchema.parse(JSON.parse(openSecret(args.token, {
      organizationId: args.organizationId,
      purpose: tokenPurpose(args.userId),
    })));
    const now = args.now ?? Date.now();
    if (payload.issuedAt > now + CLOCK_SKEW_MS) throw new SearchResultTokenError();
    if (now - payload.issuedAt > SEARCH_RESULT_TOKEN_TTL_MS) throw new SearchResultTokenError();
    if (!codesMatch(payload.digest, digestResult(args.board, args.job))) {
      throw new SearchResultTokenError();
    }
  } catch (error) {
    if (error instanceof SearchResultTokenError) throw error;
    throw new SearchResultTokenError();
  }
}
