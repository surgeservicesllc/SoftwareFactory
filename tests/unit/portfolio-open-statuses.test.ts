// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildPortfolio } from "@/lib/portfolio/aggregate";
import type { ProjectRow } from "@/lib/portfolio/aggregate";

/**
 * The portfolio console counts open work by matching status strings. Nothing
 * type-checks those strings against the enums they are matched against, and the
 * consequence is not a crash — it is a confident zero.
 *
 * That is exactly what had happened: commands were counted in `planning` and
 * `blocked`, tasks in `ready`, incidents in `acknowledged` and `mitigating`.
 * None of those five values exists in any of those enums. Every project
 * therefore reported zero open incidents no matter how many were open, and the
 * number looked measured rather than missing.
 *
 * This test reads the enums out of the migration and holds the sets to them.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const schema = resolve(
  repositoryRoot,
  "supabase/migrations/20260812000100_control_plane_schema.sql",
);

async function enumValues(typeName: string): Promise<readonly string[]> {
  const source = await readFile(schema, "utf8");
  const match = new RegExp(
    `create type public\\.${typeName} as enum \\(([^)]*)\\)`,
    "s",
  ).exec(source);
  if (!match) throw new Error(`public.${typeName} is not declared in ${schema}`);
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map(([, value]) => value);
}

/** The sets under test, read back from the module's own source. */
async function openStatusSets(): Promise<Record<string, readonly string[]>> {
  const source = await readFile(
    resolve(repositoryRoot, "lib/portfolio/aggregate.ts"),
    "utf8",
  );
  const sets: Record<string, readonly string[]> = {};
  for (const [, name, body] of source.matchAll(
    /const OPEN_(\w+)_STATUSES = new Set\(\[([^\]]*)\]/g,
  )) {
    sets[name.toLowerCase()] = [...body.matchAll(/"([a-z_]+)"/g)].map(([, value]) => value);
  }
  return sets;
}

describe("portfolio open-work statuses", () => {
  it("names only statuses the enums can actually hold", async () => {
    const sets = await openStatusSets();
    const enums: Record<string, readonly string[]> = {
      command: await enumValues("command_status"),
      incident: await enumValues("incident_status"),
      run: await enumValues("run_status"),
      task: await enumValues("task_status"),
    };

    expect(Object.keys(sets).sort()).toEqual(["command", "incident", "run", "task"]);

    for (const [kind, statuses] of Object.entries(sets)) {
      expect(statuses.length, `${kind} set is empty`).toBeGreaterThan(0);
      for (const status of statuses) {
        expect(enums[kind], `${kind} status "${status}"`).toContain(status);
      }
    }
  });

  it("counts the states work is most often waiting in", async () => {
    const sets = await openStatusSets();

    // Omission is as wrong as invention and harder to notice: a queued task is
    // the most unambiguously open thing in the system, and it was not counted.
    expect(sets.task).toContain("queued");
    expect(sets.task).toContain("in_progress");
    expect(sets.command).toContain("queued");
    expect(sets.command).toContain("awaiting_approval");

    // And nothing terminal is counted as open.
    for (const terminal of ["succeeded", "failed", "cancelled", "completed", "resolved", "closed"]) {
      for (const [kind, statuses] of Object.entries(sets)) {
        expect(statuses, `${kind} counts ${terminal} as open`).not.toContain(terminal);
      }
    }
  });

  it("reports an unresolved incident as needing a person", () => {
    const project: ProjectRow = {
      autonomousMode: false,
      githubRepository: null,
      healthStatus: "healthy",
      id: "project-1",
      maximumAutonomousRisk: "GREEN",
      name: "Alpha",
      status: "active",
    };

    const view = buildPortfolio({
      commands: [],
      connections: [{ projectId: "project-1", provider: "github", status: "connected" }],
      incidents: [{ projectId: "project-1", status: "investigating" }],
      projects: [project],
      runs: [],
      tasks: [{ projectId: "project-1", status: "queued" }],
    });

    // Under the old sets both of these were zero, and the project looked calm.
    expect(view.projects[0].openIncidents).toBe(1);
    expect(view.projects[0].openTasks).toBe(1);
    expect(view.projects[0].ownerAttention).toBe(true);
    expect(view.totals.needingAttention).toBe(1);
  });
});
