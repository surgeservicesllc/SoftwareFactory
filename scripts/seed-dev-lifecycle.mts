import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import { parseRequiredCheckNames } from "@/lib/graph/release-policy";
import { budgetForTemplate, findTemplate } from "@/lib/graph/templates";
import { driveSeedLifecycle, type SeedGate } from "@/scripts/seed-drive.mjs";
import { SupabaseGraphStore } from "@/lib/worker/graph-store";

/**
 * Development seed for the ten-step AI Factory flow.
 *
 * Plants a clearly-labelled development world — a seed owner, a seed
 * organization, and one `full_lifecycle` graph — through the same RPCs
 * production uses (`onboard_authenticated_organization`,
 * `create_graph_from_plan`, the `*_as_worker` boundary), then drives the
 * run's first window so the factory pages at /solutions/factory/* show live
 * stages, recorded artifacts, and the open ARCHITECTURE human gate waiting
 * for a decision. With `--drain`, it approves the human gates as the seed
 * owner, lets the anchored evidence decide the automatic gate, and walks the
 * run to COMPLETED — all ten steps closed.
 *
 * Boundaries this script keeps, deliberately:
 *
 *   - It REFUSES the production project. There is no override flag. Seed data
 *     never belongs in the system of record.
 *   - It does NOT create the project. Only `postgres` may insert one, because
 *     a project is born from the audited `connect_github_project` path; the
 *     seed uses a project that already exists and says so when there is none.
 *   - Every generated payload carries `dev_seed: true`. Nothing it writes
 *     could be mistaken for real work.
 *   - It is idempotent: a second run finds the world it planted and reports
 *     it instead of duplicating it.
 *   - It touches only its own graph. If the target database holds any other
 *     claimable graph, it stops before claiming rather than grabbing work
 *     that is not its own.
 *
 * Usage (against a local `supabase start` stack or a dev project), after
 * connecting a repository as the seed owner through the product:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   SEED_OWNER_PASSWORD=... \
 *   GITHUB_REPOSITORY=owner/repository \
 *   SOFTWAREFACTORY_REQUIRED_CHECKS='CI|Browser 1/2|Browser 2/2' \
 *   [SEED_PROJECT_ID=...] \
 *   npx tsx scripts/seed-dev-lifecycle.mts [--drain]
 */

const PRODUCTION_PROJECT_REF = "qpuofpmagrmyamahqwxw";
const SEED_OWNER_EMAIL = "seed-owner@dev-seed.local";
const SEED_ORGANIZATION_NAME = "Dev Seed Factory";
const SEED_ORGANIZATION_SLUG = "dev-seed-factory";
const SEED_GOAL_PREFIX = "Dev seed:";
const WORKER_ID = "dev-seed-lifecycle";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing required environment variable ${name}.`);
    process.exit(1);
  }
  return value;
}

async function ensureSeedOwner(admin: SupabaseClient, password: string): Promise<string> {
  // The admin listing is paged; the seed owner, if present, is findable by
  // its fixed email within the first pages of a development stack.
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Listing users failed: ${error.message}`);
    const existing = data.users.find((user) => user.email === SEED_OWNER_EMAIL);
    if (existing) return existing.id;
    if (data.users.length < 200) break;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email: SEED_OWNER_EMAIL,
    password,
    email_confirm: true,
    user_metadata: { dev_seed: true, display_name: "Dev Seed Owner" },
  });
  if (error || !data.user) throw new Error(`Creating the seed owner failed: ${error?.message ?? "no user returned"}`);
  console.log(`Created seed owner ${SEED_OWNER_EMAIL}.`);
  return data.user.id;
}

