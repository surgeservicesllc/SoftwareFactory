"use client";

import { AlertTriangle, Cpu, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Card, StatusBadge } from "@/components/ui";

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
      <Card className="grid min-h-40 place-items-center">
        <Loader2 className="size-5 animate-spin text-[var(--accent)]" aria-label="Checking AI providers" />
      </Card>
    );
  }

  if (loadState === "unavailable" || !payload) {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-2 text-xs text-[var(--warning)]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{message || "Provider status is unavailable."}</span>
        </div>
        <button type="button" onClick={() => void reload()} className="btn btn-secondary btn-sm mt-4">
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Retry
        </button>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="label">AI providers</p>
        <div className="flex items-center gap-2">
          <StatusBadge tone={payload.executionEnabled ? "warning" : "neutral"}>
            {payload.executionEnabled ? "Execution enabled" : "Execution OFF"}
          </StatusBadge>
          <button type="button" onClick={() => void reload()} className="btn btn-secondary btn-sm">
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Re-check
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {payload.providers.map((provider) => (
          <Card key={provider.provider} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Cpu className="size-4 text-[var(--text-faint)]" aria-hidden="true" />
                <h3 className="text-xs font-semibold text-[var(--text)]">{provider.label}</h3>
              </div>
              <StatusBadge tone={toneForState(provider.state)}>{provider.stateLabel}</StatusBadge>
            </div>

            <p className="mt-3 text-sm leading-5 text-[var(--text-muted)]">{provider.detail}</p>

            <dl className="mt-4 grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 text-xs">
              <dt className="text-[var(--text-faint)]">Default model</dt>
              <dd className="font-mono text-[var(--text)]">{provider.defaultModel ?? "Not selected"}</dd>
              <dt className="text-[var(--text-faint)]">Configured</dt>
              <dd className="text-[var(--text)]">
                {provider.configuredModels.length
                  ? `${provider.configuredModels.filter((model) => model.enabled).length} enabled of ${provider.configuredModels.length}`
                  : "No catalogue entries"}
              </dd>
              <dt className="text-[var(--text-faint)]">Probe latency</dt>
              <dd className="text-[var(--text)]">
                {provider.latencyMs === null ? "Not probed" : `${provider.latencyMs} ms`}
              </dd>
              <dt className="text-[var(--text-faint)]">Server variables</dt>
              <dd className="font-mono text-xs text-[var(--text-muted)]">
                {provider.environmentVariableNames.join(", ")}
              </dd>
            </dl>
          </Card>
        ))}
      </div>

      <p className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] px-4 py-3 text-xs leading-5 text-[var(--text-muted)]">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
        Provider credentials live only in server-side environment settings. Only the variable names
        above cross this boundary, never their values, and a provider connection is never a
        consumer account or browser session.
      </p>
    </div>
  );
}
