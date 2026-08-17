import { describe, expect, it } from "vitest";

import { suggestTemplateForGoal } from "@/lib/graph/suggest";

describe("suggestTemplateForGoal", () => {
  it("maps intent keywords to the matching versioned template", () => {
    expect(suggestTemplateForGoal("Apply the new database migration safely")?.key).toBe("database_migration");
    expect(suggestTemplateForGoal("Audit RLS on every table")?.key).toBe("rls_audit");
    expect(suggestTemplateForGoal("Run a security review of the auth flows")?.key).toBe("security_audit");
    expect(suggestTemplateForGoal("Fix the broken refresh button")?.key).toBe("bug_sweep");
    expect(suggestTemplateForGoal("Improve SEO for the marketing pages")?.key).toBe("seo_aeo_audit");
    expect(suggestTemplateForGoal("The mobile layout overflows on small screens")?.key).toBe("mobile_audit");
    expect(suggestTemplateForGoal("Perform full audit on all pages")?.key).toBe("production_readiness");
  });

  it("falls back to the feature build for plain building goals", () => {
    expect(suggestTemplateForGoal("Add a settings page for notification preferences")?.key).toBe("feature_build");
  });

  it("suggests specific intents ahead of the generic bug match", () => {
    // "fix" appears, but the migration intent is the more specific reading.
    expect(suggestTemplateForGoal("Fix the migration that fails to apply")?.key).toBe("database_migration");
  });
});
