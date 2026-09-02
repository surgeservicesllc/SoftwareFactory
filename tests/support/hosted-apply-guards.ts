import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");

/**
 * The apply workflow captures its largest catalog checks from files —
 * `VERIFIED=$(psql … -Atq -f .github/hosted-apply/guard/….sql)` — because the
 * workflow is measured against a byte ceiling. The suites that pin what a
 * step proves before it writes still read the step's text, so this splices
 * each captured file's SQL in right after the reference that runs it: every
 * ordering assertion (the check sits after the ledger write and before the
 * push) holds exactly as it did when the SQL was inline, and every content
 * assertion reads the file the dispatch will actually execute.
 */
export function withGuardFiles(run: string): string {
  return run.replace(
    /-f (\.github\/hosted-apply\/guard\/[a-z0-9-]+\.sql)\)/g,
    (reference: string, file: string) =>
      `${reference}\n${readFileSync(resolve(repositoryRoot, file), "utf8")}`,
  );
}
