/**
 * Report which migrations have actually reached hosted, by asking the database
 * rather than the ledger.
 *
 * `AI/HOSTED_APPLY_RUNBOOK.md` has been wrong about this position twice, in both
 * directions: it undercounted the unapplied migrations, and it listed four as
 * unapplied that were already present. Both errors came from the same place —
 * the position was written down once and then trusted, and the ledger and the
 * schema had drifted apart in the meantime.
 *
 * So this asks the schema. For each table a recent migration creates, it issues
 * a `HEAD` against PostgREST: 200 means the table is there, 404 means it is not.
 * That is a direct observation of the thing in question, and it needs no
 * database password and no personal access token — only the service-role key
 * that GitHub Actions already holds for the Phase 1C worker.
 *
 * What it deliberately does **not** do:
 *
 * - It does not read `supabase_migrations.schema_migrations`. PostgREST cannot
 *   reach that schema, and the ledger is the artifact under suspicion anyway.
 *   A table's presence is the fact; the ledger row is a claim about the fact.
 * - It does not write. Every request is a `HEAD`.
 * - It never prints the key, the URL's credentials, or any row. Only table names
 *   and status codes, so the output is safe in a public Actions log.
 *
 * A table present here with no ledger row is the dangerous combination — that is
 * the state where `supabase db push` tries to re-create it and fails partway. The
 * report calls that out rather than leaving the reader to notice.
 */

type Expectation = {
  readonly migration: string;
  readonly tables: readonly string[];
};

/**
 * Tables created by migrations added after the last confirmed ledger position
 * (`20260814000200`). Grouped by migration so the report names what to apply
 * rather than only what is missing.
 */
const EXPECTATIONS: readonly Expectation[] = [
  { migration: "20260814000210_phase2c_resource_persistence", tables: ["resource_breakers", "resource_breaker_events", "resource_assignments"] },
  { migration: "20260814001200_phase2b_task_graph_and_handoffs", tables: ["agent_handoffs", "work_locks"] },
  { migration: "20260814002000_graph_engineering", tables: ["graphs", "graph_runs", "node_runs", "graph_work_locks", "graph_events"] },
  { migration: "20260814002200_graph_anchors", tables: ["graph_anchors", "node_run_claims", "claim_anchors", "claim_acceptable_anchors"] },
];

/** A table from a migration known to be applied, to prove the probe itself works. */
const CONTROL_TABLE = "projects";

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is not set. This audit needs the same two values the Phase 1C worker uses.`);
    process.exit(2);
  }
  return value;
}

async function tableExists(baseUrl: string, key: string, table: string): Promise<boolean | null> {
  const response = await fetch(`${baseUrl}/rest/v1/${encodeURIComponent(table)}?limit=1`, {
    method: "HEAD",
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  }).catch(() => null);

  if (!response) return null;
  if (response.status === 404) return false;
  // 200 and 206 both mean the relation resolved. Anything else (401, 403, 5xx)
  // is a question this probe cannot answer, and guessing would defeat the point.
  if (response.status === 200 || response.status === 206) return true;
  return null;
}

async function main(): Promise<void> {
  const baseUrl = requireEnvironment("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
  const key = requireEnvironment("SUPABASE_SERVICE_ROLE_KEY");

  const control = await tableExists(baseUrl, key, CONTROL_TABLE);
  if (control !== true) {
    // Without this, "everything is missing" and "the probe is broken" look the
    // same, and the first reading would send someone to re-apply a live schema.
    console.error(
      `The control table \`${CONTROL_TABLE}\` did not resolve, so this audit cannot distinguish `
      + "an unapplied migration from a failing probe. Check the URL and key before reading anything below.",
    );
    process.exit(2);
  }
  console.log(`Control: \`${CONTROL_TABLE}\` resolved, so the probe reaches the database.\n`);

  let applied = 0;
  let missing = 0;
  let unknown = 0;

  for (const expectation of EXPECTATIONS) {
    const results = await Promise.all(
      expectation.tables.map(async (table) => ({ table, exists: await tableExists(baseUrl, key, table) })),
    );

    const present = results.filter((r) => r.exists === true).map((r) => r.table);
    const absent = results.filter((r) => r.exists === false).map((r) => r.table);
    const indeterminate = results.filter((r) => r.exists === null).map((r) => r.table);

    let verdict: string;
    if (indeterminate.length > 0) {
      verdict = "UNKNOWN";
      unknown += 1;
    } else if (absent.length === 0) {
      verdict = "APPLIED";
      applied += 1;
    } else if (present.length === 0) {
      verdict = "NOT APPLIED";
      missing += 1;
    } else {
      // The worst outcome and the reason this reports per table rather than per
      // migration: a half-applied migration cannot simply be re-run.
      verdict = "PARTIALLY APPLIED";
      missing += 1;
    }

    console.log(`${verdict.padEnd(18)} ${expectation.migration}`);
    if (absent.length > 0) console.log(`                   absent: ${absent.join(", ")}`);
    if (indeterminate.length > 0) console.log(`                   could not determine: ${indeterminate.join(", ")}`);
  }

  console.log(`\n${applied} applied, ${missing} outstanding, ${unknown} indeterminate.`);

  if (missing > 0) {
    console.log(
      "\nA migration reported NOT APPLIED whose ledger row already exists will be skipped by "
      + "`supabase db push` rather than applied. Run step 0 of scripts/hosted-ledger-repair.sql "
      + "to compare this result against the ledger before pushing.",
    );
  }

  // Outstanding migrations are a true finding, not a failure of the audit, so
  // this exits 0. A broken probe exits 2 above, which is the case worth failing.
  process.exit(0);
}

void main();
