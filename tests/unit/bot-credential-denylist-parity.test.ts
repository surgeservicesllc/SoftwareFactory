// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { PRIVILEGED_CREDENTIAL_REF_NAMES } = await import("@/lib/bots/credentials");

/**
 * ADR-036 says privileged reference names are "rejected by both the application
 * allowlist and a table CHECK constraint". Both, because they cover different
 * cases: the allowlist only runs when the application is in the path, and
 * `register_bot` is granted to `authenticated`, so an organization manager can
 * call it directly through PostgREST. `normalize_bot_credential_ref` checks the
 * shape of a reference and nothing else.
 *
 * They had drifted by five names — GITHUB_CLIENT_ID, POSTGRES_URL,
 * SUPABASE_ACCESS_TOKEN, SUPABASE_SECRET_KEY, VERCEL_OIDC_TOKEN — all missing
 * from the constraint, which is the half that holds when the first is skipped.
 *
 * This reads the live constraint out of the migration directory rather than
 * restating it, so adding a name to one side and not the other fails here.
 */

const migrationsDirectory = resolve(import.meta.dirname, "../../supabase/migrations");

/** The constraint as most recently defined, since a later migration may replace it. */
function currentConstraintSource(): string {
  const files = readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql")).sort();
  let latest = "";
  for (const file of files) {
    const source = readFileSync(resolve(migrationsDirectory, file), "utf8");
    const matches = [...source.matchAll(
      /add constraint bots_credential_ref_not_privileged check \(([\s\S]*?)\n {2}\)/g,
    )];
    const inline = [...source.matchAll(
      /constraint bots_credential_ref_not_privileged check \(([\s\S]*?)\n {2}\),/g,
    )];
    const found = matches.at(-1) ?? inline.at(-1);
    if (found) latest = found[1];
  }
  return latest;
}

describe("the privileged credential denylist", () => {
  it("is defined in a migration at all", () => {
    // If the shape of the constraint changes, every assertion below would pass
    // vacuously by matching nothing.
    expect(currentConstraintSource()).not.toBe("");
  });

  it("refuses in the database every name the application refuses", () => {
    const constraint = currentConstraintSource();
    const missing = PRIVILEGED_CREDENTIAL_REF_NAMES.filter(
      (name) => !constraint.includes(`'${name}'`),
    );

    expect(
      missing,
      `These names are refused by lib/bots/credentials.ts but not by the table CHECK, so a `
        + `direct RPC call would store them: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("still refuses publishable variables", () => {
    // Not privileged, but a bot referencing one is a configuration mistake.
    expect(currentConstraintSource()).toContain("NEXT\\_PUBLIC\\_%");
  });

  it("names every control-plane surface the application knows about", () => {
    // A spot check that the exported list is the real one rather than a stub
    // that would make the comparison above trivially satisfied.
    for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "GITHUB_APP_PRIVATE_KEY", "VERCEL_TOKEN"]) {
      expect(PRIVILEGED_CREDENTIAL_REF_NAMES).toContain(name);
    }
    expect(PRIVILEGED_CREDENTIAL_REF_NAMES.length).toBeGreaterThanOrEqual(14);
  });
});
