import { tenantRpcListResponse } from "@/lib/server/tenant-list";

export const runtime = "nodejs";

/**
 * The inbox. Open questions sort first, because an open question is a session
 * waiting on a person.
 */
type Row = {
  id: string;
  author: string;
  kind: string;
  status: string;
  body: string;
  choices: string[];
  selected_choice: string | null;
  answer_body: string | null;
  agent_name: string | null;
  agent_run_id: string | null;
  created_at: string;
  answered_at: string | null;
};

export async function GET(request: Request) {
  return tenantRpcListResponse<Row>({
    request,
    rpc: "agentos_list_inbox",
    unavailableCode: "agentos_inbox_unavailable",
    unavailableMessage: "The inbox could not be loaded.",
    shape: (rows) => ({
      messages: rows.map((row) => ({
        id: row.id,
        author: row.author,
        kind: row.kind,
        status: row.status,
        body: row.body,
        choices: row.choices ?? [],
        // The resolved label, never the index.
        selectedChoice: row.selected_choice,
        answerBody: row.answer_body,
        agentName: row.agent_name,
        agentRunId: row.agent_run_id,
        createdAt: row.created_at,
        answeredAt: row.answered_at,
      })),
    }),
  });
}
