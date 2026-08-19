// @vitest-environment node

import { readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Two migrations may not claim one version.
 *
 * Supabase's ledger keys on the fourteen-digit prefix, so a collision is not
 * a naming quibble: one file gets recorded, the other is skipped forever, and
 * `migration repair` cannot tell them apart. It happened on 2026-08-19 —
 * `20260819000700` was taken by an ADR-036 security fix and then reused by a
 * branch that predated it. Production ended up recording the version while
 * the constraint the version now names had never run. Ninety-seven tests went
 * red; the silent half was worse.
 */
describe("migration versions", () => {
  const files = readdirSync(resolve(import.meta.dirname, "../../supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  it("are unique, because the ledger cannot hold two files under one version", () => {
    const byVersion = new Map<string, string[]>();
    for (const file of files) {
      const version = /^(\d{14})_/.exec(file)?.[1];
      if (!version) continue;
      byVersion.set(version, [...(byVersion.get(version) ?? []), file]);
    }
    const collisions = [...byVersion.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([version, names]) => `${version}: ${names.join(" and ")}`);

    expect(collisions, collisions.join("; ")).toEqual([]);
  });

  it("all carry a fourteen-digit version the tooling can read", () => {
    const malformed = files.filter((file) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(file));
    expect(malformed, malformed.join(", ")).toEqual([]);
  });
});
