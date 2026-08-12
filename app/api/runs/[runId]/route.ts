import { z } from "zod";

import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { invalidRequest, withTenant } from "@/lib/server/tenant-route";

export const runtime = "nodejs";

type RunDetailRow = {
  id: string;
  organization_id: string;
  project_id: string;
  task_id: string;
  agent_id: string;
  status: string;
  provider: string | null;
  model: string | null;
  step: string | null;
  attempt: number;
  max_attempts: number;
  repair_attempts: number;
  ci_repair_attempts: number;
  failure_kind: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  cancel_requested_at: string | null;
  heartbeat_at: string | null;
  lease_expires_at: string | null;
  input: Record<string, unknown>;
  projects: unknown;
  agents: unknown;
  tasks: unknown;
};

type RunResultRow = {
  summary: string;
  files_changed: number;
  additions: number;
  deletions: number;
  commits: number;
  tests_outcome: string;
  lint_outcome: string;
  typecheck_outcome: string;
  build_outcome: string;
  risk_level: string;
  changed_files: unknown;
  warnings: unknown;
  blockers: unknown;
  security_findings: unknown;
  next_recommendation: string | null;
};

/**
 * Run detail.
 *
 * Returns the owner command, plan context, execution event timeline, structured
 * result, and real CI/pull-request links. Provider chain-of-thought is never
 * stored and therefore never returned; only concise execution events are.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  if (!z.string().uuid().safeParse(runId).success) {
    return invalidRequest("invalid_run_id", "The run id is invalid.");
  }

  return withTenant(
    async ({ activeOrganization, client }) => {
      const { data: runData, error } = await client
        .from("agent_runs")
        .select(
          "id,organization_id,project_id,task_id,agent_id,status,provider,model,step,attempt,max_attempts,"
            + "repair_attempts,ci_repair_attempts,failure_kind,error_message,started_at,completed_at,created_at,"
            + "cancel_requested_at,heartbeat_at,lease_expires_at,input,"
            + "projects(name,github_repository,default_branch),agents(name,role),"
            + "tasks(id,title,description,acceptance_criteria,status,risk_level,source,command_id,depends_on_task_id)",
        )
        .eq("id", runId)
        .eq("organization_id", activeOrganization.id)
        .maybeSingle();
      if (error) return databaseErrorResponse(error);
      if (!runData) {
        return jsonNoStore(
          { error: { code: "run_not_found", message: "The run was not found." } },
          { status: 404 },
        );
      }
      const run = runData as unknown as RunDetailRow;

      const single = <T,>(value: unknown): T | null =>
        Array.isArray(value) ? ((value[0] as T) ?? null) : ((value as T) ?? null);
      const task = single<{
        id: string;
        title: string;
        description: string | null;
        acceptance_criteria: string | null;
        status: string;
        risk_level: string;
        source: string;
        command_id: string | null;
        depends_on_task_id: string | null;
      }>(run.tasks);
      const project = single<{
        name: string;
        github_repository: string | null;
        default_branch: string;
      }>(run.projects);
      const agent = single<{ name: string; role: string }>(run.agents);

      const [events, workspace, result, pullRequest, command] = await Promise.all([
        client
          .from("run_events")
          .select("id,sequence,event_type,message,occurred_at")
          .eq("agent_run_id", runId)
          .order("sequence", { ascending: true })
          .limit(500),
        client
          .from("run_workspaces")
          .select("repository,base_branch,base_sha,working_branch,provider,model,created_at")
          .eq("agent_run_id", runId)
          .maybeSingle(),
        client
          .from("run_results")
          .select(
            "summary,files_changed,additions,deletions,commits,tests_outcome,lint_outcome,typecheck_outcome,"
              + "build_outcome,risk_level,changed_files,warnings,blockers,security_findings,next_recommendation",
          )
          .eq("agent_run_id", runId)
          .maybeSingle(),
        client
          .from("pull_requests")
          .select("external_number,url,title,status,head_branch,base_branch,opened_at")
          .eq("agent_run_id", runId)
          .maybeSingle(),
        task?.command_id
          ? client.from("commands").select("id,prompt,status,requested_risk").eq("id", task.command_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

      const nextAction = describeNextAction(run.status, run.failure_kind, Boolean(pullRequest.data));
      const runResult = (result.data ?? null) as RunResultRow | null;

      return jsonNoStore({
        run: {
          id: run.id,
          status: run.status,
          step: run.step,
          attempt: run.attempt,
          maxAttempts: run.max_attempts,
          repairAttempts: run.repair_attempts,
          ciRepairAttempts: run.ci_repair_attempts,
          failureKind: run.failure_kind,
          errorMessage: run.error_message,
          provider: run.provider,
          model: run.model,
          startedAt: run.started_at,
          completedAt: run.completed_at,
          createdAt: run.created_at,
          heartbeatAt: run.heartbeat_at,
          leaseExpiresAt: run.lease_expires_at,
          cancelRequestedAt: run.cancel_requested_at,
          durationMs:
            run.started_at && run.completed_at
              ? new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()
              : null,
        },
        command: command.data
          ? {
            id: command.data.id,
            prompt: command.data.prompt,
            status: command.data.status,
            requestedRisk: command.data.requested_risk,
          }
          : null,
        task: task
          ? {
            id: task.id,
            title: task.title,
            description: task.description,
            acceptanceCriteria: task.acceptance_criteria,
            status: task.status,
            risk: task.risk_level,
            source: task.source,
            dependsOnTaskId: task.depends_on_task_id,
          }
          : null,
        agent: { id: run.agent_id, name: agent?.name ?? "Agent", role: agent?.role ?? "custom" },
        project: {
          id: run.project_id,
          name: project?.name ?? "Project",
          repository: project?.github_repository ?? null,
          defaultBranch: project?.default_branch ?? null,
        },
        workspace: workspace.data
          ? {
            repository: workspace.data.repository,
            baseBranch: workspace.data.base_branch,
            baseSha: workspace.data.base_sha,
            workingBranch: workspace.data.working_branch,
            provider: workspace.data.provider,
            model: workspace.data.model,
            createdAt: workspace.data.created_at,
          }
          : null,
        result: runResult
          ? {
            summary: runResult.summary,
            filesChanged: runResult.files_changed,
            additions: runResult.additions,
            deletions: runResult.deletions,
            commits: runResult.commits,
            testsOutcome: runResult.tests_outcome,
            lintOutcome: runResult.lint_outcome,
            typecheckOutcome: runResult.typecheck_outcome,
            buildOutcome: runResult.build_outcome,
            risk: runResult.risk_level,
            changedFiles: runResult.changed_files,
            warnings: runResult.warnings,
            blockers: runResult.blockers,
            securityFindings: runResult.security_findings,
            nextRecommendation: runResult.next_recommendation,
          }
          : null,
        pullRequest: pullRequest.data
          ? {
            number: pullRequest.data.external_number,
            url: pullRequest.data.url,
            title: pullRequest.data.title,
            status: pullRequest.data.status,
            headBranch: pullRequest.data.head_branch,
            baseBranch: pullRequest.data.base_branch,
            openedAt: pullRequest.data.opened_at,
            draft: pullRequest.data.status === "draft",
          }
          : null,
        events: (events.data ?? []).map((event) => ({
          id: event.id,
          sequence: Number(event.sequence),
          type: event.event_type,
          message: event.message,
          occurredAt: event.occurred_at,
        })),
        nextAction,
      });
    },
    { code: "run_unavailable", message: "The run could not be loaded." },
  );
}

function describeNextAction(
  status: string,
  failureKind: string | null,
  hasPullRequest: boolean,
): string {
  switch (status) {
    case "queued":
      return "Waiting for a durable worker tick. Nothing has run yet.";
    case "running":
    case "validating":
      return "A worker holds the lease and is advancing this run one step at a time.";
    case "cancelling":
      return "Cancellation was requested. The worker stops before any further external effect.";
    case "awaiting_review":
      return "This run needs a human decision before it can be considered finished.";
    case "cancelled":
      return "This run was cancelled. Its history is preserved.";
    case "failed":
      return failureKind === "protected_resource" || failureKind === "secret_detected"
        ? "Blocked by policy before any commit. Review the blocked finding; this needs an owner decision, not a retry."
        : "Review the failure, then submit a new command if the work is still wanted.";
    case "succeeded":
      return hasPullRequest
        ? "Review the draft pull request. SoftwareFactory did not approve, merge, or deploy it."
        : "This run produced findings rather than code changes. Review the result summary.";
    default:
      return "No action is recorded for this state.";
  }
}
