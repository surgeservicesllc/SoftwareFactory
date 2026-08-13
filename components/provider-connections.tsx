"use client";

import { Bot, CloudCog, Database, GitBranch, Loader2, RefreshCw, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { formatDateTime } from "@/components/tenant-states";
import { Panel, SectionTitle, StatusBadge } from "@/components/ui";
import { useTenantResource } from "@/lib/client/use-tenant-resource";

type ProviderState = "connected" | "configured" | "not_connected" | "unavailable" | "disabled";

type ConnectionsPayload = {
  connections: Array<{
    id: string;
    name: string;
    provider: string;
    status: string;
    statusLabel: string;
    account: string | null;
    capabilities: string[];
    projects: Array<{ id: string; name: string }>;
    lastVerifiedAt: string | null;
    errorMessage: string | null;
    installationSuspended: boolean;
  }>;
  providerStatus: {
    github: { label: string; state: string; detail: string; ownerAction: string | null };
    workers: Array<{ key: string; label: string; state: ProviderState; detail: string; ownerAction: string | null; models: string[] }>;
    planned: Array<{ key: string; label: string; phase: string; state: string; detail: string }>;
    vercel: { label: string; state: string; detail: string; ownerAction: string | null };
    supabase: { label: string; state: string; detail: string; ownerAction: string | null };
  };
};

function stateTone(state: string): "safe" | "warning" | "neutral" | "danger" {
  if (state === "connected") return "safe";
  if (state === "configured") return "warning";
  if (state === "error" || state === "unavailable") return "danger";
  return "neutral";
}

function stateLabel(state: string) {
  if (state === "connected") return "Connected";
  if (state === "configured") return "Configured";
  if (state === "disabled") return "Disabled";
  if (state === "error") return "Error";
  if (state === "unavailable") return "Unavailable";
  return "Not Connected";
}

/**
 * The provider-wide connection summary.
 *
 * A connection is metadata plus a reference to server-side secret material.
 * "Configured" means server settings exist; it is deliberately not the same
 * claim as "Connected", which requires observed provider behavior.
 */
export function ProviderConnections() {
  const connections = useTenantResource<ConnectionsPayload>("/api/connections");

  if (connections.state !== "ready" || !connections.data) {
    // The GitHub console below renders its own states; stay quiet here rather
    // than duplicating a sign-in or setup notice on the same page.
    return null;
  }

  const { providerStatus, connections: rows } = connections.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle
          title="All providers"
          description="What this factory can reach, and exactly what is missing where it cannot."
        />
        <button
          type="button"
          onClick={connections.reload}
          disabled={connections.refreshing}
          className="secondary-action"
          aria-label="Refresh provider connections"
        >
          {connections.refreshing ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-3.5" aria-hidden="true" />
          )}
          Refresh
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <ProviderCard
          icon={GitBranch}
          label={providerStatus.github.label}
          state={providerStatus.github.state}
          detail={providerStatus.github.detail}
          ownerAction={providerStatus.github.ownerAction}
        />
        {providerStatus.workers.map((worker) => (
          <ProviderCard
            key={worker.key}
            icon={Bot}
            label={worker.label}
            state={worker.state}
            detail={worker.detail}
            ownerAction={worker.ownerAction}
            footnote={`Models: ${worker.models.join(", ")}`}
          />
        ))}
        <ProviderCard
          icon={CloudCog}
          label={providerStatus.vercel.label}
          state={providerStatus.vercel.state}
          detail={providerStatus.vercel.detail}
          ownerAction={providerStatus.vercel.ownerAction}
        />
        <ProviderCard
          icon={Database}
          label={providerStatus.supabase.label}
          state={providerStatus.supabase.state}
          detail={providerStatus.supabase.detail}
          ownerAction={providerStatus.supabase.ownerAction}
        />
        {providerStatus.planned.map((planned) => (
          <ProviderCard
            key={planned.key}
            icon={Bot}
            label={planned.label}
            state={planned.state}
            detail={planned.detail}
            ownerAction={null}
            footnote={planned.phase}
          />
        ))}
      </div>

      {rows.length > 0 ? (
        <Panel className="overflow-hidden">
          <div className="border-b border-[#212b37] p-4">
            <SectionTitle
              title="Connection records"
              description="Stored metadata only. No credential value is read or returned here."
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead className="border-b border-[#202a36] bg-[#0b1017] font-mono text-[8px] uppercase tracking-[0.12em] text-[#596675]">
                <tr>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Account</th>
                  <th className="px-4 py-3 font-medium">Capabilities</th>
                  <th className="px-4 py-3 font-medium">Projects</th>
                  <th className="px-4 py-3 font-medium">Last verified</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202a36]">
                {rows.map((connection) => (
                  <tr key={connection.id}>
                    <td className="px-4 py-3 text-xs text-[#cfd6dd]">{connection.provider}</td>
                    <td className="px-4 py-3 font-mono text-[10px] text-[#8c99a9]">{connection.account ?? "—"}</td>
                    <td className="px-4 py-3 text-[10px] text-[#7d8998]">
                      {connection.capabilities.length ? connection.capabilities.join(", ") : "—"}
                    </td>
                    <td className="px-4 py-3 text-[10px] text-[#7d8998]">
                      {connection.projects.length === 0
                        ? "None"
                        : connection.projects.map((project) => (
                          <Link
                            key={project.id}
                            href={`/projects/${project.id}`}
                            className="mr-2 inline-block hover:text-[#c4ccd5]"
                          >
                            {project.name}
                          </Link>
                        ))}
                    </td>
                    <td className="px-4 py-3 font-mono text-[9px] text-[#6c7887]">
                      {formatDateTime(connection.lastVerifiedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={connection.status === "connected" ? "safe" : "neutral"}>
                        {connection.statusLabel}
                      </StatusBadge>
                      {connection.installationSuspended ? (
                        <p className="mt-1 text-[9px] text-[#e0b978]">Installation suspended</p>
                      ) : null}
                      {connection.errorMessage ? (
                        <p className="mt-1 text-[9px] text-[#e59399]">{connection.errorMessage}</p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function ProviderCard({
  icon: Icon,
  label,
  state,
  detail,
  ownerAction,
  footnote,
}: {
  icon: LucideIcon;
  label: string;
  state: string;
  detail: string;
  ownerAction: string | null;
  footnote?: string;
}) {
  return (
    <Panel className="p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg border border-[#2c3947] bg-[#151d27] text-[#a5b849]">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <span className="text-xs font-semibold text-[#d5dbe2]">{label}</span>
        </span>
        <StatusBadge tone={stateTone(state)}>{stateLabel(state)}</StatusBadge>
      </div>
      <p className="mt-3 text-[10px] leading-4 text-[#6a7787]">{detail}</p>
      {footnote ? <p className="mt-2 font-mono text-[9px] text-[#5f6c7c]">{footnote}</p> : null}
      {ownerAction ? (
        <p className="mt-3 rounded border border-[#423824] bg-[#221c11] p-2 text-[10px] leading-4 text-[#b6a77f]">
          Owner action: {ownerAction}
        </p>
      ) : null}
    </Panel>
  );
}
