// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

/**
 * Every `.rpc(...)` the application makes, checked against the migrated schema.
 *
 * This is the one class of Supabase wiring bug that no other test here catches.
 * A route calling `.rpc("do_thing", { p_projct_id })` type-checks, lints, and
 * passes every unit test, because the client accepts an arbitrary object and
 * the failure only happens when PostgREST cannot find a matching function —
 * against a real database, at request time, in production.
 *
 * So: parse the call sites out of the source, apply the real migrations, and
 * ask the catalogue whether each function exists and accepts exactly the
 * arguments the application passes.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const searchRoots = ["app", "lib", "scripts"];

interface RpcCallSite {
  readonly file: string;
  readonly functionName: string;
  /** Parameter keys passed, or null when the argument is not an inline object. */
  readonly parameterNames: readonly string[] | null;
  /**
   * True when the object spreads another value, so the keys seen here are a
   * subset of what is actually passed. Explicit keys remain checkable; totality
   * does not, and asserting it anyway produces a false positive that gets the
   * whole test deleted.
   */
  readonly hasSpread: boolean;
}

/**
 * Remove comments from an RPC argument object before its keys are read.
 *
 * A comment above an argument is ordinary — it is where the reason for passing
 * a particular value belongs — and comment prose contains commas. The splitter
 * below breaks the object on top-level commas, so an unstripped comment splits
 * mid-sentence and the key that follows it lands in the middle of a segment
 * where the key regex cannot see it. That reads as "this call omits the
 * argument" when the call passes it, and worse, hides a misspelled key from the
 * mismatch check: prose is not code and must not be parsed as code.
 *
 * String literals are tracked so that a `//` inside a value — a URL, say — is
 * left alone. Escapes are honoured; template-literal interpolation is not
 * entered, which is enough for argument objects.
 */
