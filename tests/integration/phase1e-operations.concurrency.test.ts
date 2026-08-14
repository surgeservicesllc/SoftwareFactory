// @vitest-environment node

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Concurrency guarantees, proven against a real PostgreSQL server.
 *
 * The rest of the Phase 1E suite runs on PGlite, which is single-connection —
 * so the claims that actually matter under load could not be tested there:
 * that repeated signals fold into one incident, that two processors never claim
 * the same event, that freezing twice produces one freeze, and that concurrent
 * rollback decisions receive successive attempt numbers.
 *
 * This spec starts a real cluster, applies the full migration chain to it, and
 * exercises those four properties with genuinely parallel connections. If no
 * PostgreSQL server binary is present it skips rather than failing, so it adds
 * evidence wherever a server exists without making the suite depend on one.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

// A Unix socket path is capped near 107 bytes, so the cluster needs a short
// directory rather than a nested scratch path.
const clusterRoot = "/tmp/sf-phase1e-concurrency";
const dataDirectory = `${clusterRoot}/data`;
const socketDirectory = `${clusterRoot}/sock`;
const port = "54401";
const database = "sf1e_concurrency";

function findPostgresBin(): string | null {
  const candidates = [
    "/usr/lib/postgresql/17/bin",
    "/usr/lib/postgresql/16/bin",
    "/usr/lib/postgresql/15/bin",
    "/usr/local/pgsql/bin",
  ];
  return candidates.find((directory) => existsSync(`${directory}/initdb`)) ?? null;
}

const postgresBin = findPostgresBin();
const canRun = postgresBin !== null && process.platform === "linux";

const ownerId = "00000000-0000-4000-8000-00000000c001";
const organizationId = "10000000-0000-4000-8000-00000000c001";
const projectId = "40000000-0000-4000-8000-00000000c001";

function psql(sql: string, { expectFailure = false } = {}): string {
  const result = spawnSync(
    "psql",
    ["-h", socketDirectory, "-p", port, "-U", "postgres", "-d", database, "-q", "-t", "-A", "-c", sql],
    { encoding: "utf8" },
  );
  if (!expectFailure && result.status !== 0) {
    throw new Error(`psql failed: ${result.stderr || result.stdout}`);
  }
  return `${result.stdout}${result.stderr}`;
}

/**
 * Run the same statement from N genuinely parallel connections.
 *
 * This must use async `spawn`. `spawnSync` inside a promise still blocks the
 * event loop, so the processes would run strictly one after another and the
 * race being tested could never occur — a version of this helper built that way
 * passed happily against the unfixed function.
 */
