// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * The worker waits for CI jobs by display name, so the names have to match.
 *
 * `SOFTWAREFACTORY_REQUIRED_CHECKS` names the checks a Phase 1C run waits for
 * before it reports a result. GitHub reports check runs by their display name,
 * so the worker is coupled to the `name:` of each job in `ci.yml` through a
 * string that nothing validates.
 *
 * Renaming a CI job is an ordinary, obviously-safe-looking edit. It would leave
 * the worker waiting for a check that will never report — and the failure mode
 * is a hang rather than an error, on the live acceptance path, after real work
 * has already been done and pushed. That is expensive to diagnose and trivial
 * to prevent.
 *
 * This is the same class of defect as the migration version collision and the
 * `.rpc()` argument mismatch: a cross-file string contract that type-checks,
 * lints, and passes every other test, because the two halves are only brought
 * together at runtime.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");

let ci = "";
let worker = "";
let graphWorker = "";
let graphWorkerScript = "";
let releaseLineageMigration = "";
let exactWorkspaceMigration = "";
let releasePolicy: { requiredChecks: string[] };

beforeAll(async () => {
  ci = await readFile(resolve(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
  worker = await readFile(resolve(repositoryRoot, ".github/workflows/codex-worker.yml"), "utf8");
  graphWorker = await readFile(resolve(repositoryRoot, ".github/workflows/graph-worker.yml"), "utf8");
  graphWorkerScript = await readFile(resolve(repositoryRoot, "scripts/graph-worker.mts"), "utf8");
  releaseLineageMigration = await readFile(
    resolve(repositoryRoot, "supabase/migrations/20260827000200_graph_phase1c_release_lineage.sql"),
    "utf8",
  );
  exactWorkspaceMigration = await readFile(
    resolve(repositoryRoot, "supabase/migrations/20260831002000_exact_graph_repository_workspace.sql"),
    "utf8",
  );
  releasePolicy = JSON.parse(
    await readFile(resolve(repositoryRoot, ".softwarefactory/release-policy.json"), "utf8"),
  ) as { requiredChecks: string[] };
});

/**
 * Job-level `name:` values, with a one-dimensional matrix expanded.
 *
 * GitHub reports one check per matrix combination, named by substituting the
 * matrix value into the job's `name:`. Reading the template literally would
 * make the worker's list look wrong for a sharded job and — worse — would let
 * a shard count change without anything noticing that a required check no
 * longer exists. The e2e job is sharded, so the expansion is the contract.
 */
function ciJobNames(source: string): string[] {
  const names: string[] = [];
  // Split on job keys (two-space indent) so a matrix belongs to its own job.
  const blocks = source.split(/^ {2}(?=[A-Za-z_][A-Za-z0-9_-]*:$)/m);
  for (const block of blocks) {
    const name = /^ {4}name: (.+)$/m.exec(block)?.[1]?.trim();
    if (!name) continue;

    const variable = /\$\{\{\s*matrix\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/.exec(name);
    if (!variable) {
      names.push(name);
      continue;
    }

    const values = /^ {8}[A-Za-z_][A-Za-z0-9_]*: \[(.+)\]$/m.exec(block)?.[1];
    if (!values) {
      throw new Error(`${name} interpolates matrix.${variable[1]} but no matrix values were found`);
    }
    for (const value of values.split(",").map((entry) => entry.trim().replace(/^["']|["']$/g, ""))) {
      names.push(name.replace(variable[0], value));
    }
  }
  return names;
}

function requiredChecks(source: string): string[] {
  const match = /^ {6}SOFTWAREFACTORY_REQUIRED_CHECKS: (.+)$/m.exec(source);
  if (!match) return [];
  return match[1]
    .trim()
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);
}

describe("required check wiring", () => {
  it("finds both halves of the contract, so an empty match cannot pass vacuously", () => {
    expect(ciJobNames(ci).length).toBeGreaterThan(0);
    expect(requiredChecks(worker).length).toBeGreaterThan(0);
  });

  it("names only checks that a CI job actually produces", () => {
    const produced = ciJobNames(ci);
    const awaited = requiredChecks(worker);

    const missing = awaited.filter((name) => !produced.includes(name));

    // A name here that CI never reports is a run that waits forever.
    expect(missing).toEqual([]);
  });

  it("waits for every CI job, so a new required job is not silently ignored", () => {
    // The reverse direction matters too: adding a job to CI without adding it
    // here means the worker reports success while a required check is still
    // running or failing.
    const produced = ciJobNames(ci);
    const awaited = requiredChecks(worker);

    expect([...awaited].sort()).toEqual([...produced].sort());
  });

  it("keeps the graph worker's TEST-anchor verdict on the same names", () => {
    // Protocol v4 resolves the policy from the graph's immutable database
    // target. The workflow must not override that target with ambient text.
    expect(requiredChecks(graphWorker)).toEqual([]);
    expect(graphWorker).not.toContain("SOFTWAREFACTORY_REQUIRED_CHECKS:");
    expect(graphWorkerScript).toContain("target.required_check_names");
  });

  it("flows the repository-owned four-check policy through launch and exact claim", () => {
    const expected = [
      "Lint, typecheck, test, and build",
      "Browser and accessibility tests 1/3",
      "Browser and accessibility tests 2/3",
      "Browser and accessibility tests 3/3",
    ];

    expect(releasePolicy.requiredChecks).toEqual(expected);
    expect(requiredChecks(worker)).toEqual(expected);
    expect(requiredChecks(graphWorker)).toEqual([]);
    expect(releaseLineageMigration).toMatch(
      /create or replace function public\.create_graph_from_plan_with_release_identity_as_server\([\s\S]*?p_required_check_names jsonb[\s\S]*?required_check_names_value := p_required_check_names/i,
    );
    expect(releaseLineageMigration).toMatch(
      /graph_required_check_policy_is_safe\(required_check_names_value\)[\s\S]*?required_checks_sha256_value :=[\s\S]*?required_check_names = required_check_names_value,[\s\S]*?required_checks_sha256 = required_checks_sha256_value/i,
    );
    expect(releaseLineageMigration).toMatch(
      /create or replace function public\.claim_planned_graph_internal\([\s\S]*?p_required_check_names jsonb[\s\S]*?graph_required_check_policy_is_safe\(p_required_check_names\)[\s\S]*?g\.required_check_names = p_required_check_names/i,
    );
    expect(releaseLineageMigration).toMatch(
      /char_length\(check_name #>> '\{\}'\) not between 1 and 160[\s\S]*?strpos\(check_name #>> '\{\}', '\|'\) > 0/i,
    );
    expect(exactWorkspaceMigration).toMatch(
      /resolve_graph_execution_target_as_worker[\s\S]*?'required_check_names', graph\.required_check_names[\s\S]*?'required_checks_sha256', graph\.required_checks_sha256/i,
    );
    expect(exactWorkspaceMigration).toMatch(
      /claim_planned_graph_by_target_v4[\s\S]*?v_target -> 'required_check_names'/i,
    );
  });

  it("never substitutes the graph-worker checkout for produced-change lineage", () => {
    expect(graphWorkerScript).toMatch(/producedChangeSha:\s*parsed\.graph\.phase1c_head_sha/);
    expect(graphWorkerScript).toMatch(/mergeCommitSha:\s*parsed\.graph\.merge_commit_sha/);
    expect(graphWorkerScript).toMatch(/deploymentUrl:\s*parsed\.graph\.deployment_url/);
    expect(graphWorkerScript).not.toMatch(/(?:producedChangeSha|mergeCommitSha):\s*process\.env\./);
    expect(graphWorkerScript).not.toMatch(/deploymentUrl:\s*process\.env\./);
    expect(graphWorkerScript).not.toMatch(/productionUrl:\s*process\.env\./);
    expect(graphWorker).not.toMatch(/^\s+SOFTWAREFACTORY_(?:PRODUCED_CHANGE|MERGE_COMMIT)_SHA:.*github\.sha/m);
    expect(graphWorker).not.toContain("SOFTWAREFACTORY_PRODUCTION_URL");
    expect(graphWorker).toMatch(/permissions:\s*\r?\n\s+contents:\s*read/m);
    expect(graphWorker).not.toMatch(/^\s+(?:pull-requests|deployments):/m);
    expect(graphWorker).not.toMatch(/^\s+[a-z_]+:\s*write\s*$/m);
  });

  it("contains unusable claims with bounded canned abort evidence", () => {
    expect(graphWorkerScript).toContain("CLAIM_ABORT_DETAIL.invalidProjection");
    expect(graphWorkerScript).toContain("CLAIM_ABORT_DETAIL.targetMismatch");
    expect(graphWorkerScript).toContain("CLAIM_ABORT_DETAIL.compileFailure");
    expect(graphWorkerScript).not.toMatch(/abortRun\([^)]*(?:parsed|compiled)\.detail/);
    expect(graphWorkerScript).not.toMatch(/abortRun\([^)]*mismatch/);
  });

  it("threads the dispatch graph id into an exact database claim and queue diagnosis", () => {
    expect(graphWorker).toMatch(
      /SOFTWAREFACTORY_TARGET_GRAPH_ID:\s*\$\{\{ github\.event\.client_payload\.graph_id \|\| inputs\.graph_id \|\| '' \}\}/,
    );
    expect(graphWorker).not.toContain("SOFTWAREFACTORY_TARGET_CLAIM_REQUIRED:");
    expect(graphWorkerScript).toContain('requiredUuidEnv("SOFTWAREFACTORY_TARGET_GRAPH_ID")');
    expect(graphWorkerScript).toMatch(/SupabaseGraphTargetResolver\.create\([\s\S]*?\.resolve\(targetGraphId\)/);
    expect(graphWorkerScript).toMatch(/SupabaseGraphStore\.create\([\s\S]*?exactTarget:\s*target/);
    expect(graphWorkerScript).toContain("The graph worker accepts only an exact-target --once invocation.");
    expect(graphWorkerScript).not.toContain("process.cwd()");
    expect(graphWorkerScript).not.toContain("GITHUB_REPOSITORY");
  });

  it("preloads exactly the validation image the validator demands", async () => {
    // The workflow pulls a pinned digest; `DeterministicValidator` refuses to
    // run against anything but `PINNED_VALIDATION_IMAGE`. Bumping one without
    // the other fails a live run *after* it has claimed a durable attempt and
    // prepared a workspace — the expensive place to discover a typo.
    const validation = await readFile(
      resolve(repositoryRoot, "lib/worker/validation.ts"),
      "utf8",
    );
    const expected = /PINNED_VALIDATION_IMAGE = "([^"]+)"/.exec(validation)?.[1];

    expect(expected, "PINNED_VALIDATION_IMAGE not found in lib/worker/validation.ts").toBeDefined();
    expect(expected).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(
      worker.includes(`docker pull ${expected}`),
      `codex-worker.yml must preload ${expected}`,
    ).toBe(true);
  });

  it("keeps the merge-readiness fixtures on the same names", async () => {
    // `evaluateMergeReadiness` treats an unreported required check as blocking.
    // Its tests encode these names as fixtures, so they drift silently too.
    const fixtures = await readFile(
      resolve(repositoryRoot, "tests/unit/autonomy-merge-readiness.test.ts"),
      "utf8",
    );

    for (const name of requiredChecks(worker)) {
      expect(fixtures).toContain(name);
    }
  });
});

describe("CI verdicts on main", () => {
  /**
   * A merge that cancels the previous merge's CI leaves main unverified.
   *
   * `cancel-in-progress` is correct for a pull-request ref: a newer push to the
   * same branch makes the older run's answer worthless. It is wrong for pushes
   * to main, where each commit is a distinct thing to verify and the older run
   * is the only proof that the commit before it was good. With a shared group,
   * a burst of merges leaves a trail of `cancelled` runs — runs 32272713212 and
   * 32216103242 were both cancelled that way — and a cancelled run is
   * indistinguishable from a suite that never ran.
   *
   * This is a guard on the shape of the answer, not on how it is spelled: any
   * config that keys pushes by commit and refuses to pre-empt them passes.
   */
  it("gives every commit on main its own concurrency group", () => {
    const group = /^ {2}group: (.+)$/m.exec(ci)?.[1] ?? "";

    expect(group, "ci.yml must declare a concurrency group").not.toBe("");
    // github.ref is identical for every push to main; github.sha is not.
    expect(group).toContain("github.sha");
    expect(group).toContain("push");
  });

  it("never pre-empts an in-progress run for a push", () => {
    const cancel = /^ {2}cancel-in-progress: (.+)$/m.exec(ci)?.[1]?.trim() ?? "";

    expect(cancel, "ci.yml must declare cancel-in-progress").not.toBe("");
    // A bare `true` cancels main's own verification; the value has to be an
    // expression that excludes pushes.
    expect(cancel).not.toBe("true");
    expect(cancel).toMatch(/github\.event_name/);
    expect(cancel).toContain("push");
  });
  it("runs as many Playwright shards as the matrix declares", () => {
    // `--shard=i/n`: the denominator is written separately from the matrix, so
    // adding a fourth shard without changing it leaves shard 4 of 3, and
    // Playwright refuses. Getting it wrong the other way — four matrix values
    // against `/3` — is worse: three jobs re-run the same third of the suite
    // and a third of the tests never run at all, with three green checks.
    const shardValues = /^ {8}shard: \[(.+)\]$/m.exec(ci)?.[1];
    expect(shardValues, "ci.yml must declare the shard matrix").toBeDefined();
    const declared = (shardValues as string).split(",").length;

    const denominator = /--shard=\$\{\{ matrix\.shard \}\}\/(\d+)/.exec(ci)?.[1];
    expect(denominator, "ci.yml must run playwright with --shard").toBeDefined();

    expect(Number(denominator)).toBe(declared);
    // And the job name says the same number, so the check names a reader sees
    // match the split that actually ran.
    expect(ci).toContain(`name: Browser and accessibility tests \${{ matrix.shard }}/${declared}`);
  });
});
