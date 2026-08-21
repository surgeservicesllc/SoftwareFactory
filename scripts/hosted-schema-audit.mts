import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { migrationTables, type MigrationTables } from "@/lib/supabase/migration-tables";

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
 * So this asks the schema. For each table a recent migration creates, it asks
 * PostgREST for the relation and zero rows, and reads the answer. It needs no
 * database password and no personal access token — only the service-role key
 * GitHub Actions already holds for the Phase 1C worker.
 *
 * **Read the limit below before acting on the output.** This probe can prove a
 * table is *there*; it cannot prove one is *absent*. For that,
 * `scripts/hosted-state-report.sql` reads `pg_class` in the SQL editor and is
 * the authority. This script is the cheap, repeatable check between those.
 *
 * **A 403 is a positive result here, and that is the whole trick.**
 *
 * `service_role` holds table grants on exactly four GitHub-ingress tables in
 * this schema and nothing else — a deliberate control, asserted by
 * `hosted-service-role-table-grants.test.ts`. So this key cannot SELECT from
 * almost any table the audit needs to ask about, and the first working version
 * of this script failed on its own control table for exactly that reason.
 *
 * The obvious repair — grant `service_role` SELECT so the probe can read — would
 * weaken a security boundary to make a check pass. That is the wrong trade at
 * any price, and it is also unnecessary, because PostgREST already separates the
 * two cases: a table that does not exist never reaches a privilege check and
 * answers 404 from the schema cache, while a table that exists and is unreadable
 * answers 403 and names the relation. **Refusing to read it is proof it is
 * there.** The lockdown supplies the signal rather than obstructing it.
 *
 * What it deliberately does **not** do:
 *
 * - It does not read `supabase_migrations.schema_migrations`. PostgREST cannot
 *   reach that schema, and the ledger is the artifact under suspicion anyway.
 *   A table's presence is the fact; the ledger row is a claim about the fact.
 * - It does not write, and it does not request a single row.
 * - It never prints the key, the URL's credentials, or any data. Only table
 *   names and verdicts, so the output is safe in a public Actions log.
 *
 * A table present here with no ledger row is the dangerous combination — that is
 * the state where `supabase db push` tries to re-create it and fails partway. The
 * report calls that out rather than leaving the reader to notice.
 */

/**
 * Every migration in the repository, paired with the tables it creates.
 *
 * This list used to be four migrations written out by hand. The repository
 * passed a hundred migrations while that list stood still, so the audit's
 * closing "0 outstanding" was a statement about four files and read as a
 * statement about the schema. It is derived now, and migrations that create no
 * table are reported as unprobeable rather than quietly dropped -- a migration
 * this script cannot ask about must not look like one that passed.
 */
function readExpectations(): readonly MigrationTables[] {
  const directory = resolve(import.meta.dirname, "../supabase/migrations");
  const files = readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(directory, name), "utf8") }));
  return migrationTables(files);
}

/** A table from a migration known to be applied, to prove the probe itself works. */
const CONTROL_TABLE = "projects";

/**
 * A function this key is known to be able to call, to prove the *function*
 * probe works. Without it, an empty or privilege-filtered description would
 * read as "every function is missing".
 *
 * `claim_planned_graph` is the strongest control available: the graph worker
 * called it successfully against this database on 2026-08-19 22:54Z, and it is
 * granted to `service_role` — the very role whose privileges filter the
 * description being read.
 */
