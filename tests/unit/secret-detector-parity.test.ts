// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { findSensitiveData } from "@/lib/server/sensitive-data";
import { hasLikelySecret, redactText } from "@/lib/worker/redact";

/**
 * Two detectors, one property.
 *
 * `lib/server/sensitive-data.ts` decides what may be stored; `lib/worker/redact.ts`
 * decides what a worker may commit and what appears in its logs. They are
 * separate implementations because they answer at different boundaries, and
 * they had drifted: the worker's list was missing AWS access keys and Stripe
 * keys, so a shape the server refused to store could be committed to a branch
 * and printed in the clear.
 *
 * This pins agreement on the shapes rather than coupling the implementations —
 * either list may hold extra patterns, but neither may miss one of these.
 */

const KNOWN_SECRET_SHAPES: Record<string, string> = {
  "an AWS access key id": "AKIAIOSFODNN7EXAMPLE",
  "a Stripe live key": "sk_live_abcdefghijklmnop1234",
  "a Stripe test key": "sk_test_abcdefghijklmnop1234",
  "a GitHub personal access token": "ghp_abcdefghijklmnopqrstuvwxyz0123",
  "a GitHub fine-grained token": "github_pat_abcdefghijklmnopqrstuvwxyz0123",
  "an OpenAI-style key": "sk-abcdefghijklmnopqrstuvwxyz01",
  "a Supabase secret": "sb_secret_abcdefghijklmnopqrstuvwxyz",
  "a Vercel token": "vercel_abcdefghijklmnopqrstuvwxyz",
  "a JWT": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
  "a private key block": "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
};

describe("the worker's detector recognises every shape the server refuses", () => {
  for (const [name, value] of Object.entries(KNOWN_SECRET_SHAPES)) {
    it(`flags ${name}`, () => {
      // policy-scan.ts consults this before a worker may commit a file.
      expect(hasLikelySecret(value), `${name} was not detected`).toBe(true);
    });

    it(`redacts ${name} out of worker output`, () => {
      const redacted = redactText(`value: ${value}`);
      expect(redacted).toContain("[REDACTED]");
      // The point is the value itself is gone, not merely that a marker appeared.
      expect(redacted).not.toContain(value);
    });
  }
});

describe("the server's detector recognises them too", () => {
  for (const [name, value] of Object.entries(KNOWN_SECRET_SHAPES)) {
    it(`flags ${name}`, () => {
      // Returns the first finding or null, rather than a list.
      expect(findSensitiveData(value), `${name} was not detected`).not.toBeNull();
    });
  }
});

describe("ordinary content is not flagged", () => {
  it.each([
    "a normal sentence about tokens and passwords",
    "const name = \"widget\";",
    "https://example.com/path/to/thing",
    "sk-short",
  ])("leaves %s alone", (value) => {
    // A detector that flags everything gets turned off.
    expect(hasLikelySecret(value)).toBe(false);
  });
});
