// @vitest-environment node


import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

/**
 * Phase 1B — the adverse lifecycle matrix.
 *
 * The happy path for the GitHub integration has been live for the owner
 * repository since Phase 1B shipped. What was never covered is the set of
 * things that go wrong afterwards: an installation revoked, a permission
 * withdrawn, a webhook arriving twice or out of order, a deletion that must be
 * terminal, a connection explicitly lost.
 *
 * Those are the cases where an integration quietly starts lying — reporting a
 * connection it no longer has, accepting a stale event as current, or losing
 * the history that explains what happened. Each one below asserts the refusal
 * rather than the success, because the refusals are what have never been
 * exercised.
 *
 * Everything runs against the real migrated schema. No mechanism is simulated.
 */


const ownerId = "00000000-0000-4000-8000-0000000b0001";
const outsiderId = "00000000-0000-4000-8000-0000000b0002";
const organizationId = "10000000-0000-4000-8000-0000000b0001";
const otherOrganizationId = "10000000-0000-4000-8000-0000000b0002";
const projectId = "40000000-0000-4000-8000-0000000b0001";
const connectionId = "20000000-0000-4000-8000-0000000b0001";
const installationId = "30000000-0000-4000-8000-0000000b0001";

const EXTERNAL_INSTALLATION = 153479019;