const CONTROL_FUNCTION = "claim_planned_graph";

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is not set. This audit needs the same two values the Phase 1C worker uses.`);
    process.exit(2);
  }
  return value;
}

type Probe = { readonly exists: boolean | null; readonly status: number | null; readonly detail: string };

/**
 * `select=*&limit=0` asks for the relation and no rows. A present table answers
 * `200 []`; an absent one answers `404`. Reading zero rows keeps this a question
 * about the schema rather than about the data, which is what makes the output
 * safe to print in a public log.
 *
 * GET rather than HEAD: PostgREST answers HEAD, but the status alone cannot be
 * told apart from a proxy that rejected the method, and this probe's whole value
 * is that its failures are legible.
 */
async function probeTable(baseUrl: string, key: string, table: string): Promise<Probe> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/rest/v1/${encodeURIComponent(table)}?select=*&limit=0`, {
      method: "GET",
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
  } catch (error) {
    return { exists: null, status: null, detail: error instanceof Error ? error.message : "request failed" };
  }

  if (response.ok) return { exists: true, status: response.status, detail: "present and readable" };

  let body: { message?: string; hint?: string; code?: string } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // A body that will not parse is not extra information; the status stands.
  }
  const message = body.message ?? `HTTP ${response.status}`;

  // `permission denied for table X` is a *positive* existence result, and this
  // is the case that matters most here.
  //
  // `service_role` holds table grants on exactly four GitHub-ingress tables in
  // this schema and nothing else -- a deliberate control, asserted by
  // tests/integration/hosted-service-role-table-grants.test.ts and hardened
  // again by #49. So the key this audit runs on cannot SELECT from almost any
  // table it needs to ask about.
  //
  // The obvious fix -- grant service_role SELECT so the probe can read -- would
  // weaken a security boundary to make a check pass, which is the wrong trade at
  // any price. It is also unnecessary: PostgREST distinguishes the two cases by
  // itself. A table that does not exist never reaches a privilege check and
  // answers 404 from the schema cache; a table that exists and is unreadable
  // answers 403 and names the relation. Refusing to read it is proof it is
  // there.
  if (response.status === 403 && /permission denied for (table|relation|view)/i.test(message)) {
    return { exists: true, status: 403, detail: "present (not readable by this role, as designed)" };
  }

  // 404 / PGRST205 means "not in PostgREST's schema cache", and that is NOT the
  // same as "does not exist" -- a distinction this script originally got wrong,
  // in the dangerous direction.
  //
  // A table is missing from the cache when it does not exist, OR when it exists
  // with no privileges granted on it. A migration that created a table and then
  // failed before its grant statements ran leaves exactly the second shape.
  // `20260814000210_phase2c_resource_persistence` was in that state: this audit
  // reported `resource_breakers` absent, and re-running the file failed with
  // `42P07: relation "resource_breakers" already exists`.
  //
  // So this is reported as NOT VISIBLE rather than absent, and the summary sends
  // the reader to scripts/hosted-state-report.sql, which reads pg_class and has
  // no such blind spot. Naming the limit is the only honest option here: REST
  // genuinely cannot separate these two cases, and a confident wrong answer
  // about production schema is worse than an admitted gap.
  if (response.status === 404 || body.code === "PGRST205") {
    return { exists: false, status: response.status, detail: "not visible to PostgREST" };
  }

  let detail = `HTTP ${response.status}: ${message}`;
  if (body.hint) detail += ` (${body.hint})`;
  return { exists: null, status: response.status, detail };
}

async function tableExists(baseUrl: string, key: string, table: string): Promise<boolean | null> {
  return (await probeTable(baseUrl, key, table)).exists;
}

/**
 * Which functions PostgREST will admit to, read from its own description.
 *
 * The point of asking this way is that it executes nothing. `POST /rpc/<name>`
 * would answer the question too, and would also *run* the function -- against
 * production, with service-role privileges, for functions whose whole purpose
 * is to mutate. The OpenAPI document names every callable routine and runs
 * none of them.
 *
 * **Its limit, which matters as much as its answer.** The description is
 * filtered by privilege: a function that exists with no EXECUTE grant for this
 * role does not appear. So a name found here is proof of presence, and a name
 * missing here is `not visible` -- exactly the same asymmetry the table probe
 * has, and it is reported with the same word.
 *
 * Only functions granted to `service_role` are asked about at all. Most of
 * this schema's functions are granted to `authenticated` alone, on purpose,
 * because they re-derive the caller from `auth.uid()`; asking a service-role
 * view about those reported three healthy migrations as outstanding.
 */
