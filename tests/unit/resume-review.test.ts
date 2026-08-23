// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { reviewResume, type AnthropicFactory } from "@/lib/job-seeker/resume-review";

/**
 * The model lane, with the provider stubbed at the SDK boundary.
 *
 * No test here reaches a provider. What is being checked is the behaviour
 * around the call: that a missing credential degrades honestly instead of
 * failing, that a model answer is merged rather than trusted wholesale, and
 * that no failure mode can make the surface claim a review happened when it
 * did not.
 */

const RESUME = [
  "Dana Okafor",
  "dana.okafor@example.com | +1 (415) 555-0148 | Oakland, CA",
  "SKILLS",
  "Go, TypeScript",
].join("\n");

const ANTHROPIC_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_DEFAULT_MODEL",
  "ANTHROPIC_PROVIDER_DISABLED",
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ANTHROPIC_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ANTHROPIC_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

/** A stub that answers with whatever text the test supplies. */
function respondingWith(text: string): AnthropicFactory {
  return () => ({
    messages: {
      create: async () => ({ content: [{ type: "text", text }] }),
    },
  });
}

describe("with no provider credential configured", () => {
  it("still extracts everything patterns can find", async () => {
    const review = await reviewResume(RESUME, respondingWith("{}"));

    expect(review.proposal.email).toBe("dana.okafor@example.com");
    expect(review.proposal.skills).toEqual(expect.arrayContaining(["Go", "TypeScript"]));
  });

  it("says a model did not read it, and names what is missing", async () => {
    // The whole point: a person is told the truth about which read happened,
    // and an owner is told the exact variable that would enable the other one.
    const review = await reviewResume(RESUME, respondingWith("{}"));

    expect(review.status).toBe("pattern_only");
    expect(review.model).toBeNull();
    expect(review.detail).toContain("ANTHROPIC_API_KEY");
  });

  it("never calls the provider at all", async () => {
    const create = vi.fn();
    await reviewResume(RESUME, () => ({ messages: { create } }));
    expect(create).not.toHaveBeenCalled();
  });
});

describe("with a credential configured", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = `sk-ant-${"a".repeat(40)}`;
  });

  it("merges the model's answer over the pattern pass and reports the model", async () => {
    const review = await reviewResume(
      RESUME,
      respondingWith(JSON.stringify({ fullName: "Dana Okafor", summary: "Platform engineer." })),
    );

    expect(review.status).toBe("reviewed");
    expect(review.model).toBe("claude-opus-5");
    expect(review.proposal.summary).toBe("Platform engineer.");
    expect(review.sources.summary).toBe("model");
    // The pattern pass's own findings survive the merge.
    expect(review.proposal.email).toBe("dana.okafor@example.com");
    expect(review.sources.email).toBe("pattern");
  });

  it("sends the extraction instruction, not a free-form request", async () => {
    const create = vi.fn(
      async (_body: Record<string, unknown>, _options?: Record<string, unknown>) => ({
        content: [{ type: "text", text: "{}" }],
      }),
    );
    await reviewResume(RESUME, () => ({ messages: { create } }));

    const [body] = create.mock.calls[0];
    expect(String(body.system)).toContain("never invent");
    expect(body.max_tokens).toBe(4096);
  });

  it("falls back to patterns when the provider throws, without losing the extraction", async () => {
    /*
     * A rate limit is not a bad resume. Propagating the error would tell a
     * person their file was the problem and throw away a perfectly good
     * pattern extraction they could have used.
     */
    const review = await reviewResume(RESUME, () => ({
      messages: {
        create: async () => {
          throw new Error("429 rate_limit_error");
        },
      },
    }));

    expect(review.status).toBe("pattern_only");
    expect(review.model).toBeNull();
    expect(review.detail).toContain("429");
    expect(review.proposal.email).toBe("dana.okafor@example.com");
  });

  it("falls back when the model answers with something that is not a resume", async () => {
    const review = await reviewResume(RESUME, respondingWith("I'm sorry, I can't help with that."));

    expect(review.status).toBe("pattern_only");
    expect(review.proposal.email).toBe("dana.okafor@example.com");
  });

  it("does not let the model overwrite a found field with an empty one", async () => {
    const review = await reviewResume(
      RESUME,
      respondingWith(JSON.stringify({ email: "", skills: [] })),
    );
    expect(review.proposal.email).toBe("dana.okafor@example.com");
    expect(review.proposal.skills).toEqual(expect.arrayContaining(["Go"]));
  });

  it("never reports 'reviewed' unless a model actually answered with a proposal", async () => {
    // The invariant the surface's honesty rests on, checked across every
    // failure mode at once.
    for (const factory of [
      respondingWith("not json"),
      respondingWith(""),
      (() => ({ messages: { create: async () => ({ content: [] }) } })) as AnthropicFactory,
      (() => ({
        messages: {
          create: async () => {
            throw new Error("boom");
          },
        },
      })) as AnthropicFactory,
    ]) {
      const review = await reviewResume(RESUME, factory);
      expect(review.status).toBe("pattern_only");
      expect(review.model).toBeNull();
    }
  });
});

describe("when the provider is switched off explicitly", () => {
  it("says so rather than reporting a missing credential", async () => {
    process.env.ANTHROPIC_API_KEY = `sk-ant-${"a".repeat(40)}`;
    process.env.ANTHROPIC_PROVIDER_DISABLED = "true";

    const review = await reviewResume(RESUME, respondingWith("{}"));
    expect(review.status).toBe("pattern_only");
    expect(review.detail).toContain("switched off");
  });
});
