// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_CAPACITY_LIMITS } from "@/lib/resources/capacity";

/**
 * Proof that the concurrency and rate limits hold in the database, against the
 * real migrated schema.
 *
 * The in-memory versions in `lib/resources/` are already tested. What those
 * tests cannot show is the property that made persistence necessary: the check
 * and the take have to happen somewhere both processes can see. A test that
 * only drove the TypeScript would pass against the version this migration
 * exists to replace, and would prove nothing about the defect being fixed — so
 * every assertion here goes through the RPC.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-00000000f001";
const outsiderId = "00000000-0000-4000-8000-00000000f002";
const organizationId = "10000000-0000-4000-8000-00000000f001";
const projectId = "40000000-0000-4000-8000-00000000f001";
const otherProjectId = "40000000-0000-4000-8000-00000000f002";

interface AcquireRow {
  admitted: boolean;
  refusal: string | null;
  reservation_id: string | null;
  retry_after_ms: number | null;
  worker_in_use: number;
  provider_in_use: number;
  project_in_use: number;
  requests_in_window: number;
  tokens_in_window: number;
}

async function actAs(db: PGlite, userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
}

async function acquire(
  db: PGlite,
  overrides: Partial<{
    project: string;
    agent: string;
    provider: string;
    model: string;
    leaseSeconds: number;
    perWorker: number;
    perProvider: number;
    perProject: number;
    rateWindowSeconds: number | null;
    maxRequests: number | null;
    maxTokens: number | null;
    estimatedTokens: number;
  }> = {},
): Promise<AcquireRow> {
  const settings = {
    project: projectId,
    agent: "agent-backend",
    provider: "openai",
    model: "gpt-economical",
    leaseSeconds: 60,
    perWorker: DEFAULT_CAPACITY_LIMITS.perWorker,
    perProvider: DEFAULT_CAPACITY_LIMITS.perProvider,
    perProject: DEFAULT_CAPACITY_LIMITS.perProject,
    rateWindowSeconds: null as number | null,
    maxRequests: null as number | null,
    maxTokens: null as number | null,
    estimatedTokens: 0,
    ...overrides,
  };

  const { rows } = await db.query<AcquireRow>(
    `select * from public.acquire_resource_reservation(
       $1::uuid, $2::text, $3::text, $4::text, $5::integer,
       $6::integer, $7::integer, $8::integer, null::uuid,
       $9::integer, $10::integer, $11::integer, $12::integer)`,
    [
      settings.project, settings.agent, settings.provider, settings.model, settings.leaseSeconds,
      settings.perWorker, settings.perProvider, settings.perProject,
      settings.rateWindowSeconds, settings.maxRequests, settings.maxTokens, settings.estimatedTokens,
    ],
  );
  return rows[0];
}

describe("Phase 2C reservation persistence", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create schema if not exists auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create or replace function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create or replace function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
    `);

    const migrationFiles = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
    expect(migrationFiles.at(-1)).toBe("20260822001300_contract_project_lifecycle_function_acls.sql");
    for (const file of migrationFiles) {
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${outsiderId}');
      insert into public.organizations (id, name, slug, created_by)
        values ('${organizationId}', 'Reservation Factory', 'reservation-factory', '${ownerId}');
      insert into public.projects (id, organization_id, name, status, github_repository, default_branch, created_by)
        values
          ('${projectId}', '${organizationId}', 'Storefront', 'active', 'surgeservicesllc/SoftwareFactory', 'main', '${ownerId}'),
          ('${otherProjectId}', '${organizationId}', 'Billing', 'active', 'surgeservicesllc/Billing', 'main', '${ownerId}');
    `);
  });

  afterEachCleanup(() => db);

  afterAll(async () => {
    await db.close();
  });

  describe("the limits hold in the database, not in a process", () => {
    it("refuses the slot after the per-worker limit, across separate calls", async () => {
      await actAs(db, ownerId);

      const results: AcquireRow[] = [];
      for (let attempt = 0; attempt <= DEFAULT_CAPACITY_LIMITS.perWorker; attempt += 1) {
        results.push(await acquire(db));
      }

      // Each call is its own transaction, standing in for the separate
      // processes that defeat an in-memory reservation list. The count survives
      // between them, which is the entire fix.
      expect(results.slice(0, DEFAULT_CAPACITY_LIMITS.perWorker).every((row) => row.admitted)).toBe(true);
      expect(results.at(-1)?.admitted).toBe(false);
      expect(results.at(-1)?.refusal).toBe("WORKER_AT_CAPACITY");
    });

    it("names the narrowest limit that applies, not merely that something refused", async () => {
      await actAs(db, ownerId);

      // Two different workers on one provider, with the provider limit set to
      // two. The per-worker limit is not reached by either.
      await acquire(db, { agent: "agent-a", perProvider: 2 });
      await acquire(db, { agent: "agent-b", perProvider: 2 });
      const refused = await acquire(db, { agent: "agent-c", perProvider: 2 });

      // Told "the project is full" here, an operator raises the project limit
      // and the provider limit refuses again immediately.
      expect(refused.refusal).toBe("PROVIDER_AT_CAPACITY");
    });

    it("bounds a project across workers and providers", async () => {
      await actAs(db, ownerId);

      await acquire(db, { agent: "agent-a", provider: "openai", perProject: 2 });
      await acquire(db, { agent: "agent-b", provider: "anthropic", perProject: 2 });
      const refused = await acquire(db, { agent: "agent-c", provider: "google", perProject: 2 });

      expect(refused.refusal).toBe("PROJECT_AT_CAPACITY");
    });

    it("keeps one project's ceiling out of another project's way", async () => {
      await actAs(db, ownerId);

      await acquire(db, { agent: "agent-a", perProject: 1 });
      const other = await acquire(db, { project: otherProjectId, agent: "agent-a", perProject: 1, perWorker: 5 });

      expect(other.admitted).toBe(true);
    });
  });

  describe("a slot is given back", () => {
    it("frees capacity on release", async () => {
      await actAs(db, ownerId);

      const held: string[] = [];
      for (let attempt = 0; attempt < DEFAULT_CAPACITY_LIMITS.perWorker; attempt += 1) {
        held.push((await acquire(db)).reservation_id!);
      }
      expect((await acquire(db)).admitted).toBe(false);

      const { rows } = await db.query<{ release_resource_reservation: boolean }>(
        "select public.release_resource_reservation($1::uuid)", [held[0]],
      );
      expect(rows[0].release_resource_reservation).toBe(true);
      expect((await acquire(db)).admitted).toBe(true);
    });

    it("reports a second release as false rather than raising", async () => {
      await actAs(db, ownerId);
      const reservationId = (await acquire(db)).reservation_id!;

      await db.query("select public.release_resource_reservation($1::uuid)", [reservationId]);
      const { rows } = await db.query<{ release_resource_reservation: boolean }>(
        "select public.release_resource_reservation($1::uuid)", [reservationId],
      );

      // A worker that died and is later reported complete hits this on the
      // happy path of a recovery. Raising would turn a clean recovery into an
      // error for something the expiry already handled.
      expect(rows[0].release_resource_reservation).toBe(false);
    });

    it("retires an expired lease so a dead worker does not strand its slot", async () => {
      await actAs(db, ownerId);

      // A lease that is released only on success leaks a slot every time a
      // worker dies, and the fleet throttles itself to a halt with nothing to
      // point at.
      for (let attempt = 0; attempt < DEFAULT_CAPACITY_LIMITS.perWorker; attempt += 1) {
        await acquire(db, { leaseSeconds: 1 });
      }
      expect((await acquire(db)).admitted).toBe(false);

      // Stepping out of `authenticated` to age the rows: the browser role has
      // no write grant on this table, which is the point of the boundary. Only
      // the clock is being faked here, never the permission.
      await db.exec("reset role");
      // Both timestamps move: a lease whose expiry precedes its acquisition is
      // refused by a check constraint, and rightly so -- no real lease looks
      // like that, so the test must not manufacture one to prove its point.
      await db.exec(`
        update public.resource_reservations
           set acquired_at = now() - interval '1 hour',
               expires_at = now() - interval '1 second'
         where released_at is null
      `);
      await actAs(db, ownerId);

      const afterExpiry = await acquire(db);
      expect(afterExpiry.admitted).toBe(true);
      expect(afterExpiry.worker_in_use).toBe(0);
    });
  });

  describe("rate is accounted separately from concurrency", () => {
    it("refuses a burst that never exceeds the concurrency limit", async () => {
      await actAs(db, ownerId);

      // The case that makes rate a separate gate: every one of these is
      // released immediately, so no slot is ever held and the concurrency limit
      // is satisfied throughout. The provider still sees three requests.
      const rate = { rateWindowSeconds: 60, maxRequests: 2, perWorker: 5 };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const row = await acquire(db, rate);
        await db.query("select public.release_resource_reservation($1::uuid)", [row.reservation_id]);
      }

      const refused = await acquire(db, rate);
      expect(refused.admitted).toBe(false);
      expect(refused.refusal).toBe("REQUEST_RATE_EXCEEDED");
      // Unlike a capacity refusal, this one can say when to come back.
      expect(refused.retry_after_ms).toBeGreaterThan(0);
      expect(refused.retry_after_ms).toBeLessThanOrEqual(60_000);
    });

    it("counts the estimate for the call being considered, not only history", async () => {
      await actAs(db, ownerId);
      const rate = { rateWindowSeconds: 60, maxTokens: 1_000, perWorker: 5 };

      await acquire(db, { ...rate, estimatedTokens: 900 });
      const refused = await acquire(db, { ...rate, estimatedTokens: 200 });

      // 900 + 200 exceeds 1000, and it has to be refused before the call is
      // made rather than noticed after.
      expect(refused.refusal).toBe("TOKEN_RATE_EXCEEDED");
    });

    it("does not charge a provider for another provider's requests", async () => {
      await actAs(db, ownerId);
      const rate = { rateWindowSeconds: 60, maxRequests: 1, perWorker: 5, perProvider: 5 };

      await acquire(db, { ...rate, provider: "openai" });
      const other = await acquire(db, { ...rate, provider: "anthropic" });

      expect(other.admitted).toBe(true);
    });

    it("records the request as an estimate until it is settled", async () => {
      await actAs(db, ownerId);
      const row = await acquire(db, { rateWindowSeconds: 60, maxRequests: 5, estimatedTokens: 500 });

      const { rows: before } = await db.query<{ tokens: number; estimated: boolean }>(
        "select tokens, estimated from public.resource_rate_events where reservation_id = $1", [row.reservation_id],
      );
      expect(before[0]).toMatchObject({ tokens: 500, estimated: true });

      await db.query("select public.settle_resource_rate_event($1::uuid, $2::integer)", [row.reservation_id, 120]);

      const { rows: after } = await db.query<{ tokens: number; estimated: boolean }>(
        "select tokens, estimated from public.resource_rate_events where reservation_id = $1", [row.reservation_id],
      );
      // An estimate recorded as a measurement is the same error as inventing a
      // success rate for a worker with no history.
      expect(after[0]).toMatchObject({ tokens: 120, estimated: false });
    });

    it("keeps retained rate history bounded by the window rather than by uptime", async () => {
      await actAs(db, ownerId);
      const rate = { rateWindowSeconds: 60, maxRequests: 50, perWorker: 99, perProvider: 99, perProject: 99 };

      await acquire(db, rate);
      await db.exec("reset role");
      await db.exec("update public.resource_rate_events set requested_at = now() - interval '10 minutes'");
      await actAs(db, ownerId);
      await acquire(db, rate);

      const { rows } = await db.query<{ count: number }>("select count(*)::int as count from public.resource_rate_events");
      // The aged-out row is pruned as the next admission is decided, so a
      // long-lived deployment does not accumulate every request it ever made.
      expect(rows[0].count).toBe(1);
    });
  });

  describe("the boundary refuses what it cannot mean", () => {
    it("refuses a limit of zero rather than guessing which meaning was intended", async () => {
      await actAs(db, ownerId);
      // Zero reads as "unlimited" to half the people who see it and "nothing
      // may run" to the other half, and those are opposites.
      await expect(acquire(db, { perWorker: 0 })).rejects.toThrow(/at least 1/i);
    });

    it("refuses a caller who is not a member of the organization", async () => {
      await actAs(db, outsiderId);
      await expect(acquire(db)).rejects.toThrow(/not a member/i);
    });

    it("refuses an unauthenticated caller", async () => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', '', false)");
      await db.exec("set role authenticated");
      await expect(acquire(db)).rejects.toThrow(/authentication is required/i);
    });
  });

  describe("the tables are exposed the way every other table here is", () => {
    it("keeps RLS forced and grants the browser no writes", async () => {
      await db.exec("reset role");
      const { rows } = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `select relname, relrowsecurity, relforcerowsecurity from pg_class
          where relname in ('resource_reservations', 'resource_rate_events') order by relname`,
      );
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.relrowsecurity).toBe(true);
        expect(row.relforcerowsecurity).toBe(true);
      }

      const { rows: grants } = await db.query<{ grantee: string; privilege_type: string }>(
        `select grantee, privilege_type from information_schema.role_table_grants
          where table_name in ('resource_reservations', 'resource_rate_events')
            and grantee in ('anon', 'authenticated', 'service_role')`,
      );
      // A connection record is metadata; a reservation is control-plane state.
      // Neither is writable from a browser, and service_role gains nothing.
      expect(grants.every((row) => row.privilege_type === "SELECT" && row.grantee === "authenticated")).toBe(true);
    });
  });
});

/**
 * Reservations are organization-wide state, so one test's held slots would
 * otherwise decide the next test's verdict.
 */
function afterEachCleanup(getDb: () => PGlite) {
  beforeEach(async () => {
    const db = getDb();
    await db.exec("reset role");
    await db.exec("delete from public.resource_rate_events");
    await db.exec("delete from public.resource_reservations");
  });
}
