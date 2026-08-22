// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireBotFabricManager = vi.fn();
vi.mock("@/lib/bots/route", async () => {
  const actual = await vi.importActual<typeof import("@/lib/bots/route")>("@/lib/bots/route");
  return { ...actual, requireBotFabricManager };
});

const { POST } = await import("@/app/api/bots/route");

function request(provider: "custom" | "selfhosted", baseUrl?: string) {
  return new Request("https://factory.test/api/bots", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "factory.test",
      origin: "https://factory.test",
    },
    body: JSON.stringify({
      name: "Private gateway",
      provider,
      model: "qwen2.5-coder:32b",
      ...(baseUrl === undefined ? {} : { baseUrl }),
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/bots", () => {
  it.each([
    ["selfhosted", undefined],
    ["selfhosted", "   "],
    ["custom", undefined],
    ["custom", ""],
  ] as const)("rejects %s registration with endpoint %p before authorization or storage", async (
    provider,
    baseUrl,
  ) => {
    const response = await POST(request(provider, baseUrl));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_bot",
        message:
          "Choose a provider, then set a valid name, model identifier, and any required HTTPS endpoint.",
      },
    });
    expect(requireBotFabricManager).not.toHaveBeenCalled();
  });
});