function psqlParallel(sql: string, copies: number): Promise<string[]> {
  return Promise.all(
    Array.from({ length: copies }, () =>
      new Promise<string>((resolvePromise) => {
        const child = spawn(
          "psql",
          ["-h", socketDirectory, "-p", port, "-U", "postgres", "-d", database, "-q", "-t", "-A", "-c", sql],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        let output = "";
        child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        child.on("close", () => resolvePromise(output));
      }),
    ),
  );
}

const asOwner = `set role authenticated; select set_config('request.jwt.claim.sub','${ownerId}',false);`;

describe.skipIf(!canRun)("Phase 1E concurrency on real PostgreSQL", () => {
  beforeAll(async () => {
    rmSync(clusterRoot, { recursive: true, force: true });
    mkdirSync(dataDirectory, { recursive: true });
    mkdirSync(socketDirectory, { recursive: true });

    // PostgreSQL refuses to run as root, so the cluster runs as the postgres
    // user when this test executes as root, and as the current user otherwise.
    const runningAsRoot = typeof process.getuid === "function" && process.getuid() === 0;
    const shell = (command: string) =>
      execFileSync(runningAsRoot ? "su" : "sh", runningAsRoot ? ["postgres", "-c", command] : ["-c", command], {
        encoding: "utf8",
        stdio: "pipe",
      });

    if (runningAsRoot) {
      execFileSync("chown", ["-R", "postgres", clusterRoot]);
    }
    execFileSync("chmod", ["700", dataDirectory]);

    shell(`${postgresBin}/initdb -D ${dataDirectory} -U postgres --auth=trust`);
    shell(
      `${postgresBin}/pg_ctl -D ${dataDirectory} -o "-p ${port} -k ${socketDirectory} -c listen_addresses=" -l ${clusterRoot}/pg.log start -w`,
    );

    execFileSync("psql", ["-h", socketDirectory, "-p", port, "-U", "postgres", "-c", `create database ${database};`], {
      encoding: "utf8",
    });

    psql(`
      create schema if not exists auth;
      create table auth.users (id uuid primary key default gen_random_uuid(), raw_user_meta_data jsonb not null default '{}'::jsonb);
      create or replace function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create or replace function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
    `);

    const migrationFiles = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of migrationFiles) {
      const sql = readFileSync(resolve(migrationsDirectory, file), "utf8");
      const result = spawnSync(
        "psql",
        ["-h", socketDirectory, "-p", port, "-U", "postgres", "-d", database, "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"],
        { encoding: "utf8", input: sql },
      );
      if (result.status !== 0) {
        throw new Error(`migration ${file} failed on real PostgreSQL: ${result.stderr}`);
      }
    }

    psql(`
      insert into auth.users (id) values ('${ownerId}');
      insert into public.organizations (id, name, slug, created_by)
        values ('${organizationId}','Concurrency Factory','concurrency-factory','${ownerId}');
      insert into public.projects (id, organization_id, name, status, default_branch, created_by)
        values ('${projectId}','${organizationId}','Storefront','active','main','${ownerId}');
    `);
  }, 180_000);

  afterAll(() => {
    if (!canRun) return;
    const runningAsRoot = typeof process.getuid === "function" && process.getuid() === 0;
    spawnSync(runningAsRoot ? "su" : "sh", runningAsRoot
      ? ["postgres", "-c", `${postgresBin}/pg_ctl -D ${dataDirectory} stop -m immediate`]
      : ["-c", `${postgresBin}/pg_ctl -D ${dataDirectory} stop -m immediate`], { encoding: "utf8" });
    rmSync(clusterRoot, { recursive: true, force: true });
  });

  it("applies the entire migration chain to a real PostgreSQL server", () => {
    // Reaching this point means every migration, including the Phase 1E ones,
    // applied under a real postmaster rather than only under PGlite.
    const tables = psql(
      "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname='public' and c.relkind='r';",
    ).trim();
    expect(Number(tables)).toBeGreaterThanOrEqual(39);

    const unprotected = psql(`
      select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public' and c.relkind='r' and (not c.relrowsecurity or not c.relforcerowsecurity);
    `).trim();
    expect(Number(unprotected)).toBe(0);
  });

  it("folds simultaneous identical signals into exactly one incident", async () => {
    const outputs = await psqlParallel(
      `${asOwner} select incident_id from public.open_production_incident(
         '${projectId}'::uuid, 'uptime:concurrent:status-503', 'Concurrent failure',
         'sev2'::public.incident_sev, 'uptime'::public.production_signal_kind, 'symptom', 'impact',
         null, null, null, '{}'::jsonb);`,
      8,
    );

    expect(outputs.filter((output) => /ERROR/.test(output))).toEqual([]);

    const summary = psql(
      "select count(*)||':'||max(occurrence_count) from public.incidents where fingerprint='uptime:concurrent:status-503';",
    ).trim();
    // One incident, and every one of the eight signals counted against it.
    expect(summary).toBe("1:8");
  }, 60_000);

  it("never lets two processors claim the same event", async () => {
    psql(`
      insert into public.operations_events (organization_id, project_id, event_type, dedupe_key)
      select '${organizationId}','${projectId}','health.failed','race-key-'||g
      from generate_series(1,6) g on conflict do nothing;
    `);

    const outputs = await psqlParallel(
      `${asOwner} select id from public.claim_operations_event('${organizationId}'::uuid);`,
      6,
    );
    expect(outputs.filter((output) => /ERROR/.test(output))).toEqual([]);

    // No event may be claimed twice, so no attempt counter may exceed one.
    const maxAttempts = psql(
      "select coalesce(max(attempts),0) from public.operations_events where dedupe_key like 'race-key-%';",
    ).trim();
    expect(Number(maxAttempts)).toBe(1);

    const doubleClaimed = psql(`
      select count(*) from (
        select id from public.operations_events where dedupe_key like 'race-key-%' and attempts > 1
      ) duplicated;
    `).trim();
    expect(Number(doubleClaimed)).toBe(0);
  }, 60_000);

  it("produces exactly one active freeze when several freezes race", async () => {
    psql(`
      update public.release_freezes set state='released', released_at=now(), released_by='${ownerId}' where state='active';
      update public.projects set autonomous_releases_frozen=false where id='${projectId}';
    `);

    const outputs = await psqlParallel(
      `${asOwner} select public.freeze_project_releases('${projectId}'::uuid,'RACE_TEST','Concurrent freeze attempt',null,true);`,
      6,
    );
    expect(outputs.filter((output) => /ERROR/.test(output))).toEqual([]);

    const active = psql("select count(*) from public.release_freezes where state='active';").trim();
    expect(Number(active)).toBe(1);
  }, 60_000);

  it("gives concurrent rollback decisions successive attempt numbers", async () => {
    const incidentId = psql(
      "select id from public.incidents where fingerprint='uptime:concurrent:status-503';",
    ).trim();

    const outputs = await psqlParallel(
      `${asOwner} select attempt from public.record_rollback_decision(
         '${incidentId}'::uuid,false,'EXECUTOR_NOT_CONNECTED','{}'::jsonb,null,null);`,
      3,
    );

    // Before the incident row was locked, two of these lost to the attempt
    // uniqueness index and surfaced a raw 23505 instead of a decision.
    expect(outputs.filter((output) => /duplicate key value/.test(output))).toEqual([]);

    const attempts = psql(
      `select string_agg(attempt::text, ',' order by attempt) from public.rollback_operations where incident_id='${incidentId}';`,
    ).trim();
    expect(attempts).toBe("1,2,3");

    // The bound still holds: a fourth decision is refused by policy, not by a
    // constraint violation.
    const fourth = psql(
      `${asOwner} select attempt from public.record_rollback_decision(
         '${incidentId}'::uuid,false,'EXECUTOR_NOT_CONNECTED','{}'::jsonb,null,null);`,
      { expectFailure: true },
    );
    expect(fourth).toMatch(/bounded rollback attempt limit/i);
  }, 60_000);
});
