// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { findBotProvider } from "@/lib/bots/catalog";
import { DEFAULT_CODEX_MODEL, EXECUTION_PROVIDER } from "@/lib/orchestration/plan";

/**
 * The executable model is now written in three places that must agree: the
 * plan's constant, the catalog's suggestion list, and the repair migration
 * that moves already-written rows onto it. The first two are tied by
 * `tests/unit/execution-model-agreement.test.ts`; SQL cannot import a
 * TypeScript constant, so this ties the third by reading the file.
 *
 * Without it, rolling the executor to a new model would fix the plan and the
 * catalog and leave a migration quietly repairing rows onto the old one.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const repairMigration = "20260822000500_route_bots_onto_the_executable_model.sql";

describe("the repair migration and the executable model agree", () => {
  it("repairs rows onto exactly the model the plan fixes", async () => {
    const sql = await readFile(
      resolve(repositoryRoot, "supabase/migrations", repairMigration),
      "utf8",
    );
    const declared = /v_executable_model constant text := '([^']+)'/.exec(sql)?.[1];
    expect(declared).toBe(DEFAULT_CODEX_MODEL);
  });

  it("names the executing provider the catalog and the plan both name", async () => {
    const sql = await readFile(
      resolve(repositoryRoot, "supabase/migrations", repairMigration),
      "utf8",
    );
    expect(sql).toContain(`'${EXECUTION_PROVIDER}'::public.bot_provider`);
    expect(findBotProvider(EXECUTION_PROVIDER)).not.toBeNull();
  });

  it("does not repair a model the catalog still offers as executable", async () => {
    const sql = await readFile(
      resolve(repositoryRoot, "supabase/migrations", repairMigration),
      "utf8",
    );
    const listed = /v_catalog_models constant text\[\] :=\s*array\[([^\]]+)\]/.exec(sql)?.[1] ?? "";
    const stale = [...listed.matchAll(/'([^']+)'/g)].map((match) => match[1]);

    expect(stale.length).toBeGreaterThan(0);
    // Repairing the executable model to itself would be a no-op today and a
    // silent downgrade the moment the executor rolls forward.
    expect(stale).not.toContain(DEFAULT_CODEX_MODEL);
    // And everything it does repair must be something this console offered,
    // so no hand-typed model is rewritten underneath a person.
    const offered = findBotProvider(EXECUTION_PROVIDER)?.suggestedModels ?? [];
    for (const model of stale) expect(offered).toContain(model);
  });

  it("is the newest migration, so the repair runs after the schema it repairs", async () => {
    const files = (await readdir(resolve(repositoryRoot, "supabase/migrations")))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    expect(files).toContain(repairMigration);
  });
});
