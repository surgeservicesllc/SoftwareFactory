"use client";

import { AlertTriangle, Loader2, Plus, Search } from "lucide-react";
import { useState } from "react";

import { useProviderStatus } from "@/components/provider-status-panel";
import { Card, SectionTitle, StatusBadge } from "@/components/ui";

type DiscoveredModel = { id: string; displayName: string };

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic / Claude" },
  { id: "openai", label: "OpenAI / Codex" },
] as const;

/**
 * Owner controls for the AI provider layer: the outbound execution switch and
 * the model catalogue that routing is allowed to choose from.
 */
export function ProviderSettings() {
  const { payload, loadState, reload } = useProviderStatus();
  const [pending, setPending] = useState<"execution" | "discover" | "add" | null>(null);
  const [message, setMessage] = useState("");
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]["id"]>("anthropic");
  const [discovered, setDiscovered] = useState<DiscoveredModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");

  async function toggleExecution(enabled: boolean) {
    if (enabled) {
      const confirmation = window.prompt(
        "Enabling outbound provider execution lets SoftwareFactory send bounded task descriptions to an external AI provider and spend money on your account. Runs stay advisory and cannot change a repository.\n\nType ENABLE PROVIDER EXECUTION to continue.",
      );
      if (confirmation !== "ENABLE PROVIDER EXECUTION") return;
      await submitExecution(true, confirmation);
      return;
    }
    await submitExecution(false);
  }

  async function submitExecution(enabled: boolean, confirmation?: string) {
    setPending("execution");
    setMessage("");
    try {
      const response = await fetch("/api/providers/execution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirmation ? { enabled, confirmation } : { enabled }),
      });
      const body = (await response.json()) as { message?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The switch could not be changed.");
      setMessage(body.message ?? "");
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The switch could not be changed.");
    } finally {
      setPending(null);
    }
  }

  async function discoverModels() {
    setPending("discover");
    setMessage("");
    setDiscovered([]);
    try {
      const response = await fetch(`/api/providers/models?provider=${provider}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as {
        models?: DiscoveredModel[];
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "Model discovery failed.");
      setDiscovered(body.models ?? []);
      setSelectedModel(body.models?.[0]?.id ?? "");
      if (!body.models?.length) setMessage("The provider returned no models.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Model discovery failed.");
    } finally {
      setPending(null);
    }
  }

  async function addModel() {
    if (!selectedModel) return;
    setPending("add");
    setMessage("");
    try {
      const chosen = discovered.find((model) => model.id === selectedModel);
      const response = await fetch("/api/providers/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          model: selectedModel,
          displayName: chosen?.displayName ?? selectedModel,
          capabilities: [],
          enabled: true,
          isDefault: false,
        }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The model could not be saved.");
      setMessage(`${selectedModel} is now available to routing.`);
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The model could not be saved.");
    } finally {
      setPending(null);
    }
  }

  if (loadState === "loading") {
    return (
      <Card className="grid min-h-40 place-items-center">
        <Loader2 className="size-5 animate-spin text-[var(--accent)]" aria-label="Loading provider settings" />
      </Card>
    );
  }

  const executionEnabled = Boolean(payload?.executionEnabled);

  return (
    <div className="space-y-4">
      <Card className="p-5 sm:p-6">
        <SectionTitle
          title="Outbound provider execution"
          description="Off by default. A configured credential is not by itself consent to spend money at a provider."
        />
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <StatusBadge tone={executionEnabled ? "warning" : "neutral"}>
              {executionEnabled ? "Enabled" : "Disabled"}
            </StatusBadge>
            <span className="text-sm text-[var(--text-muted)]">
              {executionEnabled
                ? "Owner-initiated runs may contact a configured provider."
                : "No provider request will be made from this organization."}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void toggleExecution(!executionEnabled)}
            disabled={pending !== null}
            className={executionEnabled ? "btn btn-secondary btn-sm" : "btn btn-primary justify-center"}
          >
            {pending === "execution" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {executionEnabled ? "Disable execution" : "Enable execution"}
          </button>
        </div>
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-[var(--warning)]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--warning)]" aria-hidden="true" />
          Enabling execution does not grant repository, merge, deployment, or approval authority.
          Those remain governed by the Phase 1D interlocks, which stay locked.
        </p>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionTitle
          title="Model catalogue"
          description="Routing may only choose a model that appears here. Discovery asks the provider for its real catalogue rather than accepting a typed guess."
        />

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className="mb-2 block font-mono text-xs uppercase tracking-[0.13em] text-[var(--text-muted)]">
              Provider
            </span>
            <select
              value={provider}
              onChange={(event) => {
                setProvider(event.target.value as (typeof PROVIDERS)[number]["id"]);
                setDiscovered([]);
                setSelectedModel("");
              }}
              className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text)]"
            >
              {PROVIDERS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void discoverModels()}
            disabled={pending !== null}
            className="btn btn-secondary btn-sm justify-center"
          >
            {pending === "discover" ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Search className="size-3.5" aria-hidden="true" />
            )}
            Discover models
          </button>
        </div>

        {discovered.length > 0 ? (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex-1">
              <span className="mb-2 block font-mono text-xs uppercase tracking-[0.13em] text-[var(--text-muted)]">
                Model
              </span>
              <select
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text)]"
              >
                {discovered.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.displayName}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void addModel()}
              disabled={pending !== null || !selectedModel}
              className="btn btn-primary justify-center"
            >
              {pending === "add" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="size-4" aria-hidden="true" />
              )}
              Add to catalogue
            </button>
          </div>
        ) : null}

        {message ? (
          <p className="mt-3 text-sm text-[var(--warning)]" aria-live="polite">
            {message}
          </p>
        ) : null}

        <div className="mt-5 space-y-3">
          {(payload?.providers ?? []).map((entry) => (
            <div key={entry.provider}>
              <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--text-faint)]">
                {entry.label}
              </p>
              {entry.configuredModels.length === 0 ? (
                <p className="mt-1.5 text-xs text-[var(--text-faint)]">No models configured.</p>
              ) : (
                <ul className="mt-2 grid gap-2 md:grid-cols-2">
                  {entry.configuredModels.map((model) => (
                    <li
                      key={model.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] p-2.5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-[var(--text)]">
                          {model.displayName}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-xs text-[var(--text-faint)]">
                          {model.model}
                        </span>
                      </span>
                      <StatusBadge tone={model.enabled ? "safe" : "neutral"}>
                        {model.isDefault ? "Default" : model.enabled ? "Enabled" : "Disabled"}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
