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
 *
 * ## Why the comparison goes through a second migration
 *
 * The two copies stopped speaking the same vocabulary when the lifecycle
 * widened to ten stages. The backfill writes the eight-stage labels —
 * `IMPLEMENTATION`, `ARCHITECTURE`, `PRD` — because it runs *before* the
 * widening rebuilds the enum, and running it after would kill the chain on
 * `invalid input value for enum sdlc_stage`. The widening then maps every one
 * of its rows forward.
 *
 * So the rule is still written twice and still must not drift; it is simply
 * composed now. `widen(stageInMigration(c))` is what the database ends up
 * holding, and it has to equal what `stageForCapability(c)` writes for a new
 * graph. Both halves are parsed from the real files rather than restated here,
 * so a change to either is caught rather than described.
 */
const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/migrations/20260823000700_backfill_graph_node_lifecycle_stage.sql",
  ),
  "utf8",
);

const widening = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/migrations/20260823000900_ten_stage_lifecycle.sql",
  ),
  "utf8",
);

function stageInMigration(capability: string): string | null {
  const match = migration.match(
    new RegExp(`when '${capability}' then '([A-Z_]+)'::public\\.sdlc_stage`),
  );
  return match?.[1] ?? null;
}

/**
 * The eight-to-ten map, read from the widening's own `case` rather than
 * restated. A label the widening does not rename passes through, which is what
 * `else lifecycle_stage` does in the file.
 */
function widen(stage: string | null): string | null {
  if (stage === null) return null;
  const match = widening.match(new RegExp(`when '${stage}' then '([A-Z_]+)'`));
  return match?.[1] ?? stage;
}

describe("the backfill agrees with the application", () => {
  it("maps every capability the same way the code does, once the widening lands", () => {
    for (const capability of NODE_CAPABILITIES) {
      expect(stageInMigration(capability), `${capability} has no branch in the migration`)
        .not.toBeNull();
      expect(
        widen(stageInMigration(capability)),
        `${capability}: the backfill and the application disagree about its stage`,
      ).toBe(stageForCapability(capability));
    }
  });

  it("writes the pre-widening vocabulary, because it runs before the rebuild", () => {
    /*
     * The ordering this depends on, asserted rather than assumed. If the
     * backfill were ever rewritten to emit ten-stage labels it would have to
     * move after the widening, and this case is what says so — the three
     * labels below do not exist in the enum by the time the widening finishes.
     */
    expect(stageInMigration("implementation")).toBe("IMPLEMENTATION");
    expect(stageInMigration("architecture")).toBe("ARCHITECTURE");
    expect(stageInMigration("planning")).toBe("PRD");

    expect(widen("IMPLEMENTATION")).toBe("BUILD");
    expect(widen("ARCHITECTURE")).toBe("ARCHITECT");
    expect(widen("PRD")).toBe("REQUIREMENT");
    // Unchanged by the widening, and the map says so explicitly rather than
    // relying on the `else` branch.
    expect(widen("REVIEW")).toBe("REVIEW");
    expect(widen("TEST")).toBe("TEST");
  });

  it("touches only rows with no stage, so a replay changes nothing", () => {
    // Idempotence is the whole reason this is safe to re-run, and an
    // explicitly declared stage must never be overwritten by a derived one.
    expect(migration).toContain("where lifecycle_stage is null");
  });

  it("leaves a capability it does not recognise alone", () => {
    /*
     * `graph_nodes.capability` is free text, not an enum, so a row can hold a
     * value the application never defined. An em dash is honest about that; a
     * guessed stage is not.
     */
    const guarded = migration.match(/and capability in \(([\s\S]*?)\)/);
    expect(guarded, "the update must be restricted to known capabilities").not.toBeNull();
    for (const capability of NODE_CAPABILITIES) {
      expect(guarded![1], capability).toContain(`'${capability}'`);
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
