// @vitest-environment node

import { readdirSync, readFileSync } from "node:fs";
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

/**
 * A function defined by more than one replayed migration must be dropped
 * before each definition.
 *
 * `scope=broker-functions` re-runs every listed file in order, every time.
 * That is deliberate — it makes the apply idempotent — but it means an
 * earlier file redefining a function a later file has since widened will try
 * to narrow it back, and Postgres refuses to change an existing function's
 * return type. Apply run 32272188607 died exactly there, halfway through,
 * leaving a security migration unapplied behind it.
 */
describe("replayed migrations", () => {
  const workflow = readFileSync(
    resolve(import.meta.dirname, "../../.github/workflows/apply-hosted-migrations.yml"),
    "utf8",
  );
  const migrationsDir = resolve(import.meta.dirname, "../../supabase/migrations");
  // Only the files inside `for FILE in ... done` loops are re-run blindly on
  // every dispatch, which is the failure mode this rule exists for (see the
  // comment above). Single-file scoped steps run once behind their own ledger
  // and catalog preflights — command-carry-forward, for example, refuses
  // outright once the protected chain is recorded, so its submit_command
  // definition can never replay over the chain's newer one.
  const replayLoops = [...workflow.matchAll(/for FILE in \\\n([\s\S]*?)\n\s*do\b/g)]
    .map((m) => m[1]);
  const replayed = replayLoops.flatMap((loop) =>
    [...loop.matchAll(/supabase\/migrations\/(\S+\.sql)/g)].map((m) => m[1]),
  );

  it("drop a function first wherever two of them define the same one", () => {
    const definitions = new Map<string, string[]>();
    const bodies = new Map<string, string>();
    for (const file of new Set(replayed)) {
      let body: string;
      try {
        body = readFileSync(resolve(migrationsDir, file), "utf8");
      } catch {
        continue;
      }
      bodies.set(file, body);
      for (const match of body.matchAll(/create or replace function public\.(\w+)\s*\(/g)) {
        definitions.set(match[1], [...(definitions.get(match[1]) ?? []), file]);
      }
    }

    const unguarded: string[] = [];
    for (const [fn, files] of definitions) {
      if (files.length < 2) continue;
      for (const file of files) {
        const body = bodies.get(file) ?? "";
        if (!new RegExp(`drop function if exists public\\.${fn}\\b`).test(body)) {
          unguarded.push(`${file} redefines ${fn} without dropping it first`);
        }
      }
    }
    expect(unguarded, unguarded.join("; ")).toEqual([]);
  });
});