async function assumeRole(db: PGlite, role: string, userId: string | null = null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(`set role ${role}`);
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

describe("Phase 1B adverse lifecycle", () => {
  let db: PGlite;

  beforeAll(async () => {
    // The chain, restored from a snapshot rather than replayed; the
    // helper keys its cache on the CONTENT of every migration, and
    // asserts coverage of the whole directory.
    db = await createMigratedDatabase();

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${outsiderId}');

      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationId}', 'Adverse Factory', 'adverse-factory', '${ownerId}'),
        ('${otherOrganizationId}', 'Other', 'other-adverse', '${outsiderId}');

      insert into public.projects (id, organization_id, name, status, default_branch, created_by)
      values ('${projectId}', '${organizationId}', 'Bound', 'active', 'main', '${ownerId}');

      -- A connected connection must carry a secret *reference*, never secret
      -- material. The constraint enforcing that is the schema's way of saying a
      -- connection record is metadata plus a pointer.
      insert into public.connections (
        id, organization_id, name, provider, status, external_account_label,
        secret_reference, created_by
      ) values (
        '${connectionId}', '${organizationId}', 'GitHub', 'github', 'connected',
        'surgeservicesllc', 'env://GITHUB_APP_PRIVATE_KEY_BASE64', '${ownerId}'
      );

      insert into public.github_installations (
        id, organization_id, connection_id, external_installation_id, app_id, app_slug,
        account_id, account_login, account_type, target_type, repository_selection,
        status, installed_at, created_by
      ) values (
        '${installationId}', '${organizationId}', '${connectionId}', ${EXTERNAL_INSTALLATION},
        4582606, 'softwarefactory', 316305532, 'surgeservicesllc', 'User', 'User',
        'selected', 'active', now(), '${ownerId}'
      );
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  describe("revoked and insufficient permission", () => {
    it("records a connection as lost only for a declared reason", async () => {
      // An open-ended reason string would let any caller invent a loss state
      // that downstream code has no rule for.
      await expect(
        db.query("select public.mark_github_connection_lost($1::uuid, $2::uuid, $3::text)", [
          ownerId,
          connectionId,
          "felt like it",
        ]),
      ).rejects.toThrow(/invalid/i);

      const { rows } = await db.query<{ mark_github_connection_lost: boolean }>(
        "select public.mark_github_connection_lost($1::uuid, $2::uuid, $3::text)",
        [ownerId, connectionId, "installation_revoked"],
      );
      expect(rows[0].mark_github_connection_lost).toBe(true);
    });

    it("preserves the installation history rather than deleting it", async () => {
      // The record of what was connected is the only way to explain what
      // happened afterwards; losing it with the connection would be worse than
      // the loss itself.
      const { rows } = await db.query<{ count: string }>(
        "select count(*)::text as count from public.github_installations where connection_id = $1",
        [connectionId],
      );
      expect(rows[0].count).toBe("1");
    });

    it("reports a lost connection as lost rather than connected", async () => {
      const { rows } = await db.query<{ status: string }>(
        "select status::text as status from public.connections where id = $1",
        [connectionId],
      );
      expect(rows[0].status).not.toBe("connected");
    });

    it("is idempotent, so a repeated revocation signal changes nothing", async () => {
      const before = await db.query<{ status: string; updated_at: string }>(
        "select status::text as status, updated_at from public.connections where id = $1",
        [connectionId],
      );

      await db.query("select public.mark_github_connection_lost($1::uuid, $2::uuid, $3::text)", [
        ownerId,
        connectionId,
        "insufficient_permission",
      ]);

      const after = await db.query<{ status: string }>(
        "select status::text as status from public.connections where id = $1",
        [connectionId],
      );
      // A provider that resends a revocation must not ratchet the record into
      // some further state.
      expect(after.rows[0].status).toBe(before.rows[0].status);
    });

    it("refuses a caller outside the organization", async () => {
      await assumeRole(db, "authenticated", outsiderId);
      await expect(
        db.query("select public.mark_github_connection_lost($1::uuid, $2::uuid, $3::text)", [
          outsiderId,
          connectionId,
          "installation_revoked",
        ]),
      ).rejects.toThrow();
      await resetRole(db);
    });
  });

  describe("explicit disconnect", () => {
    it("refuses to disconnect against the wrong installation id", async () => {
      // The expected-installation argument exists so a disconnect cannot be
      // aimed at a connection that has since been re-installed.
      await expect(
        db.query("select public.disconnect_github_connection($1::uuid, $2::uuid, $3::bigint)", [
          ownerId,
          connectionId,
          999_999_999,
        ]),
      ).rejects.toThrow();
    });

    it("refuses a member who is neither owner nor admin", async () => {
      await expect(
        db.query("select public.disconnect_github_connection($1::uuid, $2::uuid, $3::bigint)", [
          outsiderId,
          connectionId,
          EXTERNAL_INSTALLATION,
        ]),
      ).rejects.toThrow();
    });

    it("disconnects on the exact installation and keeps the audit trail", async () => {
      const { rows } = await db.query<{ disconnect_github_connection: number }>(
        "select public.disconnect_github_connection($1::uuid, $2::uuid, $3::bigint)",
        [ownerId, connectionId, EXTERNAL_INSTALLATION],
      );

      expect(Number(rows[0].disconnect_github_connection)).toBeGreaterThanOrEqual(0);

      const history = await db.query<{ count: string }>(
        "select count(*)::text as count from public.github_installations where connection_id = $1",
        [connectionId],
      );
      expect(history.rows[0].count).toBe("1");
    });
  });

  describe("terminal deletion", () => {
    it("requires a deletion timestamp alongside the deleted status", async () => {
      // Status and marker cannot disagree: a row claiming deleted without a
      // time is a deletion nobody can date.
      await expect(
        db.exec(`
          update public.github_installations
             set status = 'deleted'
           where id = '${installationId}';
        `),
      ).rejects.toThrow(/deleted_marker_consistent/);
    });

    it("keeps a deleted installation deleted", async () => {
      await db.exec(`
        update public.github_installations
           set status = 'deleted', deleted_at = now()
         where id = '${installationId}';
      `);

      // A deleted-then-restored installation would let a revoked integration
      // quietly come back, so deletion is terminal for an installation ID.
      await expect(
        db.exec(`
          update public.github_installations
             set status = 'active', deleted_at = null
           where id = '${installationId}';
        `),
      ).rejects.toThrow();
    });
  });

  describe("cross-tenant privileged RPC matrix", () => {
    /**
     * The live two-tenant matrix needs a second authorized GitHub account and
     * cannot be faked. What *can* be proven here is the property that matrix
     * exists to check: that being an owner somewhere is not authority
     * everywhere. Each privileged RPC is called by a real owner of the *other*
     * organization, which is the shape a confused-deputy bug actually takes —
     * not an anonymous caller, but a legitimate one reaching sideways.
     */
    it("refuses an owner of another organization on every connection-scoped RPC", async () => {
      const attempts: { name: string; sql: string; params: unknown[] }[] = [
        {
          name: "mark_github_connection_lost",
          sql: "select public.mark_github_connection_lost($1::uuid, $2::uuid, $3::text)",
          params: [outsiderId, connectionId, "installation_revoked"],
        },
        {
          name: "disconnect_github_connection",
          sql: "select public.disconnect_github_connection($1::uuid, $2::uuid, $3::bigint)",
          params: [outsiderId, connectionId, EXTERNAL_INSTALLATION],
        },
      ];

      for (const attempt of attempts) {
        await expect(db.query(attempt.sql, attempt.params), attempt.name).rejects.toThrow();
      }
    });

    it("refuses a sync aimed at an organization the actor does not belong to", async () => {
      // The organization is a parameter, so passing someone else's is the
      // obvious attack and has to fail on membership rather than on shape.
      await expect(
        db.query(
          `select public.sync_github_installation(
             $1::uuid, $2::uuid, $3::bigint, $4::bigint, $5::text, $6::bigint, $7::text,
             $8::text, $9::text, $10::text, $11::text, $12::jsonb, $13::text[], $14::timestamptz
           )`,
          [
            outsiderId,
            organizationId,
            EXTERNAL_INSTALLATION,
            4582606,
            "softwarefactory",
            316305532,
            "surgeservicesllc",
            "User",
            null,
            "User",
            "selected",
            "{}",
            "{}",
            new Date().toISOString(),
          ],
        ),
      ).rejects.toThrow();
    });

    it("leaves the other organization's records untouched after every refusal", async () => {
      // The refusals above must not have partially applied.
      const { rows } = await db.query<{ count: string }>(
        "select count(*)::text as count from public.github_installations where organization_id = $1",
        [otherOrganizationId],
      );
      expect(rows[0].count).toBe("0");
    });
  });

  describe("isolation", () => {
    it("denies anonymous callers every GitHub table", async () => {
      await assumeRole(db, "anon");
      for (const table of ["connections", "github_installations", "github_repositories"]) {
        await expect(db.query(`select * from public.${table}`), table).rejects.toThrow(
          /permission denied/i,
        );
      }
      await resetRole(db);
    });

    it("shows an unrelated organization nothing", async () => {
      await assumeRole(db, "authenticated", outsiderId);
      const { rows } = await db.query(
        "select id from public.github_installations where organization_id = $1",
        [organizationId],
      );
      expect(rows).toEqual([]);
      await resetRole(db);
    });
  });
});
