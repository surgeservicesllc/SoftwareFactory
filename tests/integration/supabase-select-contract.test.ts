// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Every `.from("table").select("columns")` the application makes, checked
 * against the migrated schema.
 *
 * `supabase-rpc-contract` does the same for `.rpc(...)`, and it stops there —
 * so the 70 table reads in this repository were unguarded. The failure is
 * identical in shape and identical in consequence: `.select("statuss")`
 * type-checks, lints, and passes every unit test, because the client accepts an
 * arbitrary string and PostgREST only rejects it at request time, against a
 * real database, in production.
 *
 * This was not hypothetical when the test was written. The portfolio route was
 * built by first grepping the migrations for `project_id`, `status` and
 * `organization_id` on five tables, precisely because nothing would have caught
 * a wrong guess.
 *
 * Scope, stated so a reader knows what a pass means:
 *
 * - Only string literals are parsed. A `.select(someVariable)` is skipped
 *   rather than guessed at, and skipped sites are counted so the coverage
 *   number is honest.
 * - Embedded resources (`connections(status,provider)`) are checked as a
 *   relationship name against the tables, not as columns, because PostgREST
 *   resolves those through foreign keys.
 * - Modifiers like `count`, `!inner` and aliases are stripped before matching.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const searchRoots = ["app", "lib", "scripts"];

interface SelectSite {
  readonly file: string;
  readonly table: string;
  /** Null when the select argument was not a literal, or absent entirely. */
  readonly columns: readonly string[] | null;
  /** Embedded relationship names, checked as tables rather than columns. */
  readonly embeds: readonly string[];
}

let db: PGlite;
const sites: SelectSite[] = [];
const tables = new Map<string, Set<string>>();
let skipped = 0;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(full)));
    else if (/\.(ts|tsx|mts)$/.test(entry.name)) files.push(full);
  }
  return files;
}

/** `.from("x").select("a,b,rel(c)")` → table, plain columns, embed names. */
function parseSelects(source: string, file: string): SelectSite[] {
  const found: SelectSite[] = [];
  // Find each `.from("table")`, then scan a bounded window after it for the
  // matching `.select(...)`, stopping at the next `.from(` so a chain's select
  // is never attributed to the previous table.
  //
  // Deliberately not one regex: an earlier version ended the window with a
  // `(?=\.from\(|$)` lookahead, which silently dropped every call site followed
  // by more than the window size without another `.from(` — two thirds of them.
  const pattern = /\.from\(\s*"([a-z_]+)"\s*\)/g;

  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    const table = match[1];
    const from = match.index + match[0].length;
    const window = source.slice(from, from + 400);
    const nextFrom = window.indexOf(".from(");
    const tail = nextFrom === -1 ? window : window.slice(0, nextFrom);
    const select = /\.select\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/.exec(tail);

    if (!select) {
      // `.select()` with no literal, or a call with no select at all (insert,
      // update, delete). Nothing to verify; the table itself still is.
      found.push({ file, table, columns: null, embeds: [] });
      continue;
    }

    const raw = (select[1] ?? select[2] ?? select[3] ?? "").trim();
    if (raw === "" || raw === "*") {
      found.push({ file, table, columns: [], embeds: [] });
      continue;
    }

    const columns: string[] = [];
    const embeds: string[] = [];
    // Split on top-level commas so `rel(a,b)` stays one token.
    let depth = 0;
    let token = "";
    for (const character of raw) {
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      if (character === "," && depth === 0) {
        if (token.trim()) tokens(token, columns, embeds);
        token = "";
        continue;
      }
      token += character;
    }
    if (token.trim()) tokens(token, columns, embeds);

    found.push({ file, table, columns, embeds });
  }

  return found;
}

function tokens(token: string, columns: string[], embeds: string[]) {
  const trimmed = token.trim();
  const embed = /^([a-z_]+)(?:![a-z]+)?\s*\(/.exec(trimmed);
  if (embed) {
    embeds.push(embed[1]);
    return;
  }
  // Strip an alias (`alias:column`) and any cast or modifier suffix.
  const withoutAlias = trimmed.includes(":") ? trimmed.slice(trimmed.indexOf(":") + 1) : trimmed;
  const name = withoutAlias.replace(/![a-z]+/g, "").split("::")[0].trim();
  if (name && name !== "*" && name !== "count") columns.push(name);
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema if not exists auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create or replace function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  `);

  const files = (await readdir(migrationsDirectory)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
  }

  const catalogue = await db.query<{ table_name: string; column_name: string }>(`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
  `);
  for (const row of catalogue.rows) {
    if (!tables.has(row.table_name)) tables.set(row.table_name, new Set());
    tables.get(row.table_name)!.add(row.column_name);
  }

  for (const root of searchRoots) {
    for (const file of await sourceFiles(resolve(repositoryRoot, root))) {
      const parsed = parseSelects(await readFile(file, "utf8"), file.replace(`${repositoryRoot}/`, ""));
      for (const site of parsed) {
        if (site.columns === null) skipped += 1;
        sites.push(site);
      }
    }
  }
}, 600_000);

afterAll(async () => {
  await db?.close();
});

describe("every .from() names a real relation", () => {
  it("found call sites to check, so a pass is not vacuous", () => {
    expect(sites.length).toBeGreaterThan(30);
    expect(tables.size).toBeGreaterThan(50);
  });

  it("references no table or view that does not exist", async () => {
    // Views are legitimate read targets, so the catalogue includes both.
    const unknown = sites
      .filter((site) => !tables.has(site.table))
      .map((site) => `${site.file}: ${site.table}`);

    expect([...new Set(unknown)]).toEqual([]);
  });
});

describe("every .select() names real columns", () => {
  it("references no column that does not exist on its table", () => {
    const wrong: string[] = [];

    for (const site of sites) {
      const columns = tables.get(site.table);
      if (!columns || site.columns === null) continue;
      for (const column of site.columns) {
        if (!columns.has(column)) wrong.push(`${site.file}: ${site.table}.${column}`);
      }
    }

    expect([...new Set(wrong)]).toEqual([]);
  });

  it("embeds only relations that exist", () => {
    const wrong: string[] = [];

    for (const site of sites) {
      for (const embed of site.embeds) {
        if (!tables.has(embed)) wrong.push(`${site.file}: ${site.table} -> ${embed}`);
      }
    }

    expect([...new Set(wrong)]).toEqual([]);
  });

  it("reports how many sites could not be checked, so coverage is honest", () => {
    // A dynamic select is skipped rather than guessed at. This asserts the
    // proportion stays small; a jump means the guard is quietly covering less.
    expect(skipped).toBeLessThan(sites.length / 2);
  });
});
