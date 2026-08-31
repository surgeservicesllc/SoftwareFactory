// @vitest-environment node


import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

const userId = "10000000-0000-4000-8000-000000000001";
const organizationId = "20000000-0000-4000-8000-000000000002";
const projectId = "30000000-0000-4000-8000-000000000003";
const graphId = "40000000-0000-4000-8000-000000000004";
const commandId = "50000000-0000-4000-8000-000000000005";
const taskId = "60000000-0000-4000-8000-000000000006";

describe("Grok claim admission fence behavior", () => {
  let db: PGlite;

  beforeAll(async () => {
    // The chain, restored from a snapshot rather than replayed; the
    // helper keys its cache on the CONTENT of every migration, and
    // asserts coverage of the whole directory.
    db = await createMigratedDatabase();
    await db.exec(`
      insert into auth.users (id) values ('${userId}');
      insert into public.organizations (id,name,slug,created_by)
        values ('${organizationId}','Legacy claims','legacy-claims','${userId}');
      insert into public.projects (
        id,organization_id,name,status,github_repository,default_branch,created_by
      ) values (
        '${projectId}','${organizationId}','Legacy project','active',
        'factory/legacy','main','${userId}'
      );
      insert into public.graphs (
        id,organization_id,project_id,goal,topology,created_by
      ) values (
        '${graphId}','${organizationId}','${projectId}',
        'A non-Grok legacy graph','SINGLE_AGENT','${userId}'
      );

      -- The helper only reads bridge identity. Disable FK triggers so this
      -- focused fixture need not manufacture unrelated release artifacts.
      alter table public.graph_phase1c_bridges disable trigger all;
      insert into public.graph_phase1c_bridges (
        organization_id,project_id,graph_id,graph_run_id,
        implementation_node_id,architecture_gate_id,architecture_artifact_id,
        architecture_intent_sha256,command_id,task_id,state,created_by
      ) values (
        '${organizationId}','${projectId}','${graphId}',
        '70000000-0000-4000-8000-000000000007',
        '80000000-0000-4000-8000-000000000008',
        '90000000-0000-4000-8000-000000000009',
        'a0000000-0000-4000-8000-00000000000a',repeat('a',64),
        '${commandId}','${taskId}','COMMAND_RECORDED','${userId}'
      );
      alter table public.graph_phase1c_bridges enable trigger all;
    `);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("keeps an ordinary non-Grok graph claim parseable with an explicit false flag", async () => {
    const claim = {
      graph_id: graphId,
      nodes: [{ node_id: "b0000000-0000-4000-8000-00000000000b" }],
      legacy: true,
    };
    const projected = await db.query<{ claim: Record<string, unknown> }>(
      "select public.attach_current_grok_admissions_to_claim($1::jsonb) as claim",
      [JSON.stringify(claim)],
    );
    expect(projected.rows[0].claim).toEqual({ ...claim, grok_admission_required: false });
  });

  it("keeps a graph-linked Phase 1C claim unchanged when its graph is non-Grok", async () => {
    const claim = {
      organization_id: organizationId,
      command_id: commandId,
      task_id: taskId,
      provider: "openai",
      model: "gpt-5.3-codex",
      legacy: true,
    };
    const projected = await db.query<{ claim: Record<string, unknown> }>(
      "select public.attach_current_grok_admission_to_phase1c_claim($1::jsonb) as claim",
      [JSON.stringify(claim)],
    );
    expect(projected.rows[0].claim).toEqual(claim);
    expect(projected.rows[0].claim).not.toHaveProperty("execution_admission");
  });
});
