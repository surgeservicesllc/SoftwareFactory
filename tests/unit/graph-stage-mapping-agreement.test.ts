import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { NODE_CAPABILITIES } from "@/lib/graph/contracts";
import { stageForCapability } from "@/lib/graph/templates";

/**
 * The backfill derives a node's stage from its capability. So does the
 * application. They are the same rule written twice — once in TypeScript for
 * new graphs, once in SQL for the rows that predate it — and two copies of one
 * fact is how they drift.
 *
 * This reads the migration and holds it to the function, for every capability
 * the application defines. A capability added to `NODE_CAPABILITIES` without a
 * branch in the migration fails here rather than silently backfilling null.
 */
const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/migrations/20260823000700_backfill_graph_node_lifecycle_stage.sql",
  ),
  "utf8",
);

/*
 * The mapping now lives in two files, because the first is applied and
 * recorded on hosted and must never change under its ledger row. 000700
 * carries the original nine capabilities; 000900 carries the three the
 * DISCOVERY/EVALUATION/DECISION growth added. The invariant is over the
 * union: every capability the application defines has exactly one SQL branch
 * somewhere in the replayable chain.
 */
const extension = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/migrations/20260823000900_discovery_capability_stage_map.sql",
  ),
  "utf8",
);
const mappingSql = `${migration}\n${extension}`;

function stageInMigration(capability: string): string | null {
  const match = mappingSql.match(
    new RegExp(`when '${capability}' then '([A-Z_]+)'::public\\.sdlc_stage`),
  );
  return match?.[1] ?? null;
}

describe("the backfill agrees with the application", () => {
  it("maps every capability the same way the code does", () => {
    for (const capability of NODE_CAPABILITIES) {
      expect(stageInMigration(capability), `${capability} has no branch in the migration`)
        .toBe(stageForCapability(capability));
    }
  });

  it("touches only rows with no stage, so a replay changes nothing", () => {
    // Idempotence is the whole reason this is safe to re-run, and an
    // explicitly declared stage must never be overwritten by a derived one.
    expect(migration).toContain("where lifecycle_stage is null");
    expect(extension).toContain("where lifecycle_stage is null");
  });

  it("leaves a capability it does not recognise alone", () => {
    /*
     * `graph_nodes.capability` is free text, not an enum, so a row can hold a
     * value the application never defined. An em dash is honest about that; a
     * guessed stage is not.
     */
    const guards = [...mappingSql.matchAll(/and capability in \(([\s\S]*?)\)/g)]
      .map((match) => match[1])
      .join("\n");
    expect(guards, "the updates must be restricted to known capabilities").not.toBe("");
    for (const capability of NODE_CAPABILITIES) {
      expect(guards, capability).toContain(`'${capability}'`);
    }
  });
});

/**
 * The hosted-apply scope that writes these rows.
 *
 * It refuses to run unless the file's SHA-256 matches a pin in the workflow.
 * That pin is what stops a production write from applying something other than
 * the reviewed file — and it is also a value that goes stale silently the
 * moment the migration is edited, turning the scope into a step that always
 * refuses. Checked here so the staleness surfaces at commit time.
 */
describe("the graph-stage-backfill apply scope", () => {
  const workflow = readFileSync(
    resolve(import.meta.dirname, "../../.github/workflows/apply-hosted-migrations.yml"),
    "utf8",
  );

  it("pins the hash of the file it applies", () => {
    const digest = createHash("sha256").update(migration).digest("hex");
    expect(workflow, `the workflow pins a different digest than the file's ${digest}`)
      .toContain(digest);
  });

  it("is offered as a scope, and applies that one file only", () => {
    expect(workflow).toContain("- graph-stage-backfill");
    expect(workflow).toContain("20260823000700_backfill_graph_node_lifecycle_stage.sql");
  });

  it("refuses to write under a version the ledger already records", () => {
    // Applying under a recorded version is how this repository previously lost
    // a migration; the scope checks for 0 before it writes.
    expect(workflow).toContain("where version = '20260823000700';");
  });
});
