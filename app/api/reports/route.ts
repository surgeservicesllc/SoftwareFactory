import { z } from "zod";

import { generateCeoReport } from "@/lib/reports/ceo-reporter";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { invalidRequest, rows, withTenant } from "@/lib/server/tenant-route";

export const runtime = "nodejs";

const querySchema = z
  .object({
    projectId: z.string().uuid().optional(),
    days: z.coerce.number().int().min(1).max(90).default(1),
  })
  .strict();

type RunRow = {
  status: string;
  failure_kind: string | null;
  project_id: string;
  tasks: unknown;
};

/**
 * Reports are computed from tenant records on read rather than stored as
 * narrative. Every number traces back to a row a reviewer can open.
 */
export async function GET(request: Request) {
  return withTenant(
    async ({ activeOrganization, client }) => {
      const url = new URL(request.url);
      const parsed = querySchema.safeParse(
        Object.fromEntries(
          (["projectId", "days"] as const)
            .map((key) => [key, url.searchParams.get(key) ?? undefined])
            .filter(([, value]) => value !== undefined),
        ),
      );
      if (!parsed.success) return invalidRequest("invalid_report_query", "The report query is invalid.");

      const end = new Date();
      const start = new Date(end.getTime() - parsed.data.days * 24 * 60 * 60 * 1000);
      const since = start.toISOString();

      const scoped = <T extends { eq: (column: string, value: string) => T }>(query: T) =>
        parsed.data.projectId ? query.eq("project_id", parsed.data.projectId) : query;

      const [runsResult, tasksResult, pullRequestsResult, testRunsResult, resultsResult, deploymentsResult, agentsResult] =
        await Promise.all([
          scoped(
            client
              .from("agent_runs")
              .select("status,failure_kind,project_id,tasks(risk_level)")
              .eq("organization_id", activeOrganization.id)
              .gte("created_at", since)
              .limit(1000),
          ),
          scoped(
            client
              .from("tasks")
              .select("status,source,risk_level,title,project_id")
              .eq("organization_id", activeOrganization.id)
              .gte("created_at", since)
              .limit(1000),
          ),
          scoped(
            client
              .from("pull_requests")
              .select("status,project_id")
              .eq("organization_id", activeOrganization.id)
              .gte("created_at", since)
              .limit(1000),
          ),
          scoped(
            client
              .from("test_runs")
              .select("passed_count,failed_count,project_id")
              .eq("organization_id", activeOrganization.id)
              .gte("created_at", since)
              .limit(1000),
          ),
          scoped(
            client
              .from("run_results")
              .select("security_findings,blockers,next_recommendation,project_id")
              .eq("organization_id", activeOrganization.id)
              .gte("created_at", since)
              .limit(1000),
          ),
          scoped(
            client
              .from("deployments")
              .select("status,rollback_of_deployment_id,project_id")
              .eq("organization_id", activeOrganization.id)
              .gte("created_at", since)
              .limit(1000),
          ),
          client
            .from("agents")
            .select("id,name,role,total_runs,succeeded_runs,failed_runs,last_run_at")
            .eq("organization_id", activeOrganization.id)
            .limit(200),
        ]);

      const firstError = [runsResult.error, tasksResult.error, pullRequestsResult.error].find(Boolean);
      if (firstError) return databaseErrorResponse(firstError);

      const runRows = rows<RunRow>(runsResult.data);
      const taskRows = rows<{ status: string; source: string; risk_level: string; title: string }>(
        tasksResult.data,
      );
      const testRows = rows<{ passed_count: number; failed_count: number }>(testRunsResult.data);
      const resultRows = rows<{
        security_findings: unknown;
        blockers: unknown;
        next_recommendation: string | null;
      }>(resultsResult.data);
      const deploymentRows = rows<{ status: string; rollback_of_deployment_id: string | null }>(
        deploymentsResult.data,
      );
      const pullRequestRows = rows<{ status: string }>(pullRequestsResult.data);

      const stringList = (value: unknown): string[] =>
        Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

      const securityFindings = resultRows.flatMap((result) => stringList(result.security_findings));
      const blockers = resultRows.flatMap((result) => stringList(result.blockers));

      const greenSucceeded = runRows.filter((run) => {
        if (run.status !== "succeeded") return false;
        const task = Array.isArray(run.tasks) ? run.tasks[0] : run.tasks;
        return (task as { risk_level?: string } | null)?.risk_level === "green";
      }).length;

      const report = generateCeoReport({
        window: { start: since, end: end.toISOString() },
        tasksCompleted: taskRows.filter((task) => task.status === "completed").length,
        tasksActive: taskRows.filter((task) => task.status === "in_progress").length,
        runsSucceeded: runRows.filter((run) => run.status === "succeeded").length,
        runsFailed: runRows.filter((run) => run.status === "failed").length,
        runsCancelled: runRows.filter((run) => run.status === "cancelled").length,
        greenRunsSucceeded: greenSucceeded,
        pullRequestsCreated: pullRequestRows.length,
        pullRequestsMerged: pullRequestRows.filter((pr) => pr.status === "merged").length,
        pullRequestsWaiting: pullRequestRows.filter((pr) => pr.status === "draft" || pr.status === "open").length,
        deployments: deploymentRows.length,
        deploymentFailures: deploymentRows.filter((deployment) => deployment.status === "failed").length,
        rollbacks: deploymentRows.filter((deployment) => deployment.rollback_of_deployment_id !== null).length,
        testsPassed: testRows.reduce((total, testRun) => total + (testRun.passed_count ?? 0), 0),
        testsFailed: testRows.reduce((total, testRun) => total + (testRun.failed_count ?? 0), 0),
        bugsFixed: taskRows.filter(
          (task) => task.status === "completed" && /\b(bug|fix|defect|repair)\b/i.test(task.title),
        ).length,
        issuesDiscovered: taskRows.filter(
          (task) => task.source === "ai_audit" || task.source === "failed_test" || task.source === "ci_failure",
        ).length,
        securityFindings,
        blockers,
        ownerDecisions: taskRows
          .filter((task) => task.risk_level === "red" && task.status === "awaiting_approval")
          .map((task) => `Approve or reject the RED task: ${task.title}`),
        deploymentTelemetryAvailable: deploymentRows.length > 0,
      });

      return jsonNoStore({
        activeOrganizationId: activeOrganization.id,
        window: { start: since, end: end.toISOString(), days: parsed.data.days },
        scope: parsed.data.projectId ? { projectId: parsed.data.projectId } : { projectId: null },
        report,
        agents: rows<{
          id: string;
          name: string;
          role: string;
          total_runs: number;
          succeeded_runs: number;
          failed_runs: number;
          last_run_at: string | null;
        }>(agentsResult.data)
          .filter((agent) => agent.total_runs > 0)
          .map((agent) => ({
            id: agent.id,
            name: agent.name,
            role: agent.role,
            totalRuns: agent.total_runs,
            succeededRuns: agent.succeeded_runs,
            failedRuns: agent.failed_runs,
            successRate: Math.round((agent.succeeded_runs / agent.total_runs) * 100),
            lastRunAt: agent.last_run_at,
          })),
        hasActivity: runRows.length > 0 || taskRows.length > 0 || pullRequestRows.length > 0,
      });
    },
    { code: "reports_unavailable", message: "Reports could not be generated." },
  );
}
