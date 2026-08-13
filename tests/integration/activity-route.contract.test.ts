// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

describe("live activity route contract", () => {
  const route = readFileSync(resolve(repositoryRoot, "app/api/activity/route.ts"), "utf8");

  it("is scoped to the authenticated active organization", () => {
    expect(route).toMatch(/requireActiveOrganization\(\)/);
    expect(route).toContain('client.rpc("list_activity"');
    expect(route).toContain("p_organization_id: activeOrganization.id");
    expect(route).not.toContain('.from("activity_events")');
  });

  it("returns bounded redacted evidence without returning the provider metadata object", () => {
    expect(route).toMatch(/\.max\(100\)/);
    expect(route).toContain("activityEvidenceFromMetadata(event.evidence)");
    expect(route).not.toMatch(/event\.metadata/);
    expect(route).not.toMatch(/metadata:\s*event\.metadata/);
    expect(route).not.toMatch(/\.\.\.event\.metadata/);
  });

  it("allowlists the evidence needed to identify an activity event", () => {
    expect(route).toContain('["delivery_id", "delivery"]');
    expect(route).toContain('["connection_id", "connection"]');
    expect(route).toContain("github_actor");
    expect(route).toContain("state_transition");
    expect(route).toContain("conclusion");
    expect(route).toContain("event.entity_id");
  });
});
