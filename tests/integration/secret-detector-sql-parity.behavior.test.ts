// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { hasLikelySecret } = await import("@/lib/worker/redact");
const { findSensitiveData } = await import("@/lib/server/sensitive-data");

/**
 * The third copy.
 *
 * `public.text_has_likely_secret` backs CHECK constraints across the schema and
 * is the last thing standing between a credential-shaped string and a stored
 * row. It is a third implementation of the rule that
 * `lib/server/sensitive-data.ts` and `lib/worker/redact.ts` also implement, and
 * two of those three had already drifted apart once.
 *
 * The unit-level parity test pins the two TypeScript copies against each other.
 * This one runs the actual SQL against the same shapes on real PostgreSQL,
 * rather than translating a POSIX regex into JavaScript and testing the
 * translation — which would pass while the deployed function did something else.
 */

const migrationsDirectory = resolve(import.meta.dirname, "../../supabase/migrations");

const KNOWN_SECRET_SHAPES: Record<string, string> = {
  "an AWS access key id": "AKIAIOSFODNN7EXAMPLE",
  "a Stripe live key": "sk_live_abcdefghijklmnop1234",
  "a Stripe test key": "sk_test_abcdefghijklmnop1234",
  // Restricted keys are what a careful operator uses INSTEAD of a secret
  // key, and lib/billing accepts one as a valid STRIPE_SECRET_KEY. All
  // three detectors missed it until ADR-208.
  "a Stripe restricted key": "rk_live_abcdefghijklmnop1234",
  "a GitHub personal access token": "ghp_abcdefghijklmnopqrstuvwxyz0123",
  "a GitHub fine-grained token": "github_pat_abcdefghijklmnopqrstuvwxyz0123",
  "an OpenAI-style key": "sk-abcdefghijklmnopqrstuvwxyz01",
  "a Supabase secret": "sb_secret_abcdefghijklmnopqrstuvwxyz",
  "a Vercel token": "vercel_abcdefghijklmnopqrstuvwxyz",
  "a JWT": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
};

/**
 * The definition as most recently written. Three migrations redefine this
 * function; taking the first match would test a version that no longer runs,
 * which is how the older definition's missing Stripe pattern looked like a live
 * gap when it had already been fixed.
 */
async function latestDefinition(): Promise<string> {
  const files = (await readdir(migrationsDirectory)).filter((n) => n.endsWith(".sql")).sort();
  let latest = "";
  for (const file of files) {
    const source = await readFile(resolve(migrationsDirectory, file), "utf8");
    const matches = [...source.matchAll(
      /create or replace function public\.text_has_likely_secret[\s\S]*?\$function\$;/g,
    )];
    const found = matches.at(-1);
    if (found) latest = found[0];
  }
  return latest;
}

describe("the database's secret detector agrees with both TypeScript ones", () => {
  let db: PGlite;

  beforeAll(async () => {
    const definition = await latestDefinition();
    expect(definition, "no definition of text_has_likely_secret was found").not.toBe("");

    db = new PGlite();
    // The function depends on nothing, so it is applied on its own rather than
    // replaying the whole chain for one regex.
    await db.exec(definition);
  });

  afterAll(async () => {
    await db.close();
  });

  for (const [name, value] of Object.entries(KNOWN_SECRET_SHAPES)) {
    it(`refuses to store ${name}`, async () => {
      const { rows } = await db.query<{ flagged: boolean }>(
        "select public.text_has_likely_secret($1) as flagged",
        [value],
      );

      expect(rows[0]?.flagged, `${name} would be storable`).toBe(true);
      // All three, or the boundary is only as strong as whichever runs.
      expect(hasLikelySecret(value), `${name} passes the worker detector`).toBe(true);
      expect(findSensitiveData(value), `${name} passes the server detector`).not.toBeNull();
    });
  }

  it("leaves ordinary text alone", async () => {
    for (const value of ["a sentence about tokens", "widget-name", "https://example.com/x"]) {
      const { rows } = await db.query<{ flagged: boolean }>(
        "select public.text_has_likely_secret($1) as flagged",
        [value],
      );
      expect(rows[0]?.flagged, `${value} was wrongly flagged`).toBe(false);
    }
  });

  it("still lets a Stripe PUBLISHABLE key through, in all three", async () => {
    /*
     * `pk_` is meant to be public — it ships in browser bundles. ADR-208
     * widened the Stripe pattern from `sk_` to `[sr]k_` to cover restricted
     * keys, and the obvious next "tidy" is to make it `[sprk]k_` and catch
     * publishable ones too.
     *
     * Don't. Flagging a key that belongs in a page teaches people that the
     * warning is noise, and a warning nobody believes protects nothing.
     * This test is here to make that choice deliberate rather than
     * something the next person quietly reverses.
     */
    const publishable = ["pk", "live", "abcdefghijklmnop1234"].join("_");
    const { rows } = await db.query<{ flagged: boolean }>(
      "select public.text_has_likely_secret($1) as flagged",
      [publishable],
    );
    expect(rows[0]?.flagged, "a publishable key was flagged as a secret").toBe(false);
    expect(hasLikelySecret(publishable)).toBe(false);
    expect(findSensitiveData(publishable)).toBeNull();
  });
});
