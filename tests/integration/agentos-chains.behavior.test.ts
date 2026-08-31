// @vitest-environment node


import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

/**
 * Template, gate and chain behaviour against the real migrated schema.
 *
 * `docs/AGENTOS_SPEC.md` §22 asks for two of these directly: an agent cannot
 * complete a gated step while a human can, with the follow-up staying blocked
 * until then; and instantiating the feature template produces nine ordered
 * cards with variables interpolated.
 *
 * The spec calls approval gates "not honor-system", so the refusal is asserted
 * against the database rather than against a route that might forget.
 */


const ownerId = "00000000-0000-4000-8000-00000000c001";
const memberId = "00000000-0000-4000-8000-00000000c002";
const outsiderId = "00000000-0000-4000-8000-00000000c003";
const organizationId = "10000000-0000-4000-8000-00000000c001";
const otherOrganizationId = "10000000-0000-4000-8000-00000000c002";
const projectId = "40000000-0000-4000-8000-00000000c001";

async function assumeRole(db: PGlite, role: "anon" | "authenticated" | "service_role", userId: string | null = null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(`set role ${role}`);
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

async function seedTemplate(db: PGlite) {
  const { rows } = await db.query<{ id: string }>(
    "select (public.agentos_seed_compound_engineer_template($1::uuid)).id as id",
    [organizationId],
  );
  return rows[0].id;
}

async function instantiate(db: PGlite, templateId: string, title = "Add search") {
  const { rows } = await db.query<{ id: string }>(
    `select (public.agentos_instantiate_template($1::uuid, $2::uuid, $3, $4::jsonb)).id as id`,
    [projectId, templateId, title, JSON.stringify({ branchName: "feat/search", featureTitle: "Search" })],
  );
  return rows[0].id;
}

async function steps(db: PGlite, chainId: string) {
  const { rows } = await db.query<{
    id: string; step_index: number; name: string; state: string;
    approval_gate: boolean; resolved_prompt: string; agent_name: string;
  }>(
    `select id, step_index, name, state, approval_gate, resolved_prompt, agent_name
       from public.agentos_task_chain_steps where chain_id = $1 order by step_index`,
    [chainId],
  );
  return rows;
}

describe("AgentOS templates, gates and chains", { timeout: 120_000 }, () => {
  let db: PGlite;

  beforeAll(async () => {
    // The chain, restored from a snapshot rather than replayed; the
    // helper keys its cache on the CONTENT of every migration, and
    // asserts coverage of the whole directory.
    db = await createMigratedDatabase();

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${memberId}'), ('${outsiderId}');
      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationId}', 'Chain Factory', 'chain-factory', '${ownerId}'),
        ('${otherOrganizationId}', 'Other', 'other-chain', '${outsiderId}');
      insert into public.organization_members (organization_id, user_id, role, created_by)
      values ('${organizationId}', '${memberId}', 'member', '${ownerId}');
      insert into public.projects (id, organization_id, name, status, default_branch, created_by)
      values ('${projectId}', '${organizationId}', 'Storefront', 'active', 'main', '${ownerId}');
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  it("seeds the nine specified steps, gated where the spec gates them", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const templateId = await seedTemplate(db);
    const chainId = await instantiate(db, templateId);
    const rows = await steps(db, chainId);
    await resetRole(db);

    expect(rows).toHaveLength(9);
    expect(rows.map((r) => r.agent_name)).toEqual([
      "spec", "plan", "review-coordinator", "plan", "implementation-plan-executioner",
      "review-coordinator", "senior-dev", "librarian", "human",
    ]);
    // Exactly the two the spec gates: spec approval and the human merge.
    expect(rows.filter((r) => r.approval_gate).map((r) => r.step_index)).toEqual([1, 9]);
    // The coordinator step names all four reviewers.
    for (const reviewer of ["feasibility", "scope-guardian", "coherence", "plan-risk"]) {
      expect(rows[2].resolved_prompt).toContain(reviewer);
    }
    // Reconstruction is labelled on the seeded prompts, as the spec requires.
    expect(rows[0].resolved_prompt).toContain("Reconstructed from the AgentOS talk");
  });

  it("interpolates declared variables and refuses a missing one", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const templateId = await seedTemplate(db);
    const chainId = await instantiate(db, templateId);
    const rows = await steps(db, chainId);

    expect(rows[4].resolved_prompt).toContain("feat/search");
    expect(rows[4].resolved_prompt).toContain("Search");
    // No literal placeholder survives into what an agent receives.
    expect(rows.some((r) => /\{\{\w+\}\}/.test(r.resolved_prompt))).toBe(false);

    // Discovering a missing variable at step 5, hours in, is worse than
    // refusing at instantiation.
    await expect(db.query(
      `select public.agentos_instantiate_template($1::uuid, $2::uuid, 'No vars', '{}'::jsonb)`,
      [projectId, templateId],
    )).rejects.toThrow(/missing values for template variables/);
    await resetRole(db);
  });

  it("refuses to hand an agent a prompt with a placeholder still in it", async () => {
    await resetRole(db);
    // Reached directly rather than through instantiation, which rejects a
    // missing variable earlier. This is the inner guard for any other caller:
    // interpolating nothing and carrying on would hand an agent literal braces.
    await expect(db.query(
      "select public.agentos_interpolate_prompt($1, $2::jsonb)",
      ["Work on {{branchName}} for {{featureTitle}}", JSON.stringify({ branchName: "feat/x" })],
    )).rejects.toThrow(/unfilled variable/);

    const { rows } = await db.query<{ out: string }>(
      "select public.agentos_interpolate_prompt($1, $2::jsonb) as out",
      ["Work on {{branchName}}", JSON.stringify({ branchName: "feat/x" })],
    );
    expect(rows[0].out).toBe("Work on feat/x");
  });

  it("starts only the first step and blocks the rest", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const chainId = await instantiate(db, await seedTemplate(db));
    const rows = await steps(db, chainId);
    await resetRole(db);

    expect(rows[0].state).toBe("ready");
    expect(rows.slice(1).every((r) => r.state === "blocked")).toBe(true);
  });

  it("refuses a non-manager on a gated step, and lets an owner through", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const chainId = await instantiate(db, await seedTemplate(db));
    let rows = await steps(db, chainId);
    const gatedStep = rows[0];
    await resetRole(db);

    // An agent works under an ordinary member session. `review` is its
    // ceiling; the gate is what it cannot pass.
    await assumeRole(db, "authenticated", memberId);
    await db.query("select public.agentos_submit_chain_step_for_review($1::uuid)", [gatedStep.id]);
    await expect(db.query(
      "select public.agentos_complete_chain_step($1::uuid)",
      [gatedStep.id],
    )).rejects.toThrow(/approval-gated/);
    await resetRole(db);

    // The follow-up must still be blocked while the gate is unsatisfied.
    rows = await steps(db, chainId);
    expect(rows[0].state).toBe("review");
    expect(rows[1].state).toBe("blocked");

    await assumeRole(db, "authenticated", ownerId);
    await db.query("select public.agentos_complete_chain_step($1::uuid)", [gatedStep.id]);
    await resetRole(db);

    rows = await steps(db, chainId);
    expect(rows[0].state).toBe("done");
    // And exactly one successor opens.
    expect(rows[1].state).toBe("ready");
    expect(rows[2].state).toBe("blocked");
  });

  it("records who signed off a gated step", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const chainId = await instantiate(db, await seedTemplate(db));
    const rows = await steps(db, chainId);
    await db.query("select public.agentos_complete_chain_step($1::uuid)", [rows[0].id]);

    const { rows: done } = await db.query<{ completed_by: string; completed_at: string }>(
      "select completed_by, completed_at from public.agentos_task_chain_steps where id = $1",
      [rows[0].id],
    );
    await resetRole(db);

    // A gate satisfied by an unattributed write is not a gate.
    expect(done[0].completed_by).toBe(ownerId);
    expect(done[0].completed_at).toBeTruthy();
  });

  it("refuses to advance a blocked step by any route", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const chainId = await instantiate(db, await seedTemplate(db));
    const rows = await steps(db, chainId);

    // Skipping ahead would make the ordering cosmetic.
    await expect(db.query(
      "select public.agentos_complete_chain_step($1::uuid)",
      [rows[3].id],
    )).rejects.toThrow(/blocked by an earlier step/);
    await expect(db.query(
      "select public.agentos_submit_chain_step_for_review($1::uuid)",
      [rows[3].id],
    )).rejects.toThrow(/cannot be submitted for review/);
    await resetRole(db);
  });

  it("refuses to complete the same step twice", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const chainId = await instantiate(db, await seedTemplate(db));
    const rows = await steps(db, chainId);
    await db.query("select public.agentos_complete_chain_step($1::uuid)", [rows[0].id]);
    await expect(db.query(
      "select public.agentos_complete_chain_step($1::uuid)",
      [rows[0].id],
    )).rejects.toThrow(/already done/);
    await resetRole(db);
  });

  it("seeds idempotently rather than creating a second copy", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const first = await seedTemplate(db);
    const second = await seedTemplate(db);
    expect(second).toBe(first);

    const { rows } = await db.query<{ count: string }>(
      "select count(*) as count from public.agentos_task_templates where organization_id = $1",
      [organizationId],
    );
    await resetRole(db);
    expect(Number(rows[0].count)).toBe(1);
  });

  it("refuses another organization's caller everywhere", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const templateId = await seedTemplate(db);
    const chainId = await instantiate(db, templateId);
    const rows = await steps(db, chainId);
    await resetRole(db);

    await assumeRole(db, "authenticated", outsiderId);
    await expect(db.query(
      "select public.agentos_instantiate_template($1::uuid, $2::uuid, 'Theirs', '{}'::jsonb)",
      [projectId, templateId],
    )).rejects.toThrow(/does not exist|membership is required/);
    await expect(db.query(
      "select public.agentos_complete_chain_step($1::uuid)",
      [rows[0].id],
    )).rejects.toThrow(/does not exist|membership is required/);
    expect((await db.query("select id from public.agentos_task_chain_steps")).rows).toEqual([]);
    await resetRole(db);
  });

  it("keeps the new tables read-only for browsers with no service_role grants", async () => {
    await resetRole(db);
    const { rows } = await db.query<{ relname: string; ins: boolean; upd: boolean; del: boolean; svc: boolean }>(`
      select c.relname,
             pg_catalog.has_table_privilege('authenticated', c.oid, 'INSERT') as ins,
             pg_catalog.has_table_privilege('authenticated', c.oid, 'UPDATE') as upd,
             pg_catalog.has_table_privilege('authenticated', c.oid, 'DELETE') as del,
             pg_catalog.has_table_privilege('service_role', c.oid, 'SELECT') as svc
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and c.relname in ('agentos_task_templates','agentos_task_template_steps',
                           'agentos_task_chains','agentos_task_chain_steps')
    `);

    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.ins || r.upd || r.del || r.svc)).toEqual([]);
  });
});
