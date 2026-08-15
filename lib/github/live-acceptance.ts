/**
 * Phase 1B items 2 and 20, as checks rather than as prose.
 *
 * These two items are the last 10% of Phase 1B and neither is engineering: one
 * needs a GitHub App installed on a second, independent account, the other
 * needs a deliberate adverse-event pass against that throwaway installation.
 * Both are console actions only the account owner can perform, and this
 * environment has no way to perform them — there is no second account, no tool
 * that installs an App or suspends an installation, no App private key with
 * which to mint the JWT that API would need, and no REST endpoint that creates
 * an organization.
 *
 * What *was* still engineering is this file. `AI/PHASE_1B_COMPLETION.md`
 * describes the verification in English — four conditions for item 2, five for
 * item 20 — which means whoever closes these items re-derives them, and the
 * result is a judgement rather than a record. Here they are one function of
 * observed rows, so the owner performs the clicks, runs one command, and gets a
 * verdict that says exactly which condition failed if one did.
 *
 * Deliberately pure. It reads nothing and calls nothing: the script that wraps
 * it does the I/O, so every rule below is exercised in a unit test without a
 * second GitHub account in sight. That is the whole point — the rules can be
 * proven correct now, and only the observations have to wait.
 */

export type CheckStatus = "PASS" | "FAIL" | "NOT_OBSERVED";

export interface CheckResult {
  readonly id: string;
  readonly item: 2 | 20;
  /** What this check would prove, in the words of the completion scorecard. */
  readonly claim: string;
  readonly status: CheckStatus;
  /** Why it passed or failed, naming the observation rather than restating the claim. */
  readonly detail: string;
}

export interface InstallationObservation {
  readonly externalInstallationId: number;
  readonly accountLogin: string;
  readonly connectionId: string;
  readonly organizationId: string;
  readonly status: string;
  readonly suspendedAt: string | null;
}

export interface RepositoryObservation {
  readonly fullName: string;
  readonly installationId: string;
  readonly selected: boolean;
}

export interface CrossTenantProbe {
  /** Rows the *first* tenant's owner can see for the second installation. */
  readonly visibleInstallationRows: number;
  /** Rows the first tenant's owner can see for the second tenant's repositories. */
  readonly visibleRepositoryRows: number;
  /**
   * What happened when the first tenant's owner attempted a change reservation
   * against the second tenant's repository. A refusal is the pass.
   */
  readonly writeAttempt: { readonly refused: boolean; readonly sqlState: string | null };
}

export interface ActivityProbe {
  readonly organizationId: string;
  /** Distinct organization ids appearing in this tenant's activity feed. */
  readonly organizationIdsInFeed: readonly string[];
}

export interface AdverseStep {
  readonly action:
    | "repository_removed"
    | "repository_readded"
    | "installation_suspended"
    | "installation_unsuspended"
    | "installation_uninstalled";
  /** Whether a signed webhook delivery for this action was recorded. */
  readonly deliveryRecorded: boolean;
  /** Whether that delivery reached a processed state rather than sitting queued. */
  readonly deliveryProcessed: boolean;
  /** Installation status after the action settled. */
  readonly installationStatus: string;
  /** Whether a write attempted after the action was refused. Null when not attempted. */
  readonly writeRefused: boolean | null;
}

export interface ResyncProbe {
  /** HTTP status returned by a resync of the uninstalled installation. */
  readonly status: number;
}

export interface LiveAcceptanceObservations {
  readonly primaryInstallation: InstallationObservation | null;
  readonly secondInstallation: InstallationObservation | null;
  readonly secondRepositories: readonly RepositoryObservation[] | null;
  readonly crossTenant: CrossTenantProbe | null;
  readonly activity: readonly ActivityProbe[] | null;
  readonly adverseSteps: readonly AdverseStep[] | null;
  readonly resync: ResyncProbe | null;
}

/** The order the adverse pass must be performed in, from the owner-action list. */
export const ADVERSE_SEQUENCE: readonly AdverseStep["action"][] = Object.freeze([
  "repository_removed",
  "repository_readded",
  "installation_suspended",
  "installation_unsuspended",
  "installation_uninstalled",
]);

/**
 * Installations that must never be used for this pass.
 *
 * The primary is the rollback boundary and the candidate is the verified
 * production path, so running a deliberate suspend/uninstall against either
 * would be destroying the thing the test exists to protect. Refusing by id is
 * blunt on purpose: a warning in a document is not a control.
 */
