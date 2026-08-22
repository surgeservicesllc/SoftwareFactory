// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
  reviewResume: vi.fn(),
  rpc: vi.fn(),
  inserted: [] as Array<{ table: string; row: Record<string, unknown> }>,
  upload: null as Record<string, unknown> | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization: harness.requireActiveOrganization,
}));
vi.mock("@/lib/job-seeker/resume-review", () => ({ reviewResume: harness.reviewResume }));

import { POST } from "@/app/api/job-seeker/uploads/[uploadId]/extract/route";
import { POST as APPLY } from "@/app/api/job-seeker/extractions/[extractionId]/apply/route";

const uploadId = "a0000000-0000-4000-8000-0000000000c1";
const extractionId = "a0000000-0000-4000-8000-0000000000c2";

/** A PDF that is really a text file, so the real extractor reads it. */
function textUpload(body: string) {
  return {
    id: uploadId,
    content_type: "text/plain",
    data: `\\x${Buffer.from(body).toString("hex")}`,
  };
}

/** The narrow slice of the PostgREST builder these routes actually use. */
function client() {
  return {
    rpc: harness.rpc,
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: harness.upload, error: null }),
        insert(row: Record<string, unknown>) {
          harness.inserted.push({ table, row });
          return {
            select: () => ({
              single: async () => ({
                data: { id: extractionId, created_at: "2026-08-22T00:00:00Z" },
                error: null,
              }),
            }),
          };
        },
      };
      return builder;
    },
  };
}

function extractRequest() {
  return new Request(`https://factory.example/api/job-seeker/uploads/${uploadId}/extract`, {
    method: "POST",
    headers: { origin: "https://factory.example" },
  });
}

const params = { params: Promise.resolve({ uploadId }) };

beforeEach(() => {
  vi.clearAllMocks();
  harness.inserted = [];
  harness.upload = textUpload("Dana Okafor\ndana.okafor@example.com");
  harness.requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: "10000000-0000-4000-8000-0000000000c1", role: "owner" },
    user: { id: "00000000-0000-4000-8000-0000000000c1" },
    client: client(),
  });
  harness.reviewResume.mockResolvedValue({
    proposal: { fullName: "Dana Okafor", email: "dana.okafor@example.com" },
    sources: { fullName: "pattern", email: "pattern" },
    status: "pattern_only",
    model: null,
    detail: "ANTHROPIC_API_KEY is not set on the server.",
  });
});

