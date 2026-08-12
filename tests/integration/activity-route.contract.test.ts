// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

describe("live activity route contract", () => {
  const route = readFileSync(resolve(repositoryRoot, "app/api/activity/route.ts"), "utf8");

  it("is scoped to the authenticated active organization", () => {
    expect(route).toMatch(/requireActiveOrganization\(\)/);
    expect(route).toMatch(/\.eq\("organization_id", activeOrganization\.id\)/);
  });

  it("returns bounded redacted evidence without provider metadata", () => {
    expect(route).toMatch(/\.max\(100\)/);
    expect(route).toContain("id,project_id,actor_user_id,event_type,entity_type,entity_id,description,occurred_at");
    expect(route).not.toMatch(/\.select\([^)]*metadata/);
  });
});