export const PROTECTED_INSTALLATION_IDS: readonly number[] = Object.freeze([
  153445938, 153479019,
]);

function check(
  id: string,
  item: 2 | 20,
  claim: string,
  observed: boolean | null,
  pass: string,
  fail: string,
): CheckResult {
  if (observed === null) {
    return { id, item, claim, status: "NOT_OBSERVED", detail: "No observation supplied." };
  }
  return {
    id,
    item,
    claim,
    status: observed ? "PASS" : "FAIL",
    detail: observed ? pass : fail,
  };
}

/**
 * Evaluate every condition items 2 and 20 depend on.
 *
 * A missing observation is `NOT_OBSERVED`, never `FAIL`. The distinction
 * matters more here than almost anywhere else in this repository: these items
 * have been open for days, and a harness that reported FAIL for "you have not
 * done this yet" would make an unperformed action indistinguishable from a
 * broken one.
 */
export function evaluateLiveAcceptance(
  observations: LiveAcceptanceObservations,
): readonly CheckResult[] {
  const results: CheckResult[] = [];
  const second = observations.secondInstallation;
  const primary = observations.primaryInstallation;

  results.push(
    check(
      "second-installation-is-independent",
      2,
      "A second installation exists on an account that is not the first tenant's.",
      second === null || primary === null
        ? null
        : second.externalInstallationId !== primary.externalInstallationId
          && second.accountLogin.toLowerCase() !== primary.accountLogin.toLowerCase()
          && second.connectionId !== primary.connectionId,
      `Installation ${second?.externalInstallationId} on ${second?.accountLogin}, connection ${second?.connectionId}.`,
      "The second installation shares its id, account login, or connection with the first.",
    ),
  );

  results.push(
    check(
      "second-installation-is-not-protected",
      2,
      "The pass is not being run against the primary or candidate installation.",
      second === null ? null : !PROTECTED_INSTALLATION_IDS.includes(second.externalInstallationId),
      `Installation ${second?.externalInstallationId} is not the rollback boundary or the production path.`,
      `Installation ${second?.externalInstallationId} is protected. Use a throwaway account; do not suspend or uninstall this one.`,
    ),
  );

  results.push(
    check(
      "second-repositories-are-scoped",
      2,
      "The second installation's repository list contains only its own selected repositories.",
      observations.secondRepositories === null || second === null
        ? null
        : observations.secondRepositories.length > 0
          && observations.secondRepositories.every(
            (repository) =>
              repository.installationId === second.connectionId
              || repository.installationId !== primary?.connectionId,
          )
          && observations.secondRepositories.every((repository) => repository.selected),
      `${observations.secondRepositories?.length ?? 0} repositories, all selected and bound to this installation.`,
      "The repository list is empty, unselected, or contains a repository from another installation.",
    ),
  );

  results.push(
    check(
      "first-tenant-sees-nothing",
      2,
      "The first tenant's owner sees no rows for the second installation.",
      observations.crossTenant === null
        ? null
        : observations.crossTenant.visibleInstallationRows === 0
          && observations.crossTenant.visibleRepositoryRows === 0,
      "Zero installation rows and zero repository rows across the tenant boundary.",
      `Leak: ${observations.crossTenant?.visibleInstallationRows} installation and ${observations.crossTenant?.visibleRepositoryRows} repository rows visible across tenants.`,
    ),
  );

  results.push(
    check(
      "first-tenant-cannot-write",
      2,
      "The first tenant's owner cannot reserve a change against the second tenant's repository.",
      observations.crossTenant === null ? null : observations.crossTenant.writeAttempt.refused,
      `Refused with SQLSTATE ${observations.crossTenant?.writeAttempt.sqlState ?? "unknown"}.`,
      "A cross-tenant change reservation succeeded. This is a containment failure, not a test failure.",
    ),
  );

  results.push(
    check(
      "activity-is-tenant-scoped",
      2,
      "Each tenant's activity feed shows only its own events.",
      observations.activity === null
        ? null
        : observations.activity.length >= 2
          && observations.activity.every(
            (probe) =>
              probe.organizationIdsInFeed.length <= 1
              && probe.organizationIdsInFeed.every((id) => id === probe.organizationId),
          ),
      "Both feeds contain only their own organization's events.",
      "An activity feed contained an event from another organization.",
    ),
  );

  const steps = observations.adverseSteps;
  results.push(
    check(
      "adverse-sequence-is-complete",
      20,
      "The adverse pass ran every action, in order.",
      steps === null
        ? null
        : steps.length === ADVERSE_SEQUENCE.length
          && steps.every((step, index) => step.action === ADVERSE_SEQUENCE[index]),
      `All ${ADVERSE_SEQUENCE.length} actions performed in order.`,
      `Expected ${ADVERSE_SEQUENCE.join(" → ")}; observed ${steps?.map((step) => step.action).join(" → ") ?? "nothing"}.`,
    ),
  );

  results.push(
    check(
      "every-action-delivered-a-webhook",
      20,
      "Every action produced a signed webhook delivery that was recorded and processed.",
      steps === null
        ? null
        : steps.length > 0 && steps.every((step) => step.deliveryRecorded && step.deliveryProcessed),
      "Every action has a recorded, processed delivery.",
      `Missing or unprocessed deliveries: ${steps?.filter((step) => !step.deliveryRecorded || !step.deliveryProcessed).map((step) => step.action).join(", ") ?? "unknown"}.`,
    ),
  );

  results.push(
    check(
      "loss-is-stated-truthfully",
      20,
      "Installation status matched each action rather than showing stale Connected.",
      steps === null
        ? null
        : steps.every((step) => {
            if (step.action === "installation_suspended") return step.installationStatus === "suspended";
            if (step.action === "installation_uninstalled") return step.installationStatus === "deleted";
            if (step.action === "installation_unsuspended") return step.installationStatus === "active";
            return step.installationStatus !== "deleted";
          }),
      "Every status matched the action that produced it.",
      "A status did not match its action — the surface would have reported a state that was no longer true.",
    ),
  );

  results.push(
    check(
      "writes-refused-after-loss",
      20,
      "A write attempted after access loss was refused.",
      steps === null
        ? null
        : steps
            .filter((step) =>
              step.action === "installation_suspended" || step.action === "installation_uninstalled")
            .every((step) => step.writeRefused === true),
      "Writes were refused after suspension and after uninstall.",
      "A write succeeded after access was lost.",
    ),
  );

  results.push(
    check(
      "resync-of-terminal-installation-is-409",
      20,
      "Resyncing the uninstalled installation returns 409, not 500.",
      observations.resync === null ? null : observations.resync.status === 409,
      "Resync returned 409 with its real reason.",
      `Resync returned ${observations.resync?.status}. A 500 here is the generic-refusal defect returning.`,
    ),
  );

  return Object.freeze(results);
}

