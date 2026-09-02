// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  generateInterviewQuestions,
  interviewQuestionsPrompt,
  modelQuestionsAvailability,
  parseQuestions,
  type AnthropicFactory,
} from "@/lib/job-seeker/interview-questions";

/**
 * The model lane of the prep sheet (ADR-246), with the provider stubbed at
 * the SDK boundary: Not Connected without a credential and no call made;
 * generated and labeled with the model when one answers; failed, never
 * "generated", when the answer is not a list.
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

const INPUT = {
  title: "Platform Engineer",
  company: "Nordisk Teknik A/S",
  description: "Kubernetes and Terraform.",
  strengths: ["Kubernetes"],
  gaps: ["Terraform"],
};

function respondingWith(text: string): AnthropicFactory {
  return () => ({ messages: { create: async () => ({ content: [{ type: "text", text }] }) } });
}

describe("parseQuestions", () => {
  it("reads a bare or fenced JSON array of strings, trimmed, bounded, non-strings dropped", () => {
    expect(parseQuestions('["One?", " Two? ", 3, ""]')).toEqual(["One?", "Two?"]);
    expect(parseQuestions('Here you go:\n```json\n["Only?"]\n```')).toEqual(["Only?"]);
    expect(parseQuestions(JSON.stringify(Array.from({ length: 14 }, (_, i) => `Q${i}?`)))).toHaveLength(10);
    expect(parseQuestions(JSON.stringify(["x".repeat(400)]))![0]).toHaveLength(300);
  });

  it("is null for anything that is not a list of questions", () => {
    expect(parseQuestions("I cannot help with that.")).toBeNull();
    expect(parseQuestions('{"questions": []}')).toBeNull();
    expect(parseQuestions("[]")).toBeNull();
    expect(parseQuestions("[1, 2]")).toBeNull();
  });
});

describe("with no provider credential", () => {
  it("is Not Connected, names the variable, and never calls the provider", async () => {
    const availability = modelQuestionsAvailability();
    expect(availability.available).toBe(false);
    expect(availability.detail).toContain("ANTHROPIC_API_KEY");
    const create = vi.fn();
    const result = await generateInterviewQuestions(INPUT, () => ({ messages: { create } }));
    expect(result.status).toBe("not_connected");
    expect(result.questions).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it("stays Not Connected when the owner switched the provider off", async () => {
    process.env.ANTHROPIC_API_KEY = `sk-ant-${"a".repeat(40)}`;
    process.env.ANTHROPIC_PROVIDER_DISABLED = "true";
    const result = await generateInterviewQuestions(INPUT, respondingWith('["Q?"]'));
    expect(result.status).toBe("not_connected");
    expect(result.detail).toContain("ANTHROPIC_PROVIDER_DISABLED");
  });
});

describe("with a credential configured", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = `sk-ant-${"a".repeat(40)}`;
  });

  it("returns the questions labeled with the model that wrote them", async () => {
    const result = await generateInterviewQuestions(INPUT, respondingWith('["How did you run Kubernetes?", "What do you know of Terraform?"]'));
    expect(result.status).toBe("generated");
    expect(result.model).toBe("claude-opus-5");
    expect(result.questions).toHaveLength(2);
    expect(result.detail).toContain("Written by claude-opus-5");
    expect(result.detail).toContain("none of them is a recorded fact");
  });

  it("sends the posting and the recorded facts, and nothing tells the model to invent", async () => {
    const create = vi.fn(async () => ({ content: [{ type: "text", text: '["Q?"]' }] }));
    await generateInterviewQuestions(INPUT, () => ({ messages: { create } }));
    const body = (create.mock.calls as unknown as Array<[{ system: string; messages: Array<{ content: string }> }]>)[0]![0];
    expect(body.system).toContain("Do not invent facts");
    expect(body.messages[0]!.content).toBe(interviewQuestionsPrompt(INPUT));
    expect(body.messages[0]!.content).toContain("Terms the posting names that the candidate's profile does not: Terraform.");
  });

  it("reports failure, never a generated list, when the answer is not a list or the call throws", async () => {
    const prose = await generateInterviewQuestions(INPUT, respondingWith("Sure! Here are some thoughts."));
    expect(prose.status).toBe("failed");
    expect(prose.questions).toEqual([]);
    const thrown = await generateInterviewQuestions(INPUT, () => ({ messages: { create: async () => { throw new Error("rate limited"); } } }));
    expect(thrown.status).toBe("failed");
    expect(thrown.detail).toContain("rate limited");
  });
});
