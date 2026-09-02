// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { generatePolishedDocument, parsePolished, polishAvailability, POLISH_SYSTEM_PROMPT, polishPrompt } from "@/lib/job-seeker/polish";
import type { AnthropicFactory } from "@/lib/job-seeker/model-lane";

/**
 * The polish lane (ADR-248) with the provider stubbed at the SDK
 * boundary: Not Connected without a credential and no call made; a
 * faithful rewording comes back as polished with the check; an addition
 * comes back rejected with the additions named; an unreadable answer or a
 * thrown call is failed. Nothing here is ever "polished" by accident.
 */

const ANTHROPIC_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_DEFAULT_MODEL", "ANTHROPIC_PROVIDER_DISABLED"];
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
});

const BASELINE = "Dana Reyes\nSUMMARY\nPlatform engineer with 8 years running Kubernetes.\nEXPERIENCE\nStaff Engineer — Acme (2019 – present)";
const INPUT = { kind: "resume" as const, baseline: BASELINE, profileTerms: ["Kubernetes"] };

function respondingWith(text: string): AnthropicFactory {
  return () => ({ messages: { create: async () => ({ content: [{ type: "text", text }] }) } });
}

describe("parsePolished", () => {
  it("unwraps a fenced answer, trims, and refuses something too short to be a document", () => {
    expect(parsePolished("```text\nDana Reyes\nSUMMARY\nPlatform engineer with 8 years of Kubernetes.\n```")).toBe("Dana Reyes\nSUMMARY\nPlatform engineer with 8 years of Kubernetes.");
    expect(parsePolished("OK")).toBeNull();
  });
});

describe("with no credential", () => {
  it("is Not Connected, names the variable, and never calls the provider", async () => {
    expect(polishAvailability().available).toBe(false);
    expect(polishAvailability().detail).toContain("ANTHROPIC_API_KEY");
    const create = vi.fn();
    const outcome = await generatePolishedDocument(INPUT, () => ({ messages: { create } }));
    expect(outcome.status).toBe("not_connected");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("with a credential", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = `sk-ant-${"a".repeat(40)}`;
  });

  it("returns a faithful rewording as polished, with the model and the check", async () => {
    const outcome = await generatePolishedDocument(
      INPUT,
      respondingWith("Dana Reyes\nSUMMARY\nA platform engineer with 8 years of Kubernetes operations.\nEXPERIENCE\nStaff Engineer — Acme (2019 – present)"),
    );
    expect(outcome.status).toBe("polished");
    if (outcome.status !== "polished") throw new Error("unreachable");
    expect(outcome.model).toBe("claude-opus-5");
    expect(outcome.check.passed).toBe(true);
    expect(outcome.detail).toContain("Polished by claude-opus-5");
    expect(outcome.detail).toContain("nothing added");
  });

  it("rejects a variant that adds, naming the additions, and keeps the text out of the label", async () => {
    const outcome = await generatePolishedDocument(
      INPUT,
      respondingWith("Dana Reyes\nSUMMARY\nPlatform engineer with 15 years running Kubernetes and Terraform.\nEXPERIENCE\nStaff Engineer — Acme (2019 – present)"),
    );
    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") throw new Error("unreachable");
    expect(outcome.check.violations).toEqual(expect.arrayContaining([{ kind: "term", value: "Terraform" }, { kind: "number", value: "15" }]));
    expect(outcome.detail).toContain("nothing was saved");
    expect(outcome.detail).toContain("Terraform (term)");
  });

  it("hands the model the baseline with the rewrite-only instruction, and nothing else", async () => {
    const create = vi.fn(async () => ({ content: [{ type: "text", text: BASELINE }] }));
    await generatePolishedDocument(INPUT, () => ({ messages: { create } }));
    const body = (create.mock.calls as unknown as Array<[{ system: string; messages: Array<{ content: string }> }]>)[0]![0];
    expect(body.system).toBe(POLISH_SYSTEM_PROMPT);
    expect(body.system).toContain("do not add any that the text does not contain");
    expect(body.messages[0]!.content).toBe(polishPrompt("resume", BASELINE));
  });

  it("is failed, never polished, for an unreadable answer or a thrown call", async () => {
    const short = await generatePolishedDocument(INPUT, respondingWith("Sure!"));
    expect(short.status).toBe("failed");
    const thrown = await generatePolishedDocument(INPUT, () => ({ messages: { create: async () => { throw new Error("overloaded"); } } }));
    expect(thrown.status).toBe("failed");
    expect(thrown.detail).toContain("overloaded");
  });
});