export interface AcceptanceVerdict {
  readonly item2: CheckStatus;
  readonly item20: CheckStatus;
  readonly results: readonly CheckResult[];
  /** True only when every check for both items passed. */
  readonly closesPhase1b: boolean;
}

/** Roll the checks up per item. Any FAIL dominates; otherwise any missing observation does. */
export function summarize(results: readonly CheckResult[]): AcceptanceVerdict {
  const rollUp = (item: 2 | 20): CheckStatus => {
    const forItem = results.filter((result) => result.item === item);
    if (forItem.some((result) => result.status === "FAIL")) return "FAIL";
    if (forItem.some((result) => result.status === "NOT_OBSERVED")) return "NOT_OBSERVED";
    return "PASS";
  };

  const item2 = rollUp(2);
  const item20 = rollUp(20);
  return Object.freeze({
    item2,
    item20,
    results,
    closesPhase1b: item2 === "PASS" && item20 === "PASS",
  });
}

/** A report for a terminal, ordered so failures are read first. */
export function formatVerdict(verdict: AcceptanceVerdict): string {
  const order: Record<CheckStatus, number> = { FAIL: 0, NOT_OBSERVED: 1, PASS: 2 };
  const lines = [...verdict.results]
    .sort((a, b) => order[a.status] - order[b.status] || a.id.localeCompare(b.id))
    .map((result) => `  [${result.status}] item ${result.item} · ${result.id}\n      ${result.detail}`);

  return [
    `Phase 1B item 2:  ${verdict.item2}`,
    `Phase 1B item 20: ${verdict.item20}`,
    "",
    ...lines,
    "",
    verdict.closesPhase1b
      ? "Both items pass. Phase 1B reaches 20/20 — update AI/PHASE_1B_COMPLETION.md."
      : "Phase 1B stays at 18/20. Nothing above is a code defect unless it reads FAIL.",
  ].join("\n");
}
