// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  ADVERSE_SEQUENCE,
  PROTECTED_INSTALLATION_IDS,
  evaluateLiveAcceptance,
  formatVerdict,
  summarize,
  type AdverseStep,
  type LiveAcceptanceObservations,
} from "@/lib/github/live-acceptance";

/**
 * The rules for closing Phase 1B items 2 and 20, proven without the second
 * GitHub account that those items are waiting on.
 *
 * That separation is the point of the module: the owner performs two console
 * actions this environment cannot perform, and everything *else* — what counts
 * as proof, what counts as a leak, what a missing observation means — is
 * decided here and tested now, so closing the items later is running a command
 * rather than making a judgement call at the end of a long session.
 */

const primary = {
  accountLogin: "surgeservicesllc",
  connectionId: "conn-1",
  externalInstallationId: 153445938,
  organizationId: "org-1",
  status: "active",
  suspendedAt: null,
};

const second = {
  accountLogin: "throwaway-acct",
  connectionId: "conn-2",
  externalInstallationId: 900000001,
  organizationId: "org-2",
  status: "active",
  suspendedAt: null,
};

function adversePass(overrides: Partial<Record<AdverseStep["action"], Partial<AdverseStep>>> = {}) {
  return ADVERSE_SEQUENCE.map((action): AdverseStep => ({
    action,
    deliveryProcessed: true,
    deliveryRecorded: true,
    installationStatus:
      action === "installation_suspended"
        ? "suspended"
        : action === "installation_uninstalled"
          ? "deleted"
          : "active",
    writeRefused:
      action === "installation_suspended" || action === "installation_uninstalled" ? true : null,
    ...overrides[action],
  }));
}

function complete(): LiveAcceptanceObservations {
  return {
    activity: [
      { organizationId: "org-1", organizationIdsInFeed: ["org-1"] },
      { organizationId: "org-2", organizationIdsInFeed: ["org-2"] },
    ],
    adverseSteps: adversePass(),
    crossTenant: {
      visibleInstallationRows: 0,
      visibleRepositoryRows: 0,
      writeAttempt: { refused: true, sqlState: "23514" },
    },
    primaryInstallation: primary,
    resync: { status: 409 },
    secondInstallation: second,
    secondRepositories: [
      { fullName: "throwaway-acct/scratch", installationId: "conn-2", selected: true },
    ],
  };
}