function stripComments(body: string): string {
  let output = "";
  let quote: string | null = null;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index] as string;

    if (quote) {
      output += character;
      if (character === "\\") {
        index += 1;
        output += body[index] ?? "";
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      output += character;
      continue;
    }

    if (character === "/" && body[index + 1] === "/") {
      while (index < body.length && body[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }

    if (character === "/" && body[index + 1] === "*") {
      const close = body.indexOf("*/", index + 2);
      index = close === -1 ? body.length : close + 1;
      continue;
    }

    output += character;
  }
  return output;
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      files.push(...(await sourceFiles(full)));
    } else if (/\.(ts|tsx|mts)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Pull `.rpc("name", { ... })` out of a source file.
 *
 * Deliberately a parser rather than a regex over the whole call: the parameter
 * object contains nested objects and template strings, so brace counting is
 * what actually finds its end.
 */
function extractRpcCalls(file: string, source: string): RpcCallSite[] {
  const calls: RpcCallSite[] = [];
  const pattern = /\.rpc\(\s*"([a-z0-9_]+)"\s*(,)?/g;

  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    const functionName = match[1] as string;
    if (!match[2]) {
      calls.push({ file, functionName, parameterNames: [], hasSpread: false });
      continue;
    }

    let index = pattern.lastIndex;
    while (index < source.length && /\s/.test(source[index] as string)) index += 1;
    if (source[index] !== "{") {
      // A spread or a variable. Existence is still checked; argument names are not.
      calls.push({ file, functionName, parameterNames: null, hasSpread: true });
      continue;
    }

    let depth = 0;
    let end = index;
    for (; end < source.length; end += 1) {
      const character = source[end];
      if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    const body = stripComments(source.slice(index + 1, end));
    // Top-level keys only: a nested object's keys are values, not arguments.
    const parameterNames: string[] = [];
    let spread = false;
    let nested = 0;
    let bracket = 0;
    let keyStart = 0;
    for (let cursor = 0; cursor <= body.length; cursor += 1) {
      const character = body[cursor];
      if (character === "{" || character === "(") nested += 1;
      else if (character === "}" || character === ")") nested -= 1;
      else if (character === "[") bracket += 1;
      else if (character === "]") bracket -= 1;

      if ((character === "," && nested === 0 && bracket === 0) || cursor === body.length) {
        const segment = body.slice(keyStart, cursor);
        const key = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(segment);
        if (key?.[1]) parameterNames.push(key[1]);
        if (/^\s*\.\.\./.test(segment)) spread = true;
        keyStart = cursor + 1;
      }
    }

    calls.push({ file, functionName, parameterNames, hasSpread: spread });
  }

  return calls;
}

describe("Supabase RPC contract", () => {
  let db: PGlite;
  const callSites: RpcCallSite[] = [];
  let schemaFunctions = new Map<string, Set<string>[]>();

  beforeAll(async () => {
    // The chain, restored from a snapshot rather than replayed; the
    // helper keys its cache on the CONTENT of every migration, and
    // asserts coverage of the whole directory.
    db = await createMigratedDatabase();

    for (const root of searchRoots) {
      const directory = resolve(repositoryRoot, root);
      let files: string[] = [];
      try {
        files = await sourceFiles(directory);
      } catch {
        continue;
      }
      for (const file of files) {
        const source = await readFile(file, "utf8");
        if (!source.includes(".rpc(")) continue;
        callSites.push(...extractRpcCalls(file.slice(repositoryRoot.length + 1), source));
      }
    }

    // Every public function, with the argument names each overload accepts.
    const { rows } = await db.query<{ name: string; argument_names: string[] | null }>(`
      select p.proname as name,
        coalesce(p.proargnames, '{}'::text[]) as argument_names
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
    `);

    schemaFunctions = new Map();
    for (const row of rows) {
      const names = new Set((row.argument_names ?? []).filter((name) => name.startsWith("p_")));
      const existing = schemaFunctions.get(row.name) ?? [];
      existing.push(names);
      schemaFunctions.set(row.name, existing);
    }
  });

  afterAll(async () => {
    await db.close();
  });

  it("finds the RPC call sites it is meant to be checking", () => {
    // A parser that silently matched nothing would make every assertion below
    // vacuously true, which is the failure mode worth guarding first.
    expect(callSites.length).toBeGreaterThan(50);
    expect(new Set(callSites.map((call) => call.functionName)).size).toBeGreaterThan(40);
  });

  it("calls only functions that exist in the migrated schema", () => {
    const missing = callSites
      .filter((call) => !schemaFunctions.has(call.functionName))
      .map((call) => `${call.functionName} (${call.file})`);

    // A name that does not exist fails at request time against a real
    // database and nowhere else — not in typecheck, lint, or any unit test.
    expect([...new Set(missing)]).toEqual([]);
  });

  it("passes only argument names the function declares", () => {
    const mismatches: string[] = [];

    for (const call of callSites) {
      if (call.parameterNames === null) continue;
      const overloads = schemaFunctions.get(call.functionName);
      if (!overloads) continue;

      const satisfied = overloads.some((declared) =>
        call.parameterNames?.every((name) => declared.has(name)),
      );
      if (!satisfied) {
        const declared = overloads.map((set) => [...set].sort().join(",")).join(" | ");
        mismatches.push(
          `${call.functionName} in ${call.file} passes [${call.parameterNames.join(",")}] but declares [${declared}]`,
        );
      }
    }

    // A misspelled or renamed parameter is the same production-only failure as
    // a missing function, and is easier to introduce.
    expect(mismatches).toEqual([]);
  });

  it("supplies every argument that has no default", async () => {
    const { rows } = await db.query<{ name: string; required: string[] }>(`
      select p.proname as name,
        (
          select coalesce(array_agg(argument_name order by ordinality), '{}'::text[])
          from unnest(coalesce(p.proargnames, '{}'::text[])) with ordinality as a(argument_name, ordinality)
          where ordinality <= p.pronargs - p.pronargdefaults
            and argument_name like 'p\\_%'
        ) as required
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'
    `);

    const requiredByName = new Map<string, Set<string>[]>();
    for (const row of rows) {
      const existing = requiredByName.get(row.name) ?? [];
      existing.push(new Set(row.required ?? []));
      requiredByName.set(row.name, existing);
    }

    const incomplete: string[] = [];
    for (const call of callSites) {
      if (call.parameterNames === null) continue;
      // A spread supplies arguments this parser cannot see. `reserve_owner_
      // approved_protected_github_change` spreads twelve of its fifteen, and
      // flagging that would be a false positive rather than a finding.
      if (call.hasSpread) continue;
      const overloads = requiredByName.get(call.functionName);
      if (!overloads) continue;

      const passed = new Set(call.parameterNames);
      const satisfied = overloads.some((required) => [...required].every((name) => passed.has(name)));
      if (!satisfied) {
        const required = overloads.map((set) => [...set].sort().join(",")).join(" | ");
        incomplete.push(
          `${call.functionName} in ${call.file} omits a required argument; needs [${required}]`,
        );
      }
    }

    // Omitting a defaulted argument is fine and common. Omitting one without a
    // default is a call that can never succeed.
    expect(incomplete).toEqual([]);
  });
});
