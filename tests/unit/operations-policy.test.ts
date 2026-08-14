import { describe, expect, it } from "vitest";

import { buildEventDedupeKey, buildIncidentFingerprint } from "@/lib/operations/fingerprint";
import { deriveProjectHealth, compareHealth, healthTone } from "@/lib/operations/health";
import { investigateProductionIncident } from "@/lib/operations/investigator";
import { MONITOR_PROVIDERS, connectedProviderIds, findMonitorProvider } from "@/lib/operations/providers";
import {
  MAX_REPAIR_ATTEMPTS,
  PHASE_1E_REPAIR_WORKER_CONNECTED,
  evaluateRepairEligibility,
} from "@/lib/operations/repair";
import {
  MAX_ROLLBACK_ATTEMPTS,
  PHASE_1E_ROLLBACK_EXECUTOR_CONNECTED,
  evaluateRollbackEligibility,
} from "@/lib/operations/rollback";
import { classifyIncidentSeverity, mostSevere, severityRequiresFreeze } from "@/lib/operations/severity";
import { validateSyntheticJourney } from "@/lib/operations/synthetic";
import { validateMonitorTarget } from "@/lib/operations/target";
import { OPERATIONS_EVENT_PLAN, plannedActions } from "@/lib/operations/events";

const healthySignals = {
  projectPaused: false,
  operationsStopped: false,
  connectedMonitors: 2,
  failingMonitors: 0,
  degradedMonitors: 0,
  openSev1: 0,
  openSev2: 0,
  openLowerSeverity: 0,
  failedDeployments24h: 0,
};

describe("severity classification", () => {
  it("treats total production unavailability as SEV1", () => {
    const result = classifyIncidentSeverity({
      signalKind: "uptime",
      productionUnavailable: true,
      affectsAllUsers: true,
      deploymentAttributed: false,
      consecutiveFailures: 2,
    });
    expect(result.severity).toBe("sev1");
  });

  it("treats partial unavailability and auth or database faults as SEV2", () => {
    expect(
      classifyIncidentSeverity({
        signalKind: "critical_route",
        productionUnavailable: true,
        affectsAllUsers: false,
        deploymentAttributed: false,
        consecutiveFailures: 1,
      }).severity,
    ).toBe("sev2");

    expect(
      classifyIncidentSeverity({
        signalKind: "authentication",
        productionUnavailable: false,
        affectsAllUsers: false,
        deploymentAttributed: false,
        consecutiveFailures: 1,
      }).severity,
    ).toBe("sev2");
  });

  it("escalates a repeatedly failing deployment-attributed signal", () => {
    expect(
      classifyIncidentSeverity({
        signalKind: "latency",
        productionUnavailable: false,
        affectsAllUsers: false,
        deploymentAttributed: true,
        consecutiveFailures: 2,
      }).severity,
    ).toBe("sev2");
  });

  it("keeps a non-blocking degraded signal at SEV4", () => {
    expect(
      classifyIncidentSeverity({
        signalKind: "latency",
        productionUnavailable: false,
        affectsAllUsers: false,
        deploymentAttributed: false,
        consecutiveFailures: 1,
      }).severity,
    ).toBe("sev4");
  });

  it("never lets a weaker repeat signal downgrade an active incident", () => {
    expect(mostSevere("sev1", "sev4")).toBe("sev1");
    expect(mostSevere("sev3", "sev2")).toBe("sev2");
  });

  it("freezes releases for SEV1 and SEV2 only", () => {
    expect(severityRequiresFreeze("sev1")).toBe(true);
    expect(severityRequiresFreeze("sev2")).toBe(true);
    expect(severityRequiresFreeze("sev3")).toBe(false);
  });
});

