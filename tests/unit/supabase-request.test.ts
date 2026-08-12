// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertSameOriginRequest,
  normalizeReturnPath,
  RequestOriginError,
} from "@/lib/supabase/request";

describe("Supabase auth request safety", () => {
  it("accepts only an exact same-origin mutation", () => {
    const request = new Request("https://factory.example/api/auth/sign-in", {
      headers: { Origin: "https://factory.example" },
      method: "POST",
    });

    expect(() => assertSameOriginRequest(request)).not.toThrow();
  });

  it("rejects missing or cross-origin mutation origins", () => {
    expect(() =>
      assertSameOriginRequest(
        new Request("https://factory.example/api/auth/sign-out", {
          method: "POST",
        }),
      ),
    ).toThrow(RequestOriginError);

    expect(() =>
      assertSameOriginRequest(
        new Request("https://factory.example/api/auth/sign-out", {
          headers: { Origin: "https://attacker.example" },
          method: "POST",
        }),
      ),
    ).toThrow(RequestOriginError);
  });

  it("normalizes internal redirects and rejects open redirects", () => {
    expect(normalizeReturnPath("/projects?tab=active#top")).toBe(
      "/projects?tab=active#top",
    );
    expect(normalizeReturnPath("https://attacker.example", "/safe")).toBe(
      "/safe",
    );
    expect(normalizeReturnPath("//attacker.example", "/safe")).toBe("/safe");
  });
});
