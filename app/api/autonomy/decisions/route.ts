import { tenantRpcListResponse } from "@/lib/server/tenant-list";

export const runtime = "nodejs";

/**
 * The autonomy audit trail.
 *
 * Every decision the loop reached, why it refused, and against which head.
 * Blockers are named codes only — no provider message and no free-form
 * reasoning ever enters this table, so none can leave through here.
 */
type Row = {
  id: string;
  project_name: string;
  action: string;
  decision: string;
  risk: string;
  risk_escalated: boolean;
  head_sha: string | null;
  blockers: string[];
  reached_stage: string | null;
  policy_version: string;
  had_author: boolean;
  had_approver: boolean;
  independent_approval: boolean;
  decided_at: string;
};

export async function GET(request: Request) {
  return tenantRpcListResponse<Row>({
    request,
    rpc: "list_autonomy_decisions",
    unavailableCode: "autonomy_decisions_unavailable",
    unavailableMessage: "Autonomy decisions could not be loaded.",
    shape: (rows) => ({
      decisions: rows.map((row) => ({
        id: row.id,
        projectName: row.project_name,
        action: row.action,
        decision: row.decision,
        risk: row.risk,
        riskEscalated: row.risk_escalated,
        headSha: row.head_sha,
        blockers: row.blockers ?? [],
        reachedStage: row.reached_stage,
        policyVersion: row.policy_version,
        // Whether a human stood behind each role, and whether the approval was
        // independent. Identities stay on the row for a targeted audit.
        hadAuthor: row.had_author,
        hadApprover: row.had_approver,
        independentApproval: row.independent_approval,
        decidedAt: row.decided_at,
      })),
    }),
  });
}
