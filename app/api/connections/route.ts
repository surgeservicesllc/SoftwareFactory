import { describeProviders } from "@/lib/providers/registry";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { embedded, rows, withTenant } from "@/lib/server/tenant-route";

export const runtime = "nodejs";

/**
 * The aggregate connections view.
 *
 * A connection is metadata plus a reference to server-side secret material. No
 * credential value is read here, and none is ever returned. Provider status is
 * reported truthfully: "Configured" means server settings exist, which is not
 * the same claim as "Connected".
 */

type ConnectionRow = {
  id: string;
  name: string;
  provider: string;
  status: string;
  external_account_label: string | null;
  last_verified_at: string | null;
  error_message: string | null;
  created_at: string;
  github_installations: unknown;
};

const PROVIDER_CAPABILITIES: Record<string, string[]> = {
  github: ["repository reads", "isolated branch commits", "draft pull requests", "signed webhooks", "CI observation"],
  openai: ["worker runs", "structured engineering results"],
  anthropic: ["planned for Phase 2"],
  vercel: ["deployment visibility"],
  supabase: ["managed project metadata"],
  other: [],
};

export async function GET() {
  return withTenant(
    async ({ activeOrganization, client }) => {
      const [connectionsResult, projectLinksResult] = await Promise.all([
        client
          .from("connections")
          .select(
            "id,name,provider,status,external_account_label,last_verified_at,error_message,created_at,"
              + "github_installations(status,suspended_at,external_installation_id)",
          )
          .eq("organization_id", activeOrganization.id)
          .order("provider", { ascending: true })
          .limit(100),
        client
          .from("project_connections")
          .select("connection_id,project_id,is_primary,projects(name)")
          .eq("organization_id", activeOrganization.id)
          .limit(500),
      ]);
      if (connectionsResult.error) return databaseErrorResponse(connectionsResult.error);

      const linksByConnection = new Map<string, Array<{ id: string; name: string }>>();
      for (const link of rows<{ connection_id: string; project_id: string; projects: unknown }>(
        projectLinksResult.data,
      )) {
        const project = embedded<{ name: string }>(link.projects);
        linksByConnection.set(link.connection_id, [
          ...(linksByConnection.get(link.connection_id) ?? []),
          { id: link.project_id, name: project?.name ?? "Project" },
        ]);
      }

      const connections = rows<ConnectionRow>(connectionsResult.data).map((connection) => {
        const installation = embedded<{
          status: string;
          suspended_at: string | null;
          external_installation_id: number;
        }>(connection.github_installations);
        const live =
          connection.provider === "github"
            ? connection.status === "connected" && installation?.status === "active" && !installation.suspended_at
            : connection.status === "connected";

        return {
          id: connection.id,
          name: connection.name,
          provider: connection.provider,
          status: live ? "connected" : connection.status,
          statusLabel: live ? "Connected" : "Not Connected",
          account: connection.external_account_label,
          capabilities: PROVIDER_CAPABILITIES[connection.provider] ?? [],
          projects: linksByConnection.get(connection.id) ?? [],
          lastVerifiedAt: connection.last_verified_at,
          errorMessage: connection.error_message,
          createdAt: connection.created_at,
          installationSuspended: Boolean(installation?.suspended_at),
        };
      });

      const providers = describeProviders();
      const vercelToken = Boolean(process.env.VERCEL_TOKEN?.trim());

      return jsonNoStore({
        activeOrganizationId: activeOrganization.id,
        connections,
        providerStatus: {
          github: {
            label: "GitHub App",
            state: connections.some((connection) => connection.provider === "github" && connection.status === "connected")
              ? "connected"
              : "not_connected",
            detail: "Repository reads, isolated branch commits, draft pull requests, and signed webhooks.",
            ownerAction: connections.some((connection) => connection.provider === "github")
              ? null
              : "Install the GitHub App from Connections and complete the authenticated callback.",
          },
          workers: providers.implemented.map((provider) => ({
            key: provider.key,
            label: provider.label,
            state: provider.status.state,
            detail: provider.status.detail,
            ownerAction: provider.status.ownerAction,
            models: provider.models,
          })),
          planned: providers.planned.map((provider) => ({
            key: provider.key,
            label: provider.label,
            phase: provider.phase,
            state: provider.status.state,
            detail: provider.status.detail,
          })),
          vercel: {
            label: "Vercel",
            state: vercelToken ? "configured" : "not_connected",
            detail: vercelToken
              ? "A server-side Vercel credential is present. Deployment visibility is not verified until a real deployment is read."
              : "Deployment visibility is unavailable. SoftwareFactory hosts on Vercel, but hosting is not an in-product deployment adapter.",
            ownerAction: vercelToken
              ? null
              : "Add a server-only VERCEL_TOKEN with read scope to enable deployment visibility.",
          },
          supabase: {
            label: "Supabase (managed projects)",
            state: "not_connected",
            detail:
              "SoftwareFactory's own Supabase project is separate from any managed project's database. No managed Supabase connection is configured, and a worker is never granted service-role access.",
            ownerAction: null,
          },
        },
      });
    },
    { code: "connections_unavailable", message: "Connections could not be loaded." },
  );
}