describe("incident fingerprints", () => {
  it("produces the same identity for the same failing thing", () => {
    const first = buildIncidentFingerprint({ signalKind: "uptime", subject: "monitor-1", detail: "status-500" });
    const second = buildIncidentFingerprint({ signalKind: "uptime", subject: "monitor-1", detail: "status-500" });
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-z0-9]([a-z0-9:._-]{6,126})[a-z0-9]$/);
  });

  it("separates different failing things", () => {
    expect(buildIncidentFingerprint({ signalKind: "uptime", subject: "monitor-1", detail: "status-500" }))
      .not.toBe(buildIncidentFingerprint({ signalKind: "uptime", subject: "monitor-2", detail: "status-500" }));
  });

  it("refuses to produce an identity it cannot make stable", () => {
    expect(buildIncidentFingerprint({ signalKind: "uptime", subject: "" })).toBeNull();
    expect(buildIncidentFingerprint({ signalKind: "uptime", subject: "!!" })).toBeNull();
  });

  it("builds a bounded dedupe key for the event queue", () => {
    expect(buildEventDedupeKey("incident.created", "abc", 2)).toBe("incident.created:abc:2");
    expect(buildEventDedupeKey("incident.created", "x".repeat(400)).length).toBeLessThanOrEqual(200);
  });
});

describe("project health derivation", () => {
  it("reports UNKNOWN rather than HEALTHY when nothing is being observed", () => {
    const result = deriveProjectHealth({ ...healthySignals, connectedMonitors: 0 });
    expect(result.state).toBe("unknown");
    expect(result.reason).toMatch(/cannot be evidenced/i);
  });

  it("reports CRITICAL for a failing monitor or an open SEV1", () => {
    expect(deriveProjectHealth({ ...healthySignals, failingMonitors: 1 }).state).toBe("critical");
    expect(deriveProjectHealth({ ...healthySignals, openSev1: 1 }).state).toBe("critical");
  });

  it("reports DEGRADED for SEV2, degraded monitors, or recent failed deployments", () => {
    expect(deriveProjectHealth({ ...healthySignals, openSev2: 1 }).state).toBe("degraded");
    expect(deriveProjectHealth({ ...healthySignals, degradedMonitors: 1 }).state).toBe("degraded");
    expect(deriveProjectHealth({ ...healthySignals, failedDeployments24h: 1 }).state).toBe("degraded");
  });

  it("reports PAUSED when the owner stopped operations, ahead of every other state", () => {
    const result = deriveProjectHealth({ ...healthySignals, operationsStopped: true, failingMonitors: 3, openSev1: 2 });
    expect(result.state).toBe("paused");
  });

  it("reports HEALTHY only with connected monitors and nothing open", () => {
    const result = deriveProjectHealth(healthySignals);
    expect(result.state).toBe("healthy");
    expect(result.reasons.find((reason) => reason.code === "connected_monitors")?.value).toBe(2);
  });

  it("sorts worst first and maps each state to a distinct tone", () => {
    const ordered = (["healthy", "unknown", "critical", "degraded", "paused"] as const)
      .slice()
      .sort(compareHealth);
    expect(ordered[0]).toBe("critical");
    expect(healthTone("critical")).toBe("danger");
    expect(healthTone("degraded")).toBe("warning");
    expect(healthTone("healthy")).toBe("safe");
    expect(healthTone("unknown")).toBe("neutral");
  });
});

