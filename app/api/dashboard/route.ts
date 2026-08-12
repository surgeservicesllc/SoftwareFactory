import {
  buildOwnerAttention,
  summarizeEngineering,
  summarizePortfolio,
  summarizeWorkforce,
  type ProjectSnapshot,
  type RunSnapshot,
  type TaskSnapshot,
} from "@/lib/dashboard/metrics";
import { describeProviders } from "@/lib/providers/registry";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { rows, withTenant } from "@/lib/server/tenant-route";
import { isWorkerTickConfigured } from "@/lib/worker/tick";

export const runtime = "nodejs";

const WINDOW_DAYS = 30;

type ProjectRow = {
  id: string;
  status: string;
  health_status: string;
  github_repository: string | null;
  project_connections: Array<{ connection_id: string; is_primary: boolean }> | null;
};

type RunRow = { status: string; failure_kind: string | null; created_at: string };
type TaskRow = { status: string; risk_level: string; requires_owner_approval: boolean; source: string };
type PullRequestRow = { status: string };
type TestRunRow = { passed_count: number };
type ResultRow = { security_findings: unknown };
type DeploymentRow = { status: string; rollback_of_deployment_id: string | null };

export async function GET() {
  return withTenant(
    async ({ activeOrganization, client }) => {
      const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

      const [
        projectsResult,
        connectionsResult,
        agentsResult,
        runsResult,
        tasksResult,
        pullRequestsResult,
        testRunsResult,
        resultsResult,
        deploymentsResult,
        incidentsResult,
        approvalsResult,
        settingsResult,
      ] = await Promise.all([
        client
          .from("projects")
          .select("id,status,health_status,github_repository,project_connections(connection_id,is_primary)")
          .eq("organization_id", activeOrganization.id)
          .limit(200),
        client
          .from("connections")
          .select("id,provider,status")
          .eq("organization_id", activeOrganization.id)
          .limit(100),
        client
          .from("agents")
          .select("id,enabled")
          .eq("organization_id", activeOrganization.id)
          .limit(200),
        client
          .from("agent_runs")
          .select("status,failure_kind,created_at")
          .eq("organization_id", activeOrganization.id)
          .gte("created_at", since)
          .limit(500),
        client
          .from("tasks")
          .select("status,risk_level,requires_owner_approval,source")
          .eq("organization_id", activeOrganization.id)
          .limit(500),
        client
          .from("pull_requests")
          .select("status")
          .eq("organization_id", activeOrganization.id)
          .gte("created_at", since)
          .limit(500),
        client
          .from("test_runs")
          .select("passed_count")
          .eq("organization_id", activeOrganization.id)
          .gte("created_at", since)
          .limit(500),
        client
          .from("run_results")
          .select("security_findings")
          .eq("organization_id", activeOrganization.id)
          .gte("created_at", since)
          .limit(500),
        client
          .from("deployments")
          .select("status,rollback_of_deployment_id")
          .eq("organization_id", activeOrganization.id)
          .gte("created_at", since)
          .limit(500),
        client
          .from("incidents")
          .select("id,status")
          .eq("organization_id", activeOrganization.id)
          .in("status", ["open", "investigating"])
          .limit(200),
        client
          .from("approvals")
          .select("id,status")
          .eq("organization_id", activeOrganization.id)
          .eq("status", "pending")
          .limit(200),
        client.rpc("get_organization_settings", { p_organization_id: activeOrganization.id }).single(),
      ]);

      const firstError = [
        projectsResult.error,
        connectionsResult.error,
        agentsResult.error,
        runsResult.error,
        tasksResult.error,
      ].find(Boolean);
      if (firstError) return databaseErrorResponse(firstError);

      const connectedConnectionIds = new Set(
        rows<{ id: string; provider: string; status: string }>(connectionsResult.data)
          .filter((connection) => connection.provider === "github" && connection.status === "connected")
          .map((connection) => connection.id),
      );

      const projects: ProjectSnapshot[] = rows<ProjectRow>(projectsResult.data).map((project) => ({
        id: project.id,
        status: project.status,
        healthStatus: project.health_status,
        connected: Boolean(
          project.github_repository
          && project.project_connections?.some(
            (link) => link.is_primary && connectedConnectionIds.has(link.connection_id),
          ),
        ),
      }));

      const runs: RunSnapshot[] = rows<RunRow>(runsResult.data).map((run) => ({
        status: run.status,
        failureKind: run.failure_kind,
        createdAt: run.created_at,
      }));
      const tasks: TaskSnapshot[] = rows<TaskRow>(tasksResult.data).map((task) => ({
        status: task.status,
        riskLevel: task.risk_level,
        requiresOwnerApproval: task.requires_owner_approval,
        source: task.source,
      }));

      const securityFindings = rows<ResultRow>(resultsResult.data).reduce(
        (total, result) => total + (Array.isArray(result.security_findings) ? result.security_findings.length : 0),
        0,
      );
      const testsPassed = rows<TestRunRow>(testRunsResult.data).reduce(
        (total, testRun) => total + (testRun.passed_count ?? 0),
        0,
      );
      const deployments = rows<DeploymentRow>(deploymentsResult.data);

      const portfolio = summarizePortfolio(projects);
      const workforce = summarizeWorkforce(
        rows<{ enabled: boolean }>(agentsResult.data),
        runs,
      );
      const engineering = summarizeEngineering({
        tasks,
        pullRequests: rows<PullRequestRow>(pullRequestsResult.data),
        runs,
        testsPassed,
        securityFindings,
      });

      const providers = describeProviders();
      const settings = settingsResult.data as { execution_enabled?: boolean } | null;
      const configurationGaps: string[] = [];
      if (!providers.implemented.some((provider) => provider.status.state !== "not_connected")) {
        configurationGaps.push(
          "No worker provider is connected, so no command can execute. Add a server-only OPENAI_API_KEY.",
        );
      }
      if (!isWorkerTickConfigured()) {
        configurationGaps.push(
          "No worker tick credential is configured, so queued runs will never be picked up.",
        );
      }
      if (!settings?.execution_enabled) {
        configurationGaps.push(
          "Commanded execution is OFF for this organization. An owner can enable it in Settings.",
        );
      }

      const ownerAttention = buildOwnerAttention({
        pendingApprovals: (approvalsResult.data ?? []).length,
        failedRuns: workforce.failedRuns,
        securityFindings,
        disconnectedProjects: portfolio.disconnected,
        ciFailures: engineering.ciFailures,
        openIncidents: (incidentsResult.data ?? []).length,
        configurationGaps,
      });

      return jsonNoStore({
        activeOrganizationId: activeOrganization.id,
        windowDays: WINDOW_DAYS,
        portfolio,
        workforce,
        engineering,
        production: {
          // Deployment telemetry only exists once a deployment adapter records
          // it. There is none in this phase, so this is reported as unavailable
          // rather than as a confident zero.
          availability: deployments.length > 0 ? ("live" as const) : ("unavailable" as const),
          deployments: deployments.length,
          deploymentFailures: deployments.filter((deployment) => deployment.status === "failed").length,
          rollbacks: deployments.filter((deployment) => deployment.rollback_of_deployment_id !== null).length,
          openIncidents: (incidentsResult.data ?? []).length,
        },
        ownerAttention,
        executionEnabled: Boolean(settings?.execution_enabled),
      });
    },
    { code: "dashboard_unavailable", message: "Dashboard metrics could not be loaded." },
  );
}
