// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The three catalog checks the apply workflow captures into a shell variable
 * — `VERIFIED=$(psql … -f …)`, `CATALOG_READY=…`, `PROTECTED_CATALOG_READY=…`
 * — were the largest inline SQL left in the workflow, and they moved out to
 * `.github/hosted-apply/guard/` for the same reason the probe and postflight
 * SQL did: the file is measured against a byte ceiling GitHub enforces at
 * 500 KB by refusing to plan the job.
 *
 * Extraction moves the hazard with it. Nothing but a production dispatch
 * executes a `psql -f` path, and run 33297041401 is what a mangled extraction
 * looks like: green everywhere, dead at the dispatch. So each file runs here,
 * against the exact state its step expects, and must print the one value the
 * step branches on — `t`. A file that parses but asks the wrong question
 * prints `f`, and the step refuses a release that should have gone.
 *
 * Two of the three are EXPAND-state checks — the bot-account-binding scope's
 * own postflight and the retired CONTRACT scope's preflight — so they are run
 * against the chain replayed up to and including 20260822000200, before the
 * CONTRACT drops the legacy mutators they name. The broad scope's check
 * describes the catalog after the whole protected chain, so it runs last,
 * against everything.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsRoot = resolve(repositoryRoot, "supabase/migrations");
const guardRoot = resolve(repositoryRoot, ".github/hosted-apply/guard");

const EXPAND = "20260822000200_register_bot_for_ai_account.sql";
const CONTRACT = "20260822000300_contract_bot_mutator_acls.sql";

let db: PGlite;
let workflow = "";

/** What each capture printed at the point in the chain its step expects. */
const captured: Record<string, unknown> = {};

async function replay(files: string[]): Promise<void> {
  for (const file of files) {
    await db.exec(await readFile(resolve(migrationsRoot, file), "utf8"));
  }
}

/**
 * Runs a guard file the way its step does — one psql session, every statement
 * in order — and returns what `$(psql -Atq -f …)` would have captured: the
 * single value of the file's last result. The session's search_path is reset
 * afterwards because two of the files pin it to pg_catalog, and the workflow
 * gets that for free by opening a fresh psql per capture.
 */
async function capture(file: string): Promise<unknown> {
  const sql = await readFile(resolve(guardRoot, file), "utf8");
  try {
    const results = await db.exec(sql);
    const last = results[results.length - 1];
    expect(last.rows, `${file} must print exactly one row`).toHaveLength(1);
    const values = Object.values(last.rows[0] as Record<string, unknown>);
    expect(values, `${file} must print exactly one column`).toHaveLength(1);
    return values[0];
  } catch (error) {
    throw new Error(
      `guard file ${file} does not execute: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await db.exec("reset search_path");
  }
}

beforeAll(async () => {
  workflow = await readFile(
    resolve(repositoryRoot, ".github/workflows/apply-hosted-migrations.yml"),
    "utf8",
  );
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema if not exists auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create or replace function auth.uid()
    returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create or replace function auth.jwt()
    returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  `);

  const chain = (await readdir(migrationsRoot)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  const expandAt = chain.indexOf(EXPAND);
  const contractAt = chain.indexOf(CONTRACT);
  expect(expandAt).toBeGreaterThan(-1);
  expect(contractAt).toBe(expandAt + 1);

  // The chain up to and including EXPAND: the state both EXPAND-phase
  // checks describe, before CONTRACT drops the legacy mutators they name.
  await replay(chain.slice(0, expandAt + 1));
  captured["expand:bot-account-binding-expand-verified.sql"] =
    await capture("bot-account-binding-expand-verified.sql");
  captured["expand:bot-mutator-contract-catalog-ready.sql"] =
    await capture("bot-mutator-contract-catalog-ready.sql");

  // CONTRACT alone, then the same preflight again.
  await replay(chain.slice(expandAt + 1, contractAt + 1));
  captured["contract:bot-mutator-contract-catalog-ready.sql"] =
    await capture("bot-mutator-contract-catalog-ready.sql");

  // Everything else: the state the broad scope's check describes.
  await replay(chain.slice(contractAt + 1));
  captured["latest:scope-all-protected-catalog-ready.sql"] =
    await capture("scope-all-protected-catalog-ready.sql");
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("the apply workflow's captured guard files", () => {
  it("are each captured by exactly the step that used to carry the SQL inline", () => {
    for (const [variable, file, step] of [
      [
        "VERIFIED",
        "bot-account-binding-expand-verified.sql",
        "Apply the exact bot account binding (scope=bot-account-binding)",
      ],
      [
        "CATALOG_READY",
        "bot-mutator-contract-catalog-ready.sql",
        "Apply the exact bot mutator CONTRACT (scope=bot-account-binding-contract)",
      ],
      [
        "PROTECTED_CATALOG_READY",
        "scope-all-protected-catalog-ready.sql",
        "Push the outstanding migrations (scope=all)",
      ],
    ]) {
      const call = `${variable}=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -Atq -f .github/hosted-apply/guard/${file})`;
      const at = workflow.indexOf(call);
      expect(at, `${file} is not captured by the workflow`).toBeGreaterThan(-1);
      expect(workflow.indexOf(call, at + 1), `${file} is captured more than once`).toBe(-1);
      const owner = workflow.lastIndexOf("\n      - name: ", at);
      expect(workflow.slice(owner, at)).toContain(`- name: ${step}\n`);
      // The step still branches on the captured value the way it always did.
      expect(workflow.slice(at)).toContain(`if [ "$${variable}" != "t" ]; then`);
    }
  });

  it("both EXPAND-state checks print t against the chain replayed to 20260822000200", () => {
    // The bot-account-binding scope's own postflight, and the retired
    // CONTRACT scope's preflight, describe this exact state.
    expect(captured["expand:bot-account-binding-expand-verified.sql"]).toBe(true);
    expect(captured["expand:bot-mutator-contract-catalog-ready.sql"]).toBe(true);
  });

  it("the CONTRACT preflight has teeth: once CONTRACT lands it prints f, not t", () => {
    // After CONTRACT closes the legacy ACLs the EXPAND catalog is gone, and a
    // preflight that kept printing t would let the scope apply CONTRACT twice.
    expect(captured["contract:bot-mutator-contract-catalog-ready.sql"]).toBe(false);
  });

  it("the broad scope's protected-catalog check prints t against the whole chain", () => {
    /*
     * The extraction that moved this file (ADR-235) found it printing f:
     * it pinned the four `_checked` mutators' sources as 20260822000200
     * wrote them, and 20260822000900 — which the same gate requires in the
     * ledger — rewrote all four, so scope=all had been refusing on hosted
     * with "catalog is not exact" since that repair landed. The four pins
     * now name the post-repair sources the record-only chain's verification
     * pins beside the old ones, and the gate says t for the catalog the
     * chain actually produces.
     */
    expect(captured["latest:scope-all-protected-catalog-ready.sql"]).toBe(true);
  });
});