describe("rollback eligibility", () => {
  const perfectConditions = {
    severity: "sev1" as const,
    ownerApproved: true,
    lastKnownGoodDeploymentId: "deployment-1",
    lastKnownGoodValidationPassed: true,
    failingDeploymentId: "deployment-2",
    deploymentsInFlight: 1,
    rootCauseConfident: true,
    releaseContainedIrreversibleChange: false,
    databaseCompatibilityConfirmed: true,
    telemetryFresh: true,
    priorAttempts: 0,
    operationsStopped: false,
    executorConnected: true,
  };

  it("is blocked in this phase because no executor is connected", () => {
    expect(PHASE_1E_ROLLBACK_EXECUTOR_CONNECTED).toBe(false);
    const result = evaluateRollbackEligibility({ ...perfectConditions, executorConnected: false });
    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain("EXECUTOR_NOT_CONNECTED");
    expect(result.primaryBlocker).toBe("EXECUTOR_NOT_CONNECTED");
  });

  it("would be eligible only when every policy condition holds", () => {
    expect(evaluateRollbackEligibility(perfectConditions).eligible).toBe(true);
  });

  it("blocks on each individual policy failure", () => {
    const cases = [
      [{ ownerApproved: false }, "OWNER_APPROVAL_REQUIRED"],
      [{ lastKnownGoodDeploymentId: null }, "NO_LAST_KNOWN_GOOD"],
      [{ lastKnownGoodValidationPassed: false }, "LAST_KNOWN_GOOD_NOT_VALIDATED"],
      [{ failingDeploymentId: null }, "DEPLOYMENT_IDENTITY_AMBIGUOUS"],
      [{ deploymentsInFlight: 2 }, "MULTIPLE_DEPLOYMENTS_IN_FLIGHT"],
      [{ rootCauseConfident: false }, "ROOT_CAUSE_AMBIGUOUS"],
      [{ releaseContainedIrreversibleChange: true }, "IRREVERSIBLE_CHANGE_IN_RELEASE"],
      [{ databaseCompatibilityConfirmed: false }, "DATABASE_COMPATIBILITY_UNCERTAIN"],
      [{ telemetryFresh: false }, "TELEMETRY_STALE_OR_UNAVAILABLE"],
      [{ severity: "sev3" as const }, "SEVERITY_BELOW_THRESHOLD"],
      [{ priorAttempts: MAX_ROLLBACK_ATTEMPTS }, "ATTEMPT_LIMIT_REACHED"],
      [{ operationsStopped: true }, "OWNER_STOPPED_OPERATIONS"],
    ] as const;

    for (const [override, expectedBlocker] of cases) {
      const result = evaluateRollbackEligibility({ ...perfectConditions, ...override });
      expect(result.eligible, `${expectedBlocker} should block`).toBe(false);
      expect(result.blockers).toContain(expectedBlocker);
    }
  });
});

describe("repair eligibility", () => {
  const base = {
    severity: "sev2" as const,
    hasDiagnosis: true,
    confidence: "high" as const,
    risk: "YELLOW" as const,
    maximumAutonomousRisk: "YELLOW" as const,
    priorAttempts: 0,
    ownerApproved: false,
    operationsStopped: false,
    workerConnected: true,
  };

  it("cannot execute in this phase because no worker is connected", () => {
    expect(PHASE_1E_REPAIR_WORKER_CONNECTED).toBe(false);
    const result = evaluateRepairEligibility({ ...base, workerConnected: false });
    expect(result.executable).toBe(false);
    expect(result.blockers).toContain("WORKER_NOT_CONNECTED");
    // Work is still worth creating for a person to pick up.
    expect(result.workCreatable).toBe(true);
  });

  it("never lets a RED repair through without owner approval", () => {
    const result = evaluateRepairEligibility({
      ...base,
      risk: "RED",
      maximumAutonomousRisk: "RED",
      ownerApproved: false,
    });
    expect(result.executable).toBe(false);
    expect(result.blockers).toContain("RED_REQUIRES_OWNER_APPROVAL");
  });

  it("refuses work above the project risk ceiling", () => {
    const result = evaluateRepairEligibility({ ...base, risk: "YELLOW", maximumAutonomousRisk: "GREEN" });
    expect(result.blockers).toContain("ABOVE_RISK_CEILING");
  });

  it("refuses to act on a low-confidence diagnosis", () => {
    expect(evaluateRepairEligibility({ ...base, confidence: "low" }).blockers).toContain("CONFIDENCE_TOO_LOW");
    expect(evaluateRepairEligibility({ ...base, confidence: null }).blockers).toContain("CONFIDENCE_TOO_LOW");
  });

  it("stops creating work once attempts are exhausted and escalates", () => {
    const result = evaluateRepairEligibility({ ...base, priorAttempts: MAX_REPAIR_ATTEMPTS });
    expect(result.workCreatable).toBe(false);
    expect(result.escalateToOwner).toBe(true);
  });

  it("always escalates a SEV1 to the owner", () => {
    expect(evaluateRepairEligibility({ ...base, severity: "sev1" }).escalateToOwner).toBe(true);
  });
});

