import { readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The newest migration in the chain, read from the directory rather than
 * written down.
 *
 * Thirty-four suites replay the whole migration chain and assert that the
 * last file they applied is the one they expected — a cheap, genuinely
 * useful check that the replay covered everything rather than stopping
 * early. Each of them used to carry the filename as a literal, which meant
 * every new migration broke all thirty-four at once, in a way that looks
 * like thirty-four real failures and is actually one stale constant copied
 * thirty-four times.
 *
 * That happened three times in two days. The third time it happened
 * mid-flight on an open pull request, which is what this file is for.
 *
 * Reading the directory keeps what the assertion was worth — a suite that
 * silently stopped applying files still fails, because `at(-1)` on its own
 * list would not match the real newest — while removing the part that was
 * only ever bookkeeping. Adding a migration now touches the migration
 * directory and nothing else.
 */

const migrationsDirectory = resolve(import.meta.dirname, "../../supabase/migrations");

export const LATEST_MIGRATION: string = (() => {
  const files = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const newest = files.at(-1);
  if (newest === undefined) {
    throw new Error("supabase/migrations contains no .sql files");
  }
  return newest;
})();
