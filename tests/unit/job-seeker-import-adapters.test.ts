import { describe, expect, it } from "vitest";

import { listImportAdapters } from "@/lib/job-seeker/import-adapters";

/**
 * The registry's honesty contract: an adapter is configured only when the
 * exact configuration it names actually exists, and an unconfigured adapter
 * carries no fetch implementation at all — there is nothing to call, so
 * there is nothing that could invent a job.
 */
describe("listImportAdapters", () => {
  it("reports every adapter unconfigured in an empty environment, with its needs named", () => {
    const adapters = listImportAdapters({} as unknown as NodeJS.ProcessEnv);

    expect(adapters.length).toBeGreaterThan(0);
    for (const adapter of adapters) {
      expect(adapter.configured).toBe(false);
      expect(adapter.requiredConfiguration.length).toBeGreaterThan(0);
      expect(adapter.fetchJobs).toBeUndefined();
    }
  });

  it("flips configured by detection of the named variables, never by assertion", () => {
    const adapters = listImportAdapters({
      SOFTWAREFACTORY_GREENHOUSE_BOARDS: "acme,meridian",
    } as unknown as NodeJS.ProcessEnv);

    expect(adapters.find((a) => a.key === "greenhouse")?.configured).toBe(true);
    expect(adapters.find((a) => a.key === "lever")?.configured).toBe(false);
    // Partial configuration is not configuration.
    const partial = listImportAdapters({
      SOFTWAREFACTORY_LINKEDIN_CLIENT_ID: "id-only",
    } as unknown as NodeJS.ProcessEnv);
    expect(partial.find((a) => a.key === "linkedin")?.configured).toBe(false);
  });

  it("gives every adapter a recordable source key", () => {
    for (const adapter of listImportAdapters({} as unknown as NodeJS.ProcessEnv)) {
      expect(adapter.key).toMatch(/^[a-z][a-z0-9_]{0,62}$/);
    }
  });
});
