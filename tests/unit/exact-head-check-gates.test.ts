import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every hosted release gate that requires exact-head CI must ask GitHub for
 * each required check by name.
 *
 * The gates used to read one page of the head's check runs and filter it
 * locally. A long-lived main head accumulates scheduled worker check-ins —
 * main 91a7e2b carried 106 — and the four CI checks then sit on a page the
 * gate never read, so a green head reports "missing|missing" and a
 * read-only verify refuses (run 33702924062). One server-filtered request
 * per required check cannot miss them, whatever else ran on that head.
 */

const REQUIRED_CHECKS = [
  "Lint, typecheck, test, and build",
  "Browser and accessibility tests 1/3",
  "Browser and accessibility tests 2/3",
  "Browser and accessibility tests 3/3",
] as const;

const GATES: ReadonlyArray<{ workflow: string; gates: number }> = [
  { workflow: "apply-hosted-migrations.yml", gates: 2 },
  { workflow: "grok-bot-completion-migrations.yml", gates: 2 },
  { workflow: "grok-bot-release-migrations.yml", gates: 1 },
  { workflow: "factory-lifecycle-release-migrations.yml", gates: 1 },
  { workflow: "graph-artifact-containment.yml", gates: 1 },
];

function workflowSource(name: string): string {
  return readFileSync(join(process.cwd(), ".github", "workflows", name), "utf8");
}

describe("exact-head CI gates", () => {
  for (const { workflow, gates } of GATES) {
    it(`${workflow} fetches each required check by name, ${gates} gate(s)`, () => {
      const source = workflowSource(workflow);

      // Every check-runs request is server-filtered by check_name and lives
      // inside the required-check loop, never before it.
      const requests = source.match(/commits\/\$\{[A-Z_]+\}\/check-runs\?per_page=100"\)/g) ?? [];
      expect(requests).toHaveLength(gates);
      const filtered = source.match(/--data-urlencode "check_name=\$\{(?:REQUIRED_CHECK|NAME)\}" \\/g) ?? [];
      expect(filtered).toHaveLength(gates);
      const gets = source.match(/(?:CHECK_RUNS|CHECKS)=\$\(curl --fail --silent --show-error --get \\/g) ?? [];
      expect(gets).toHaveLength(gates);

      // A page read before the loop is the defect; none may remain.
      expect(source).not.toMatch(
        /(?:CHECK_RUNS|CHECKS)=\$\(curl --fail --silent --show-error \\\n(?:[^\n]*\n){3}[^\n]*check-runs\?per_page=100"\)\n\s+for (?:REQUIRED_CHECK|NAME) in/,
      );

      // The loop still names exactly the four CI checks, each time: three end
      // a continued line, the last one opens the loop body.
      for (const name of REQUIRED_CHECKS) {
        const quoted = `"${name}"`;
        const continued = source.split(`${quoted} \\\n`).length - 1;
        const opening = source.split(`${quoted}; do\n`).length - 1;
        expect(continued + opening, `${quoted} in ${workflow}`).toBe(gates);
      }
    });
  }
});
