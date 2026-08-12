// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  isSupabaseServiceRoleCredential,
  SupabaseConfigurationError,
  validateSupabasePublicEnvironment,
} from "@/lib/supabase/config";

function jwtWithRole(role: string) {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256" })}.${encode({ role })}.signature`;
}

describe("Supabase public configuration", () => {
  it("normalizes a valid HTTPS project URL", () => {
    expect(
      validateSupabasePublicEnvironment(
        " https://example.supabase.co/ ",
        " sb_publishable_example ",
      ),
    ).toEqual({
      publishableKey: "sb_publishable_example",
      url: "https://example.supabase.co",
    });
  });

  it("allows HTTP only for a local Supabase runtime", () => {
    expect(
      validateSupabasePublicEnvironment(
        "http://127.0.0.1:54321",
        "local-publishable-key",
      ).url,
    ).toBe("http://127.0.0.1:54321");

    expect(() =>
      validateSupabasePublicEnvironment(
        "http://example.supabase.co",
        "publishable-key",
      ),
    ).toThrow(SupabaseConfigurationError);
  });

  it("fails closed when either public value is missing", () => {
    expect(() => validateSupabasePublicEnvironment(undefined, "key")).toThrow(
      /not configured/i,
    );
    expect(() =>
      validateSupabasePublicEnvironment("https://example.supabase.co", ""),
    ).toThrow(/not configured/i);
  });

  it("rejects both current and legacy service-role credentials", () => {
    expect(isSupabaseServiceRoleCredential("sb_secret_example")).toBe(true);
    expect(isSupabaseServiceRoleCredential(jwtWithRole("service_role"))).toBe(
      true,
    );
    expect(isSupabaseServiceRoleCredential(jwtWithRole("anon"))).toBe(false);

    expect(() =>
      validateSupabasePublicEnvironment(
        "https://example.supabase.co",
        jwtWithRole("service_role"),
      ),
    ).toThrow(/service-role/i);
  });
});
