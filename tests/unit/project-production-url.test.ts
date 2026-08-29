import { describe, expect, it } from "vitest";

import { normalizeProjectProductionUrl } from "@/lib/projects/production-url";

describe("project production URL validation", () => {
  it.each([
    ["https://www.theagoras.com", "https://www.theagoras.com"],
    [" HTTPS://WWW.THEAGORAS.COM/ ", "https://www.theagoras.com"],
    ["https://app.example.com/customer/", "https://app.example.com/customer"],
    ["https://203.0.114.10", "https://203.0.114.10"],
  ])("canonicalizes public HTTPS targets", (input, expected) => {
    expect(normalizeProjectProductionUrl(input)).toEqual({
      error: null,
      productionUrl: expected,
    });
  });

  it.each([null, undefined, "", "   "])("treats a blank value as an explicit clear", (input) => {
    expect(normalizeProjectProductionUrl(input)).toEqual({ error: null, productionUrl: null });
  });

  it.each([
    "http://www.theagoras.com",
    "https://user:password@www.theagoras.com",
    "https://www.theagoras.com?preview=true",
    "https://www.theagoras.com#health",
    "https://localhost",
    "https://service.localhost",
    "https://service.internal",
    "https://service.lan",
    "https://intranet",
    "https://127.0.0.1",
    "https://10.1.2.3",
    "https://100.64.0.1",
    "https://169.254.169.254/latest/meta-data",
    "https://172.20.1.2",
    "https://192.168.1.10",
    "https://198.18.0.1",
    "https://224.0.0.1",
    "https://[::1]",
    "https://2130706433",
    "https://0177.0.0.1",
    "https://0x7f000001",
    "https://www.theagoras.com:8443",
  ])("rejects unsafe target %s", (input) => {
    const result = normalizeProjectProductionUrl(input);
    expect(result.productionUrl).toBeNull();
    expect(result.error).toMatch(/public HTTPS URL/i);
  });
});