async function readCallableFunctions(baseUrl: string, key: string): Promise<ReadonlySet<string> | null> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/rest/v1/`, {
      method: "GET",
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json" },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let document: { paths?: Record<string, unknown> };
  try {
    document = (await response.json()) as typeof document;
  } catch {
    return null;
  }
  const paths = document.paths;
  if (!paths) return null;

  const callable = new Set<string>();
  for (const path of Object.keys(paths)) {
    const match = /^\/rpc\/(.+)$/.exec(path);
    if (match) callable.add(match[1]);
  }
  return callable;
}

async function main(): Promise<void> {
  const baseUrl = requireEnvironment("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
  const key = requireEnvironment("SUPABASE_SERVICE_ROLE_KEY");

  const control = await probeTable(baseUrl, key, CONTROL_TABLE);
  if (control.exists !== true) {
    // Without this, "everything is missing" and "the probe is broken" look the
    // same, and the first reading would send someone to re-apply a live schema.
    //
    // The observed status is printed because the first version of this omitted
    // it, and a control failure with no status is a dead end for whoever reads
    // the log -- the guard fired correctly and still told them nothing useful.
    console.error(
      `The control table \`${CONTROL_TABLE}\` did not resolve, so this audit cannot distinguish `
      + "an unapplied migration from a failing probe.\n"
      + `  observed: ${control.detail}\n`
      + "  A 401 or 403 means the key is wrong or lacks REST access; a 404 means the URL is not "
      + "this project's REST endpoint. Neither says anything about the migrations.",
    );
    process.exit(2);
  }
  console.log(`Control: \`${CONTROL_TABLE}\` — ${control.detail}. The probe reaches the database.\n`);

  let applied = 0;
  let unknown = 0;
  const unprobeable: string[] = [];
  const outstanding: string[] = [];

  const expectations = readExpectations();
  // One probe per distinct table, not one per mention. Several migrations
  // create the same table under `if not exists`, and re-asking would slow the
  // audit without changing an answer.
  const seen = new Map<string, Promise<boolean | null>>();
  const probe = (table: string): Promise<boolean | null> => {
    const pending = seen.get(table) ?? tableExists(baseUrl, key, table);
    seen.set(table, pending);
    return pending;
  };

  // Read once, before the loop: one description covers every function.
  const callable = await readCallableFunctions(baseUrl, key);
  if (callable === null) {
    console.log(
      "PostgREST did not return its description, so this run can speak only to tables. "
      + "Every function-defining migration is reported as not probeable below.\n",
    );
  } else if (!callable.has(CONTROL_FUNCTION)) {
    // Same guard as the control table, for the same reason. This function is
    // reachable in production today; if the description omits it, the
    // description is not answering the question asked of it, and reading
    // absences out of it would report most of the schema as missing.
    console.error(
      `The control function \`${CONTROL_FUNCTION}\` is absent from PostgREST's description, so `
      + "function verdicts from it cannot be trusted. Tables are still reported.",
    );
  }
  const trustFunctions = callable !== null && callable.has(CONTROL_FUNCTION);

  for (const expectation of expectations) {
    const probedFunctions = trustFunctions ? expectation.functions : [];
    if (expectation.tables.length === 0 && probedFunctions.length === 0) {
      // A migration that only adds policies, grants, enum labels or data has
      // nothing this probe can ask PostgREST about. Counting it as applied
      // would be a guess; omitting it would hide that the audit is silent
      // about part of the directory.
      unprobeable.push(expectation.migration);
      continue;
    }

    const tableResults = await Promise.all(
      expectation.tables.map(async (table) => ({ table, exists: await probe(table) })),
    );
    const results = [
      ...tableResults,
      ...probedFunctions.map((name) => ({
        table: `${name}()`,
        // A name in the description is proof of presence. A name absent from
        // it is `not visible`, never `absent`: the document is filtered by
        // EXECUTE privilege, so a function with no grant looks the same as one
        // that was never created.
        exists: callable!.has(name) ? true : false,
      })),
    ];

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
      verdict = "NOT VISIBLE";
      outstanding.push(`${expectation.migration} — ${absent.join(", ")}`);
    } else {
      // The worst outcome and the reason this reports per table rather than per
      // migration: a half-applied migration cannot simply be re-run.
      verdict = "PARTLY VISIBLE";
      outstanding.push(`${expectation.migration} — ${absent.join(", ")}`);
    }

    console.log(`${verdict.padEnd(18)} ${expectation.migration}`);
    if (absent.length > 0) console.log(`                   not visible: ${absent.join(", ")}`);
    if (indeterminate.length > 0) console.log(`                   could not determine: ${indeterminate.join(", ")}`);
  }

  if (unprobeable.length > 0) {
    // Named, not just counted: "this audit says nothing about these" is the
    // part a reader is most likely to assume away.
    console.log(
      "\nThese migrations define nothing this probe can ask about -- no table, and no function "
      + "granted to the role it reads as. Their presence must be checked another way "
      + "(scripts/hosted-state-report.sql, or calling the function they define):\n  "
      + unprobeable.join("\n  "),
    );
  }

  if (outstanding.length > 0) {
    // Repeated at the bottom because it is the actionable half, and it was
    // scattered through a hundred lines of APPLIED above.
    console.log(`\nOutstanding:\n  ${outstanding.join("\n  ")}`);
    console.log(
      "\nNOT VISIBLE does not mean absent. PostgREST cannot see a table that exists with no "
      + "grants on it, which is exactly what a migration that failed before its grant statements "
      + "leaves behind -- and re-running that migration fails with `42P07: relation already "
      + "exists`.\n"
      + "Before applying anything, run scripts/hosted-state-report.sql in the SQL editor. It reads "
      + "pg_class directly and separates the two cases this probe cannot.",
    );
  }

  // The count goes last, under everything that qualifies it. It was printed
  // above the unprobeable list at first, where seventy names pushed the one
  // line a reader came for off the top of the terminal.
  console.log(
    `\n${applied} applied, ${outstanding.length} outstanding, ${unknown} indeterminate, `
    + `${unprobeable.length} not probeable `
    + `(of ${expectations.length} migrations in the repository).`,
  );
  // Outstanding migrations are a true finding, not a failure of the audit, so
  // this exits 0. A broken probe exits 2 above, which is the case worth failing.
  process.exit(0);
}

void main();