describe("production investigator", () => {
  const base = {
    signalKind: "uptime" as const,
    occurrenceCount: 4,
    failingMonitorNames: ["Production health"],
    minutesSinceDeployment: 5,
    deploymentReference: "dpl_123",
    commitSha: "abcdef1",
    pullRequestReference: "#42",
    recentChangePaths: ["app/api/health/route.ts"],
    failedTestNames: ["health contract"],
    errorSamples: ["500 Internal Server Error"],
    previousDeploymentHealthy: true,
  };

  it("reaches high confidence only with corroborating evidence", () => {
    expect(investigateProductionIncident(base).confidence).toBe("high");
  });

  it("stays low confidence for an isolated signal with no release correlation", () => {
    const result = investigateProductionIncident({
      ...base,
      minutesSinceDeployment: null,
      deploymentReference: null,
      occurrenceCount: 1,
      failedTestNames: [],
      recentChangePaths: [],
    });
    expect(result.confidence).toBe("low");
    expect(result.recommendedAction).toMatch(/gather more evidence/i);
  });

  it("classifies a migration or auth change as RED", () => {
    expect(
      investigateProductionIncident({ ...base, recentChangePaths: ["supabase/migrations/001_x.sql"] }).risk,
    ).toBe("RED");
    expect(investigateProductionIncident({ ...base, signalKind: "authentication" }).risk).toBe("RED");
  });

  it("cites the evidence it used and names its analyzer", () => {
    const result = investigateProductionIncident(base);
    expect(result.analyzer).toBe("rules-engine-v1");
    expect(result.evidence.map((item) => item.kind)).toContain("deployment");
    expect(result.evidence.map((item) => item.kind)).toContain("failed_test");
    // Only conclusions and cited evidence are returned; there is no reasoning field.
    expect(Object.keys(result)).not.toContain("reasoning");
    expect(Object.keys(result)).not.toContain("thoughts");
  });

  it("attributes the subsystem from the failing signal and the changed paths", () => {
    expect(investigateProductionIncident({ ...base, signalKind: "database" }).affectedSubsystem).toBe("database");
    expect(
      investigateProductionIncident({ ...base, recentChangePaths: ["app/api/users/route.ts"] }).affectedSubsystem,
    ).toBe("api");
  });
});

describe("synthetic journeys", () => {
  const shell = {
    kind: "app_shell" as const,
    name: "Home",
    path: "/",
    method: "GET" as const,
    expectedStatus: 200,
  };

  it("accepts a basic journey that only reads", () => {
    expect(validateSyntheticJourney({ profile: "basic", steps: [shell] }).valid).toBe(true);
  });

  it("rejects a destructive path outright", () => {
    const result = validateSyntheticJourney({
      profile: "basic",
      steps: [shell, { ...shell, name: "Purge", path: "/api/account/delete" }],
    });
    expect(result.valid).toBe(false);
    expect(result.rejections.map((rejection) => rejection.code)).toContain("DESTRUCTIVE_PATH");
  });

  it("rejects an undeclared write", () => {
    const result = validateSyntheticJourney({
      profile: "basic",
      steps: [shell, { ...shell, kind: "api", name: "Create", path: "/api/things", method: "POST" }],
    });
    expect(result.rejections.map((rejection) => rejection.code)).toContain("DESTRUCTIVE_METHOD");
  });

  it("requires a safe write to explain how it leaves no residue", () => {
    const result = validateSyntheticJourney({
      profile: "basic",
      steps: [shell, { ...shell, kind: "safe_write", name: "Ping", path: "/api/heartbeat", method: "POST" }],
    });
    expect(result.rejections.map((rejection) => rejection.code)).toContain("SAFE_WRITE_WITHOUT_REVERSAL");
  });

  it("enforces the coverage each profile promises", () => {
    const result = validateSyntheticJourney({ profile: "critical", steps: [shell] });
    expect(result.valid).toBe(false);
    expect(result.rejections.map((rejection) => rejection.code)).toContain("PROFILE_REQUIRES_MORE_COVERAGE");
  });

  it("rejects an empty journey", () => {
    expect(validateSyntheticJourney({ profile: "basic", steps: [] }).valid).toBe(false);
  });
});

