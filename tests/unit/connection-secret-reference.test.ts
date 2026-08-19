// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { resolveSecretReference } = await import("@/lib/connections/secret-reference");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveSecretReference", () => {
  it("dereferences an env reference to the variable's value", () => {
    vi.stubEnv("FACTORY_TEST_SECRET", "the-value");
    expect(resolveSecretReference("env://FACTORY_TEST_SECRET")).toEqual({
      status: "resolved",
      value: "the-value",
    });
  });

  it("reports an unset variable as unavailable, naming the variable and not a value", () => {
    const result = resolveSecretReference("env://FACTORY_TEST_MISSING");
    expect(result.status).toBe("unavailable");
    expect(result).not.toHaveProperty("value");
    expect((result as { reason: string }).reason).toContain("FACTORY_TEST_MISSING");
  });

  it("refuses a malformed environment name instead of probing the environment", () => {
    for (const reference of ["env://lower_case", "env://1BAD", "env://A B", "env://"]) {
      expect(resolveSecretReference(reference).status).toBe("invalid");
    }
  });

  it("refuses vault schemes by name because no client exists here", () => {
    for (const reference of [
      "vault://factory/vercel",
      "secret-manager://projects/x/secrets/y",
      "supabase-vault://vercel-token",
    ]) {
      const result = resolveSecretReference(reference);
      expect(result.status).toBe("unsupported");
      expect((result as { reason: string }).reason).toMatch(/client exists/);
    }
  });

  it("rejects unknown schemes outright", () => {
    expect(resolveSecretReference("file:///etc/passwd").status).toBe("invalid");
    expect(resolveSecretReference("VERCEL_TOKEN").status).toBe("invalid");
  });
});
