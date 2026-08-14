import { tenantRpcListResponse } from "@/lib/server/tenant-list";

export const runtime = "nodejs";

/**
 * Triggers and their delivery history.
 *
 * The public slug is deliberately absent: a browser listing does not need the
 * callable URL, and the signing secret is reported only as configured or not.
 */
type Row = {
  id: string;
  name: string;
  display_name: string;
  agent_name: string;
  project_name: string;
  enabled: boolean;
  secret_configured: boolean;
  delivery_count: number;
  accepted_count: number;
  last_received_at: string | null;
};

export async function GET(request: Request) {
  return tenantRpcListResponse<Row>({
    request,
    rpc: "agentos_list_triggers",
    unavailableCode: "agentos_triggers_unavailable",
    unavailableMessage: "Triggers could not be loaded.",
    shape: (rows) => ({
      triggers: rows.map((row) => ({
        id: row.id,
        name: row.name,
        displayName: row.display_name,
        agentName: row.agent_name,
        projectName: row.project_name,
        enabled: row.enabled,
        secretConfigured: row.secret_configured,
        deliveries: {
          total: row.delivery_count,
          accepted: row.accepted_count,
          // Rejected covers bad signatures, disabled deliveries and replays.
          rejected: row.delivery_count - row.accepted_count,
        },
        lastReceivedAt: row.last_received_at,
      })),
    }),
  });
}