describe("monitor targets", () => {
  it("accepts a public HTTPS origin", () => {
    expect(validateMonitorTarget("https://example.com/health").valid).toBe(true);
  });

  it("rejects anything that is not public HTTPS", () => {
    const cases: [string, string][] = [
      ["http://example.com", "NOT_HTTPS"],
      ["https://user:pass@example.com", "CREDENTIALS_IN_URL"],
      ["https://localhost/health", "PRIVATE_OR_LOOPBACK_HOST"],
      ["https://127.0.0.1/health", "PRIVATE_OR_LOOPBACK_HOST"],
      ["https://10.0.0.5/health", "PRIVATE_OR_LOOPBACK_HOST"],
      ["https://192.168.1.1/health", "PRIVATE_OR_LOOPBACK_HOST"],
      ["https://172.16.0.1/health", "PRIVATE_OR_LOOPBACK_HOST"],
      ["https://169.254.169.254/latest/meta-data", "PRIVATE_OR_LOOPBACK_HOST"],
      ["https://service.internal/health", "PRIVATE_OR_LOOPBACK_HOST"],
      ["https://example.com:8443/health", "NON_STANDARD_PORT"],
      ["not-a-url", "INVALID_URL"],
    ];

    for (const [url, expected] of cases) {
      const result = validateMonitorTarget(url);
      expect(result.valid, `${url} should be rejected`).toBe(false);
      expect(result.rejection).toBe(expected);
    }
  });

  it("accepts a routable public address that merely looks numeric", () => {
    expect(validateMonitorTarget("https://93.184.216.34/health").valid).toBe(true);
  });
});

describe("monitoring providers", () => {
  it("connects exactly one adapter and explains every other one", () => {
    expect(connectedProviderIds()).toEqual(["http"]);
    for (const provider of MONITOR_PROVIDERS) {
      if (provider.connected) {
        expect(provider.unavailableReason).toBeNull();
      } else {
        expect(provider.unavailableReason, `${provider.id} needs a reason`).toBeTruthy();
        expect(provider.unblockedBy, `${provider.id} needs an unblocking condition`).toBeTruthy();
      }
    }
  });

  it("finds a provider by id", () => {
    expect(findMonitorProvider("vercel")?.connected).toBe(false);
    expect(findMonitorProvider("nope")).toBeUndefined();
  });
});

describe("event orchestration plan", () => {
  it("declares a plan for every event type the database accepts", () => {
    const eventTypes = Object.keys(OPERATIONS_EVENT_PLAN);
    expect(eventTypes).toHaveLength(10);
    for (const eventType of eventTypes) {
      expect(plannedActions(eventType as keyof typeof OPERATIONS_EVENT_PLAN).length).toBeGreaterThan(0);
    }
  });

  it("marks every execution action as not implemented in this phase", () => {
    const executionActions = Object.values(OPERATIONS_EVENT_PLAN)
      .flat()
      .filter((action) => action.action.startsWith("execute_"));
    expect(executionActions.length).toBeGreaterThan(0);
    expect(executionActions.every((action) => !action.implemented)).toBe(true);
  });
});
