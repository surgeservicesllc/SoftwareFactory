import { describe, expect, it } from "vitest";

import {
  assignBotSchema,
  fromDatabaseRiskLevel,
  registerBotSchema,
  saveBotRoleSchema,
  toDatabaseRiskLevel,
  updateAssignmentSchema,
} from "@/lib/bots/schemas";

const uuid = "11111111-2222-4333-8444-555555555555";

describe("registerBotSchema", () => {
  it("accepts a minimal registration", () => {
    const parsed = registerBotSchema.safeParse({
      name: "Claude",
      provider: "anthropic",
      model: "claude-opus-5",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown provider", () => {
    expect(
      registerBotSchema.safeParse({ name: "Bot", provider: "skynet", model: "x" }).success,
    ).toBe(false);
  });

  it("rejects unexpected fields so a credential cannot ride along", () => {
    expect(
      registerBotSchema.safeParse({
        name: "Claude",
        provider: "anthropic",
        model: "claude-opus-5",
        apiKey: "sk-should-not-be-accepted",
      }).success,
    ).toBe(false);
  });

  it("rejects a non-HTTPS endpoint", () => {
    expect(
      registerBotSchema.safeParse({
        name: "Gateway",
        provider: "custom",
        model: "local",
        baseUrl: "http://gateway.internal",
      }).success,
    ).toBe(false);
  });

  it("rejects an empty name or model", () => {
    expect(
      registerBotSchema.safeParse({ name: "  ", provider: "anthropic", model: "m" }).success,
    ).toBe(false);
    expect(
      registerBotSchema.safeParse({ name: "Claude", provider: "anthropic", model: "" }).success,
    ).toBe(false);
  });
});

describe("saveBotRoleSchema", () => {
  const valid = {
    name: "Frontend engineer",
    slug: "frontend-engineer",
    summary: "Builds interface work.",
    instructions: "Implement interface changes.",
    riskCeiling: "GREEN" as const,
    capabilities: ["ui", "accessibility"],
  };

  it("accepts a well-formed role and defaults capabilities", () => {
    const parsed = saveBotRoleSchema.safeParse({ ...valid, capabilities: undefined });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.capabilities).toEqual([]);
  });

  it("rejects a slug with spaces or capitals", () => {
    expect(saveBotRoleSchema.safeParse({ ...valid, slug: "Front End" }).success).toBe(false);
  });

  it("rejects more than twelve capabilities", () => {
    expect(
      saveBotRoleSchema.safeParse({
        ...valid,
        capabilities: Array.from({ length: 13 }, (_, index) => `cap-${index}`),
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown risk ceiling", () => {
    expect(saveBotRoleSchema.safeParse({ ...valid, riskCeiling: "BLUE" }).success).toBe(false);
  });
});

describe("assignment schemas", () => {
  it("requires three identifiers to post a bot", () => {
    expect(
      assignBotSchema.safeParse({ botId: uuid, projectId: uuid, roleId: uuid }).success,
    ).toBe(true);
    expect(assignBotSchema.safeParse({ botId: uuid, projectId: uuid }).success).toBe(false);
    expect(
      assignBotSchema.safeParse({ botId: "not-a-uuid", projectId: uuid, roleId: uuid }).success,
    ).toBe(false);
  });

  it("limits assignment status to the audited transitions", () => {
    for (const status of ["active", "paused", "released"]) {
      expect(updateAssignmentSchema.safeParse({ status }).success).toBe(true);
    }
    expect(updateAssignmentSchema.safeParse({ status: "running" }).success).toBe(false);
  });
});

describe("risk level mapping", () => {
  it("round-trips between the interface and the database enum", () => {
    expect(toDatabaseRiskLevel("GREEN")).toBe("green");
    expect(toDatabaseRiskLevel("YELLOW")).toBe("yellow");
    expect(toDatabaseRiskLevel("RED")).toBe("red");
    expect(fromDatabaseRiskLevel("red")).toBe("RED");
    expect(fromDatabaseRiskLevel("GREEN")).toBe("GREEN");
  });

  it("falls back to the safer tier for an unknown stored value", () => {
    expect(fromDatabaseRiskLevel("teal")).toBe("YELLOW");
  });
});