describe("Phase 1B live acceptance", () => {
  it("closes both items when every condition is observed and holds", () => {
    const verdict = summarize(evaluateLiveAcceptance(complete()));

    expect(verdict.item2).toBe("PASS");
    expect(verdict.item20).toBe("PASS");
    expect(verdict.closesPhase1b).toBe(true);
  });

  it("reports nothing observed rather than failing, when the owner has not acted yet", () => {
    const verdict = summarize(
      evaluateLiveAcceptance({
        activity: null,
        adverseSteps: null,
        crossTenant: null,
        primaryInstallation: primary,
        resync: null,
        secondInstallation: null,
        secondRepositories: null,
      }),
    );

    // This is the distinction the module exists to preserve. These items have
    // been open for days; a harness that said FAIL for "not done yet" would
    // make an unperformed action look identical to a broken one, and the next
    // reader would go hunting for a defect that is not there.
    expect(verdict.item2).toBe("NOT_OBSERVED");
    expect(verdict.item20).toBe("NOT_OBSERVED");
    expect(verdict.closesPhase1b).toBe(false);
    expect(verdict.results.every((result) => result.status !== "FAIL")).toBe(true);
    expect(formatVerdict(verdict)).toContain("Phase 1B stays at 18/20");
  });

  it("refuses a pass run against the rollback boundary or the production path", () => {
    for (const protectedId of PROTECTED_INSTALLATION_IDS) {
      const verdict = summarize(
        evaluateLiveAcceptance({
          ...complete(),
          secondInstallation: { ...second, externalInstallationId: protectedId },
        }),
      );

      // The completion document warns about this in prose. A warning is not a
      // control: suspending the verified production path to prove that
      // suspension is detected would destroy the thing the proof protects.
      const refusal = verdict.results.find(
        (result) => result.id === "second-installation-is-not-protected",
      );
      expect(refusal?.status).toBe("FAIL");
      expect(refusal?.detail).toContain("do not suspend or uninstall");
      expect(verdict.closesPhase1b).toBe(false);
    }
  });

  it("fails item 2 when the first tenant can see anything of the second", () => {
    const verdict = summarize(
      evaluateLiveAcceptance({
        ...complete(),
        crossTenant: {
          visibleInstallationRows: 0,
          // One repository row is enough. Containment is not a proportion.
          visibleRepositoryRows: 1,
          writeAttempt: { refused: true, sqlState: "23514" },
        },
      }),
    );

    expect(verdict.item2).toBe("FAIL");
    const leak = verdict.results.find((result) => result.id === "first-tenant-sees-nothing");
    expect(leak?.detail).toContain("Leak");
  });

  it("calls a successful cross-tenant write a containment failure, not a test failure", () => {
    const verdict = summarize(
      evaluateLiveAcceptance({
        ...complete(),
        crossTenant: {
          visibleInstallationRows: 0,
          visibleRepositoryRows: 0,
          writeAttempt: { refused: false, sqlState: null },
        },
      }),
    );

    const write = verdict.results.find((result) => result.id === "first-tenant-cannot-write");
    expect(write?.status).toBe("FAIL");
    expect(write?.detail).toContain("containment failure");
  });

  it("fails when a status stays Connected through an action that removed access", () => {
    const verdict = summarize(
      evaluateLiveAcceptance({
        ...complete(),
        adverseSteps: adversePass({
          installation_suspended: { installationStatus: "active" },
        }),
      }),
    );

    const truthful = verdict.results.find((result) => result.id === "loss-is-stated-truthfully");
    expect(truthful?.status).toBe("FAIL");
    expect(verdict.item20).toBe("FAIL");
  });

  it("fails when a write succeeds after access was lost", () => {
    const verdict = summarize(
      evaluateLiveAcceptance({
        ...complete(),
        adverseSteps: adversePass({
          installation_uninstalled: { writeRefused: false },
        }),
      }),
    );

    expect(
      verdict.results.find((result) => result.id === "writes-refused-after-loss")?.status,
    ).toBe("FAIL");
  });

  it("fails when a webhook for an action was never processed", () => {
    const verdict = summarize(
      evaluateLiveAcceptance({
        ...complete(),
        adverseSteps: adversePass({
          repository_readded: { deliveryProcessed: false },
        }),
      }),
    );

    const deliveries = verdict.results.find(
      (result) => result.id === "every-action-delivered-a-webhook",
    );
    expect(deliveries?.status).toBe("FAIL");
    // Naming the step matters: "a delivery is missing" sends someone through
    // five actions looking for it.
    expect(deliveries?.detail).toContain("repository_readded");
  });

  it("fails when the actions were run out of order", () => {
    const inOrder = adversePass();
    const verdict = summarize(
      evaluateLiveAcceptance({
        ...complete(),
        // Suspending before removing the repository tests a different thing:
        // the removal would be observed against an already-suspended
        // installation, which is not the transition item 20 asks for.
        adverseSteps: [inOrder[2], inOrder[0], inOrder[1], inOrder[3], inOrder[4]],
      }),
    );

    const sequence = verdict.results.find(
      (result) => result.id === "adverse-sequence-is-complete",
    );
    expect(sequence?.status).toBe("FAIL");
    expect(sequence?.detail).toContain("Expected");
  });

  it("treats a 500 on resync as the generic-refusal defect returning", () => {
    const verdict = summarize(
      evaluateLiveAcceptance({ ...complete(), resync: { status: 500 } }),
    );

    const resync = verdict.results.find(
      (result) => result.id === "resync-of-terminal-installation-is-409",
    );
    expect(resync?.status).toBe("FAIL");
    expect(resync?.detail).toContain("generic-refusal defect");
  });

  it("puts failures first in the report, so the terminal reads worst-first", () => {
    const verdict = summarize(
      evaluateLiveAcceptance({
        ...complete(),
        resync: { status: 500 },
      }),
    );

    const report = formatVerdict(verdict);
    expect(report.indexOf("[FAIL]")).toBeLessThan(report.indexOf("[PASS]"));
    expect(report).toContain("Phase 1B stays at 18/20");
  });
});
