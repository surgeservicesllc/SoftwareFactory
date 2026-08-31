import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

/**
 * A database with the whole migration chain already applied.
 *
 * WHY THIS EXISTS. Fifty-one suites each replayed all 222 migrations into a
 * fresh instance. Measured on a four-core box: replaying costs 5,378ms,
 * dumping the finished data directory costs 217ms, and restoring one costs
 * 981ms. So the same schema was being built fifty-one times at five and a
 * half times the price of loading it — roughly four minutes of a fifteen-
 * minute suite, against a CI job with about seventy seconds of headroom
 * under its twenty-minute ceiling.
 *
 * It also scales the right way round. Replay grows with the NUMBER of
 * migrations, so every increment makes it worse; restore grows with the
 * size of the finished schema, which moves far more slowly.
 *
 * WHAT IS PRESERVED. Each suite used to assert that the last file it
 * applied was the newest in the directory — a cheap check that the replay
 * covered everything rather than stopping early. That assertion is not
 * dropped, it moves here, and the fingerprint below makes it stronger: the
 * cache key is the CONTENT of every migration, so editing a file mid-run
 * builds a new snapshot rather than silently reusing a stale one.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

/**
 * The roles and auth shims hosted Supabase provides and PGlite does not.
 * Part of the snapshot, so a restored database is indistinguishable from a
 * replayed one.
 */
const BOOTSTRAP = `
  create schema if not exists auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create or replace function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
  $$;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema auth to anon, authenticated, service_role;
`;

async function migrationFiles(): Promise<string[]> {
  return (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
}

/**
 * A key over the CONTENT of the chain, not its filenames.
 *
 * Editing a migration in place is exactly the situation where a stale
 * snapshot would produce a green run against a schema nobody has — the
 * failure this repository has hit before from the other direction, when a
 * hand-written roster stopped covering the tables the migrations create.
 */
async function chainFingerprint(files: readonly string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update(await readFile(resolve(migrationsDirectory, file)));
  }
  return hash.digest("hex").slice(0, 32);
}

/** Reused within a worker process; the file cache is what crosses workers. */
let inProcess: { fingerprint: string; snapshot: Uint8Array } | null = null;

async function buildSnapshot(files: readonly string[]): Promise<Uint8Array> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(BOOTSTRAP);
  for (const file of files) {
    await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
  }
  const dumped = await db.dumpDataDir("none");
  await db.close();
  return new Uint8Array(await dumped.arrayBuffer());
}

/**
 * A PGlite instance with every migration applied.
 *
 * The caller owns it and must close it, exactly as before.
 */
export async function createMigratedDatabase(): Promise<PGlite> {
  const files = await migrationFiles();
  if (files.length === 0) {
    throw new Error("supabase/migrations contains no .sql files");
  }
  const fingerprint = await chainFingerprint(files);

  if (inProcess === null || inProcess.fingerprint !== fingerprint) {
    const cachePath = join(tmpdir(), `sf-pglite-chain-${fingerprint}.tar`);
    let snapshot: Uint8Array;
    if (existsSync(cachePath)) {
      snapshot = new Uint8Array(await readFile(cachePath));
    } else {
      snapshot = await buildSnapshot(files);
      // Write then rename, because several vitest workers reach this at the
      // same moment and a half-written tar would be worse than a slow one.
      const staging = await mkdtemp(join(tmpdir(), "sf-pglite-"));
      const temporary = join(staging, "chain.tar");
      await writeFile(temporary, snapshot);
      await rename(temporary, cachePath).catch(() => {
        // Another worker won the race and the file is already correct.
      });
    }
    inProcess = { fingerprint, snapshot };
  }

  // A fresh Blob per call: loadDataDir consumes it, and two suites must not
  // share one instance's state.
  return PGlite.create({
    loadDataDir: new Blob([inProcess.snapshot as BlobPart]),
    extensions: { pgcrypto },
  });
}

/**
 * The newest migration in the chain, for suites that still assert it
 * directly. Reading the directory rather than writing it down is what keeps
 * adding a migration from breaking fifty-one suites at once.
 */
export async function latestMigration(): Promise<string> {
  const files = await migrationFiles();
  const newest = files.at(-1);
  if (newest === undefined) {
    throw new Error("supabase/migrations contains no .sql files");
  }
  return newest;
}