describe("reading an uploaded resume", () => {
  it("returns the proposal and records the reading", async () => {
    const response = await POST(extractRequest(), params);
    const body = (await response.json()) as {
      extraction: { id: string; status: string; proposal: Record<string, unknown>; proposedFieldCount: number };
    };

    expect(response.status).toBe(201);
    expect(body.extraction.proposal.email).toBe("dana.okafor@example.com");
    expect(body.extraction.proposedFieldCount).toBe(2);
    expect(harness.inserted[0].table).toBe("job_seeker_resume_extractions");
  });

  it("does not touch the profile, because reading is not applying", async () => {
    // The whole safety model: this endpoint proposes, and a second explicit
    // request applies. If it ever wrote the profile, the review screen would
    // be showing someone a change that had already happened.
    await POST(extractRequest(), params);
    expect(harness.inserted.every((entry) => entry.table !== "job_seeker_profiles")).toBe(true);
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("passes the extracted text to the reviewer, not the raw bytes", async () => {
    await POST(extractRequest(), params);
    expect(harness.reviewResume).toHaveBeenCalledWith(
      expect.stringContaining("dana.okafor@example.com"),
    );
  });

  it("records that no model read it, rather than implying one did", async () => {
    const response = await POST(extractRequest(), params);
    const body = (await response.json()) as { extraction: { status: string; model: null; detail: string } };

    expect(body.extraction.status).toBe("pattern_only");
    expect(body.extraction.model).toBeNull();
    expect(body.extraction.detail).toContain("ANTHROPIC_API_KEY");
    expect(harness.inserted[0].row.status).toBe("pattern_only");
    expect(harness.inserted[0].row.model).toBeNull();
  });

  it("records a model review with the model named", async () => {
    harness.reviewResume.mockResolvedValue({
      proposal: { fullName: "Dana Okafor" },
      sources: { fullName: "model" },
      status: "reviewed",
      model: "claude-opus-5",
      detail: "Reviewed by claude-opus-5.",
    });
    await POST(extractRequest(), params);
    expect(harness.inserted[0].row.status).toBe("reviewed");
    expect(harness.inserted[0].row.model).toBe("claude-opus-5");
  });
});

describe("a file that cannot be read", () => {
  beforeEach(() => {
    harness.upload = { id: uploadId, content_type: "application/pdf", data: "\\x6e6f7065" };
  });

  it("answers 200 with a reason, not an error status", async () => {
    /*
     * A scanned resume is a valid request with a disappointing answer. A 4xx
     * or 5xx here reads as "this endpoint is broken" when the truth is "your
     * file holds images rather than text", and those need different next steps
     * from the person.
     */
    const response = await POST(extractRequest(), params);
    const body = (await response.json()) as {
      extraction: { status: string; reason: string; detail: string; proposedFieldCount: number };
    };

    expect(response.status).toBe(200);
    expect(body.extraction.status).toBe("failed");
    expect(body.extraction.reason).toBe("unreadable_pdf");
    expect(body.extraction.proposedFieldCount).toBe(0);
  });

  it("still records the attempt, so the surface can tell it apart from nothing happening", async () => {
    await POST(extractRequest(), params);
    expect(harness.inserted[0].row.status).toBe("failed");
    expect(String(harness.inserted[0].row.detail).length).toBeGreaterThan(0);
  });

  it("never calls a provider with an unreadable file", async () => {
    await POST(extractRequest(), params);
    expect(harness.reviewResume).not.toHaveBeenCalled();
  });
});

describe("reading a resume that is not yours", () => {
  it("is a 404, not someone else's data", async () => {
    harness.upload = null;
    const response = await POST(extractRequest(), params);
    expect(response.status).toBe(404);
  });
});

describe("applying accepted fields", () => {
  const applyParams = { params: Promise.resolve({ extractionId }) };

  function applyRequest(body: unknown, origin = "https://factory.example") {
    return new Request(`https://factory.example/api/job-seeker/extractions/${extractionId}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", origin },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    harness.rpc.mockReturnValue({
      single: async () => ({
        data: {
          extraction_id: extractionId,
          applied_fields: ["fullName", "email"],
          applied_at: "2026-08-22T00:01:00Z",
        },
        error: null,
      }),
    });
  });

  it("sends exactly the fields the person ticked", async () => {
    const response = await APPLY(applyRequest({ fields: ["fullName", "email"] }), applyParams);
    const body = (await response.json()) as { applied: { fields: string[] } };

    expect(response.status).toBe(200);
    expect(harness.rpc).toHaveBeenCalledWith("apply_resume_extraction", {
      p_extraction_id: extractionId,
      p_fields: ["fullName", "email"],
    });
    expect(body.applied.fields).toEqual(["fullName", "email"]);
  });

  it("collapses a field ticked twice into one write", async () => {
    await APPLY(applyRequest({ fields: ["email", "email"] }), applyParams);
    expect(harness.rpc).toHaveBeenCalledWith("apply_resume_extraction", {
      p_extraction_id: extractionId,
      p_fields: ["email"],
    });
  });

  it("refuses an empty selection before it reaches the database", async () => {
    const response = await APPLY(applyRequest({ fields: [] }), applyParams);
    expect(response.status).toBe(422);
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("refuses a field name the profile does not have", async () => {
    const response = await APPLY(applyRequest({ fields: ["salaryTarget"] }), applyParams);
    expect(response.status).toBe(422);
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request", async () => {
    // A resume apply is a state change; it must not be reachable from another site.
    const response = await APPLY(
      applyRequest({ fields: ["email"] }, "https://evil.example"),
      applyParams,
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("passes the database's own refusal through rather than paraphrasing it", async () => {
    /*
     * apply_resume_extraction is where the authority rules live. A second,
     * friendlier message invented here could drift away from the rule that
     * actually holds, and then the surface would be explaining a refusal that
     * is not the one that happened.
     */
    harness.rpc.mockReturnValue({
      single: async () => ({
        data: null,
        error: {
          code: "42501",
          message: "a resume reading can only be applied by the person it belongs to",
        },
      }),
    });
    const response = await APPLY(applyRequest({ fields: ["email"] }), applyParams);
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(403);
    expect(body.error.message).toContain("the person it belongs to");
  });
});
