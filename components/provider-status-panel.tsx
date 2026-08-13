"use client";

import { AlertTriangle, Cpu, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Panel, StatusBadge } from "@/components/ui";

export type ProviderConnectionState = "not_configured" | "connected" | "error" | "disabled";

export type ProviderModelConfiguration = {
  id: string;
  provider: string;
  model: string;
  displayName: string;
  enabled: boolean;
  isDefault: boolean;
};

export type ProviderStatus = {
  provider: string;
  label: string;
  state: ProviderConnectionState;
  stateLabel: string;
  detail: string;
  checkedAt: string;
  latencyMs: number | null;
  defaultModel: string | null;
  configuredModels: ProviderModelConfiguration[];
  environmentVariableNames: string[];
};

export type ProviderStatusPayload = {
  executionEnabled: boolean;
  providers: ProviderStatus[];
  organization?: { id: string; name: string; role: string };
};

type LoadState = "loading" | "ready" | "unavailable";

export function toneForState(state: ProviderConnectionState) {
  if (state === "connected") return "safe" as const;
  if (state === "error") return "danger" as const;
  return "neutral" as const;
}

export function useProviderStatus() {
  const [payload, setPayload] = useState<ProviderStatusPayload | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const response = await fetch("/api/providers", { cache: "no-store" });
      const body = (await response.json()) as ProviderStatusPayload & {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "Provider status is unavailable.");
      setPayload(body);
      setLoadState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Provider status is unavailable.");
      setLoadState("unavailable");
    }
  }, []);

  useEffect(() => {
    // Deferred a tick so the initial load does not set state synchronously
    // inside the effect body, matching the other consoles in this app.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return { payload, loadState, message, reload: load } as const;
}

/**
 * Live AI provider connection states. Every badge here reflects a probe made
 * when the page loaded; nothing is hard coded, and an unconfigured provider
 * says exactly that rather than pretending to be offline for another reason.
 */
export function ProviderStatusPanel() {
  const { payload, loadState, message, reload } = useProviderStatus();

  if (loadState === "loading") {
    return (
      <Panel className="grid min-h-40 place-items-center">
        <Loader2 className="size-5 animate-spin text-[#c6f135]" aria-label="Checking AI providers" />
      </Panel>
    );
  }

  if (loadState === "unavailable" || !payload) {
    return (
      <Panel className="p-5">
        <div className="flex items-start gap-2 text-xs text-[#d7b96d]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{message || "Provider status is unavailable."}</span>
        </div>
        <button type="button" onClick={() => void reload()} className="secondary-action mt-4">
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Retry
        </button>
      </Panel>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow">AI providers</p>
        <div className="flex items-center gap-2">
          <StatusBadge tone={payload.executionEnabled ? "warning" : "neutral"}>
            {payload.executionEnabled ? "Execution enabled" : "Execution OFF"}
          </StatusBadge>
          <button type="button" onClick={() => void reload()} className="secondary-action">
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Re-check
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {payload.providers.map((provider) => (
          <Panel key={provider.provider} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Cpu className="size-4 text-[#778493]" aria-hidden="true" />
                <h3 className="text-xs font-semibold text-[#d5dbe2]">{provider.label}</h3>
              </div>
              <StatusBadge tone={toneForState(provider.state)}>{provider.stateLabel}</StatusBadge>
            </div>

            <p className="mt-3 text-[11px] leading-5 text-[#748191]">{provider.detail}</p>

            <dl className="mt-4 grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 text-[10px]">
              <dt className="text-[#667485]">Default model</dt>
              <dd className="font-mono text-[#c5cdd6]">{provider.defaultModel ?? "Not selected"}</dd>
              <dt className="text-[#667485]">Configured</dt>
              <dd className="text-[#c5cdd6]">
                {provider.configuredModels.length
                  ? `${provider.configuredModels.filter((model) => model.enabled).length} enabled of ${provider.configuredModels.length}`
                  : "No catalogue entries"}
              </dd>
              <dt className="text-[#667485]">Probe latency</dt>
              <dd className="text-[#c5cdd6]">
                {provider.latencyMs === null ? "Not probed" : `${provider.latencyMs} ms`}
              </dd>
              <dt className="text-[#667485]">Server variables</dt>
              <dd className="font-mono text-[9px] text-[#8c99a9]">
                {provider.environmentVariableNames.join(", ")}
              </dd>
            </dl>
          </Panel>
        ))}
      </div>

      <p className="flex items-start gap-2 rounded-lg border border-[#26313e] bg-[#0b1017] px-4 py-3 text-[10px] leading-5 text-[#6d7a8a]">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-[#849528]" aria-hidden="true" />
        Provider credentials live only in server-side environment settings. Only the variable names
        above cross this boundary, never their values, and a provider connection is never a
        consumer account or browser session.
      </p>
    </div>
  );
}