async function main() {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const password = requiredEnv("SEED_OWNER_PASSWORD");
  const drain = process.argv.includes("--drain");

  if (url.includes(PRODUCTION_PROJECT_REF)) {
    console.error(
      "This is the production project. The development seed refuses to run against it, "
      + "and there is no override. Point NEXT_PUBLIC_SUPABASE_URL at a local or dev stack.",
    );
    process.exit(1);
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. The seed owner — a real authenticated user, so every write below runs
  //    under the exact RLS the product runs under.
  await ensureSeedOwner(admin, password);

  const owner = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await owner.auth.signInWithPassword({ email: SEED_OWNER_EMAIL, password });
  if (signIn.error) {
    console.error(
      `Signing in as ${SEED_OWNER_EMAIL} failed: ${signIn.error.message}. `
      + "If the user predates this run, SEED_OWNER_PASSWORD must match the password it was created with.",
    );
    process.exit(1);
  }

  // 2. The seed organization, through the product's own onboarding RPC —
  //    idempotent by slug, and it makes the caller the owner.
  const onboarded = await owner
    .rpc("onboard_authenticated_organization", {
      p_name: SEED_ORGANIZATION_NAME,
      p_slug: SEED_ORGANIZATION_SLUG,
    })
    .single();
  if (onboarded.error) throw new Error(`Onboarding the seed organization failed: ${onboarded.error.message}`);
  const organization = onboarded.data as { organization_id: string; was_created: boolean };
  console.log(
    `${organization.was_created ? "Created" : "Found"} organization "${SEED_ORGANIZATION_NAME}" `
    + `(${organization.organization_id}).`,
  );

  /*
   * 3. The project the lifecycle runs against — found, never invented.
   *
   * A project is deliberately not insertable by anyone but `postgres`:
   * migration 20260812001700 revoked write on `public.projects` from
   * `authenticated`, and `service_role` never held it, because a project is
   * born from the audited `connect_github_project` path and nothing else.
   * An earlier draft of this script inserted the row directly with the
   * service-role client and would have died at runtime with "permission
   * denied for table projects" — the boundary working exactly as designed.
   *
   * So the seed uses a project that already exists: named by
   * SEED_PROJECT_ID, or the organization's own active project when it holds
   * exactly one. If there is none, the seed says what to do rather than
   * routing around the boundary.
   */
  const namedProjectId = process.env.SEED_PROJECT_ID?.trim();
  const candidates = await owner
    .from("projects")
    .select("id, name, status")
    .eq("organization_id", organization.organization_id)
    .eq("status", "active");
  if (candidates.error) throw new Error(`Reading the organization's projects failed: ${candidates.error.message}`);
  const active = (candidates.data ?? []) as Array<{ id: string; name: string }>;

  let projectId: string;
  if (namedProjectId) {
    const named = active.find((project) => project.id === namedProjectId);
    if (!named) {
      console.error(
        `SEED_PROJECT_ID ${namedProjectId} is not an active project of "${SEED_ORGANIZATION_NAME}". `
        + `Active projects: ${active.map((p) => `${p.name} (${p.id})`).join(", ") || "none"}.`,
      );
      process.exit(1);
    }
    projectId = named.id;
    console.log(`Using project "${named.name}" (${projectId}).`);
  } else if (active.length === 1) {
    projectId = active[0].id;
    console.log(`Using the organization's only active project "${active[0].name}" (${projectId}).`);
  } else {
    console.error(
      active.length === 0
        ? `Organization "${SEED_ORGANIZATION_NAME}" has no active project, and this seed will not create one: `
          + "a project is born from the audited GitHub connection path, which the schema reserves. "
          + "Connect a repository as the seed owner through the product first, then re-run."
        : `Organization "${SEED_ORGANIZATION_NAME}" has ${active.length} active projects. `
          + `Name one with SEED_PROJECT_ID: ${active.map((p) => `${p.name} (${p.id})`).join(", ")}.`,
    );
    process.exit(1);
  }

  // 4. One lifecycle graph, planned through the same template + RPC the
  //    factory pages' launch control uses. Idempotent: an existing seed
  //    lifecycle in this organization is reported, not duplicated.
  const existingGraph = await owner
    .from("graphs")
    .select("id, goal, graph_runs(state)")
    .eq("organization_id", organization.organization_id)
    .eq("is_lifecycle", true)
    .like("goal", `${SEED_GOAL_PREFIX}%`)
    .limit(1)
    .maybeSingle();
  if (existingGraph.error) throw new Error(`Reading the seed lifecycle failed: ${existingGraph.error.message}`);

  let graphId = existingGraph.data?.id as string | undefined;
  if (!graphId) {
    const template = findTemplate("full_lifecycle");
    if (!template) throw new Error("The full_lifecycle template is missing.");
    const built = buildLaunchPlan(template, budgetForTemplate(template, DEFAULT_GRAPH_BUDGET));
    if (!built.ok) throw new Error(`full_lifecycle did not compile: ${built.errors.join("; ")}`);

    const planted = await owner
      .rpc("create_graph_from_plan", {
        p_organization_id: organization.organization_id,
        p_project_id: projectId,
        p_goal: `${SEED_GOAL_PREFIX} ${built.plan.goal}`,
        p_topology: built.plan.topology,
        p_topology_reasons: built.plan.topologyReasons,
        p_risk_level: built.plan.riskLevel,
        p_requires_owner_approval: built.plan.requiresOwnerApproval,
        p_nodes: built.plan.nodes,
        p_edges: built.plan.edges,
        p_budget: built.plan.budget,
      })
      .single();
    if (planted.error) throw new Error(`Planting the seed lifecycle failed: ${planted.error.message}`);
    graphId = planted.data as unknown as string;
    console.log(`Planted the seed lifecycle graph (${graphId}).`);
  } else {
    console.log(`Found the seed lifecycle graph (${graphId}).`);
  }

  // 5. Only our graph may be claimed. Any other claimable graph means this is
  //    not the empty development stack the seed expects — stop, touch
  //    nothing.
  const otherGraphs = await owner
    .from("graphs")
    .select("id, organization_id")
    .neq("id", graphId);
  if (otherGraphs.error) throw new Error(`Inspecting the queue failed: ${otherGraphs.error.message}`);
  if ((otherGraphs.data ?? []).length > 0) {
    console.error(
      `The database holds ${otherGraphs.data!.length} other graph(s). The seed drives only its own `
      + "lifecycle and will not claim from a shared queue. Run it against a stack that holds no other graphs, "
      + "or drain those graphs first.",
    );
    process.exit(1);
  }

  // 6. Drive the run the way the production worker does: claim, execute,
  //    halt at gates. The loop itself lives in `seed-drive.mts` so a test can
  //    walk the same code against a real database instead of trusting it.
  const requiredCheckNames = parseRequiredCheckNames(requiredEnv("SOFTWAREFACTORY_REQUIRED_CHECKS"));
  if (!requiredCheckNames) throw new Error("The seed required-check policy is invalid.");
  const store = SupabaseGraphStore.create({
    url,
    serviceRoleKey,
    workerId: WORKER_ID,
    repositoryFullName: requiredEnv("GITHUB_REPOSITORY"),
    requiredCheckNames,
  });
  const outcome = await driveSeedLifecycle({
    store,
    graphId,
    drain,
    log: (line) => console.log(line),
    listOpenGates: async (id) => {
      const openGates = await owner
        .from("graph_gates")
        .select("id, kind, state, node_id, stage")
        .eq("graph_id", id)
        .eq("state", "OPEN");
      if (openGates.error) throw new Error(`Reading the gates failed: ${openGates.error.message}`);
      return (openGates.data ?? []) as SeedGate[];
    },
    approveHumanGate: async (gate) => {
      const decided = await owner.rpc("decide_node_gate", {
        p_gate_id: gate.id,
        p_approved: true,
        p_reason: "Approved by the dev seed owner.",
      });
      if (decided.error) throw new Error(`Approving the ${gate.stage} gate failed: ${decided.error.message}`);
    },
    decideAutomaticGate: async (gate) => {
      const decided = await admin.rpc("decide_automatic_gate_as_worker", {
        p_worker_id: WORKER_ID,
        p_node_id: gate.node_id,
      });
      if (decided.error) throw new Error(`Deciding the ${gate.stage} automatic gate failed: ${decided.error.message}`);
    },
  });

  if (outcome.haltedForDecision) return;

  console.log(
    "Seed complete. Sign in as the seed owner and open /solutions/factory/requirement to walk the ten steps.",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
