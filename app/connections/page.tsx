import { Box, Cloud, Code2, Database, KeyRound, PlugZap, ShieldCheck, Waypoints } from "lucide-react";

import { NotConnectedBadge, PageHeader, Panel } from "@/components/ui";
import { connections } from "@/lib/demo-data";

const icons = [Code2, Waypoints, Waypoints, Cloud, Database, Box] as const;

export default function ConnectionsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Providers / Connections"
        title="Connections"
        description="Provider-neutral authorization metadata kept separate from users, projects, agents, and the server-side secrets that make integrations work."
        action={<NotConnectedBadge label="All providers Not Connected" />}
      />

      <Panel className="mb-5 grid gap-5 p-5 sm:p-6 lg:grid-cols-[1fr_360px]">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#e4e9ed]">
            <KeyRound className="size-4 text-[#c6f135]" aria-hidden="true" />
            Secret-safe by design
          </div>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-[#748191]">
            A connection record stores provider type, display metadata, status, scopes, and an opaque server-side secret reference. API keys, tokens, passwords, and private keys never belong in database rows or browser payloads.
          </p>
        </div>
        <div className="rounded-lg border border-[#30401e] bg-[#18210f] p-3.5 text-[10px] leading-5 text-[#a4b96a]">
          <div className="flex items-center gap-2 font-semibold text-[#c8df7c]">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            Server-only trust boundary
          </div>
          <p className="mt-1.5">Privileged environment variables never use the NEXT_PUBLIC_ prefix and cannot be imported into Client Components.</p>
        </div>
      </Panel>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {connections.map((connection, index) => {
          const Icon = icons[index] ?? PlugZap;
          return (
            <Panel key={connection.name} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-9 place-items-center rounded-lg border border-[#2d3947] bg-[#151d27] text-[#91a334]">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <NotConnectedBadge />
              </div>
              <h2 className="mt-4 text-sm font-semibold text-[#edf1f4]">{connection.name}</h2>
              <p className="mt-2 min-h-10 text-[10px] leading-5 text-[#748191]">{connection.description}</p>
              <div className="mt-4 flex items-center justify-between border-t border-[#202a36] pt-3">
                <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#4f5b69]">No secret reference</span>
                <button type="button" disabled className="min-h-7 cursor-not-allowed rounded-md border border-[#293442] px-2 text-[9px] font-semibold text-[#53606e]">Configure in Phase 1B</button>
              </div>
            </Panel>
          );
        })}
      </div>
    </>
  );
}
