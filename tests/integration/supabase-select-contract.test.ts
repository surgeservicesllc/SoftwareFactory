// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

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
/**
 * The shared column lists, resolved from source.
 *
 * Almost every route in this codebase selects through a constant —
 * `.select(CRM_ACCOUNT_COLUMNS)` — rather than an inline string, which is
 * good practice and used to make this guard blind: a non-literal argument
 * was counted as unverifiable and skipped. That quietly put most of the CRM
 * outside the check it was written for.
 *
 * So the constants are read first and substituted. A `.select(IDENT)` whose
 * IDENT resolves to a string literal is checked exactly as an inline one is.
 */
function collectColumnConstants(sources: { file: string; text: string }[]): Map<string, string> {
  const constants = new Map<string, string>();
  const declaration = /export const ([A-Z][A-Z0-9_]*)\s*(?::\s*string)?\s*=\s*\n?\s*"([^"]*)"\s*;/g;
  for (const { text } of sources) {
    for (
      let match = declaration.exec(text);
      match !== null;
      match = declaration.exec(text)
    ) {
      constants.set(match[1], match[2]);
    }
  }
  return constants;
}

function parseSelects(
  source: string,
  file: string,
  constants: Map<string, string> = new Map(),
): SelectSite[] {
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
    const select =
      /\.select\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([A-Z][A-Z0-9_]*)\s*[,)])/.exec(tail);

    // A constant that resolves is as good as a literal; one that does not is
    // still honestly counted as unchecked.
    const named = select?.[4];
    const resolved = named === undefined ? undefined : constants.get(named);
    if (select && named !== undefined && resolved === undefined) {
      found.push({ file, table, columns: null, embeds: [] });
      continue;
    }

    if (!select) {
      // `.select()` with no literal, or a call with no select at all (insert,
      // update, delete). Nothing to verify; the table itself still is.
      found.push({ file, table, columns: null, embeds: [] });
      continue;
    }

    const raw = (select[1] ?? select[2] ?? select[3] ?? resolved ?? "").trim();
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
  // The chain, restored from a snapshot rather than replayed; the
  // helper keys its cache on the CONTENT of every migration, and
  // asserts coverage of the whole directory.
  db = await createMigratedDatabase();

  const catalogue = await db.query<{ table_name: string; column_name: string }>(`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
  `);
  for (const row of catalogue.rows) {
    if (!tables.has(row.table_name)) tables.set(row.table_name, new Set());
    tables.get(row.table_name)!.add(row.column_name);
  }

  // Read every source once, resolve the shared column constants, then parse.
  const sources: { file: string; text: string }[] = [];
  for (const root of searchRoots) {
    for (const file of await sourceFiles(resolve(repositoryRoot, root))) {
      sources.push({
        file: file.replace(`${repositoryRoot}/`, ""),
        text: await readFile(file, "utf8"),
      });
    }
  }
  const constants = collectColumnConstants(sources);
  for (const { file, text } of sources) {
    for (const site of parseSelects(text, file, constants)) {
      if (site.columns === null) skipped += 1;
      sites.push(site);
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
    /*
     * A genuinely dynamic select is skipped rather than guessed at. Constants
     * are resolved (see collectColumnConstants), so what remains here is the
     * real unverifiable tail: head-count probes, `select()` with no argument,
     * and inserts. A jump means the guard is quietly covering less.
     */
    expect(skipped).toBeLessThan(sites.length / 2);
  });

  it("resolves the shared column constants, so the CRM is actually covered", () => {
    // The failure this catches is silent: if constant resolution broke, every
    // `.select(CRM_*_COLUMNS)` would go back to being skipped and the column
    // check above would pass vacuously over most of the product.
    const crmSites = sites.filter((site) => site.table.startsWith("crm_"));
    const checked = crmSites.filter((site) => site.columns !== null && site.columns.length > 0);
    expect(crmSites.length).toBeGreaterThan(40);
    expect(checked.length).toBeGreaterThan(crmSites.length / 2);
  });
});
