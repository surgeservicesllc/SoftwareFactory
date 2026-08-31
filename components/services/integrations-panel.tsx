"use client";

import { useCallback, useEffect, useState } from "react";
import { PlugZap } from "lucide-react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * What this workspace can actually do, per provider.
 *
 * The page exists so that **Not Connected** stops being a hard-coded
 * string in a component. Nine capabilities the competitors sell need an
 * account somebody has to open and pay for, and every surface that offers
 * one has to be able to ask a single question — is this live? — and get an
 * answer derived from a sealed credential really existing.
 *
 * Nothing here can turn a provider on. The switch expresses an intention;
 * the credential is supplied through the vault's own connect flow, which
 * never lets the value through a browser round-trip in the clear. So the
 * strongest thing an operator can do on this page is say "we intend to use
 * SMS", and the page will keep telling them it is not live until a
 * credential exists.
 */

const STANDING_COPY: Record<string, { label: string; tone: string; next: string }> = {
  live: {
    label: "Connected",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
    next: "Working. Everything below is available.",
  },
  failing: {
    label: "Failing",
    tone: "border-rose-200 bg-rose-50 text-rose-700",
    next: "A credential exists and the provider refused the last attempt.",
  },
  paused: {
    label: "Switched off",
    tone: "border-amber-200 bg-amber-50 text-amber-700",
    next: "Connected, but switched off here. Turn it on when you want it.",
  },
  awaiting_credential: {
    label: "Not Connected",
    tone: "border-slate-200 bg-slate-100 text-slate-600",
    next: "Configured, and waiting on an account. Connect the provider to finish it.",
  },
  not_configured: {
    label: "Not Connected",
    tone: "border-slate-200 bg-slate-100 text-slate-600",
    next: "Nothing set up yet.",
  },
};

type Provider = {
  provider: string;
  label: string;
  gates: string;
  configured: boolean;
  enabled: boolean;
  credentialPresent: boolean;
  live: boolean;
  displayLabel: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  standing: string;
};

type Counts = {
  total: number;
  live: number;
  paused: number;
  awaitingCredential: number;
  notConfigured: number;
  failing: number;
};

export function IntegrationsPanel() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/services/integrations", {
        headers: { accept: "application/json" },
      });
      const body = (await response.json()) as {
        providers?: Provider[];
        counts?: Counts;
        error?: { message?: string };
      };
      if (!response.ok) {
        setLoadError(body.error?.message ?? "Your integrations could not be loaded.");
        return;
      }
      setLoadError(null);
      setProviders(body.providers ?? []);
      setCounts(body.counts ?? null);
    } catch {
      setLoadError("Your integrations could not be loaded.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  const save = useCallback(
    async (provider: Provider, enabled: boolean) => {
      setSaving(provider.provider);
      setActionError(null);
      try {
        const response = await fetch("/api/services/integrations", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider: provider.provider,
            // A stable, derivable purpose name. The credential itself
            // lives in the vault under this string; nothing secret is in
            // this request.
            credentialPurpose: `crm_${provider.provider}_provider`,
            displayLabel: provider.displayLabel,
            enabled,
            settings: {},
          }),
        });
        if (!response.ok) {
          const body = (await response.json()) as { error?: { message?: string } };
          setActionError(body.error?.message ?? "That integration could not be saved.");
          return;
        }
        await refresh();
      } catch {
        setActionError("That integration could not be saved.");
      } finally {
        setSaving(null);
      }
    },
    [refresh],
  );

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="What this workspace can actually do, and what is waiting on an account somebody has to open."
      />

      {loadError !== null ? <Notice tone="warning">{loadError}</Notice> : null}
      {actionError !== null ? <Notice tone="warning">{actionError}</Notice> : null}

      <Card className="mb-6">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="integrations-figures">
          <Figure label="Connected" value={counts === null ? "—" : String(counts.live)} />
          <Figure
            label="Waiting on an account"
            value={counts === null ? "—" : String(counts.awaitingCredential + counts.notConfigured)}
            tone={
              (counts?.awaitingCredential ?? 0) + (counts?.notConfigured ?? 0) > 0 ? "amber" : undefined
            }
          />
          <Figure label="Switched off" value={counts === null ? "—" : String(counts.paused)} />
          <Figure
            label="Failing"
            value={counts === null ? "—" : String(counts.failing)}
            tone={(counts?.failing ?? 0) > 0 ? "rose" : undefined}
          />
        </dl>
        <Notice tone="info">
          Switching a provider on here records an intention, not a capability. Nothing becomes{" "}
          <strong>Connected</strong> until a credential for it actually exists — the page reads that
          from the sealed vault every time rather than from a stored status, so it cannot tell you a
          provider is working when it is not.
        </Notice>
      </Card>

      <Card>
        <SectionTitle
          title="Providers"
          description="Each row says what it unlocks, so a Not Connected label is a decision you can make rather than a word you have to interpret."
        />
        <ul className="mt-4 divide-y divide-line" data-testid="integrations-list">
          {providers.map((provider) => {
            const copy = STANDING_COPY[provider.standing] ?? STANDING_COPY.not_configured;
            return (
              <li key={provider.provider} className="py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{provider.label}</span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                          copy.tone,
                        )}
                        data-testid={`integration-standing-${provider.provider}`}
                      >
                        {copy.label}
                      </span>
                      {provider.credentialPresent ? (
                        <span className="text-xs text-faint">credential on file</span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-muted">{provider.gates}</p>
                    <p className="mt-1 text-xs text-faint">{copy.next}</p>
                    {provider.lastError === null ? null : (
                      <p className="mt-1 rounded-lg bg-rose-50 p-2 text-xs text-rose-800">
                        Last attempt: {provider.lastError}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={saving === provider.provider}
                    onClick={() => void save(provider, !provider.enabled)}
                    className={cn(
                      "btn shrink-0 px-3 py-2 text-sm",
                      provider.enabled ? "btn-secondary" : "btn-primary",
                    )}
                    data-testid={`integration-toggle-${provider.provider}`}
                  >
                    {saving === provider.provider
                      ? "Saving…"
                      : provider.enabled
                        ? "Switch off"
                        : "Switch on"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {providers.length === 0 && loadError === null ? (
          <p className="mt-4 text-sm text-muted" data-testid="integrations-empty">
            Loading providers…
          </p>
        ) : null}
      </Card>
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "amber" | "rose" }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <dt className="flex items-center gap-2 text-xs uppercase tracking-wide text-faint">
        <PlugZap className="size-3.5" aria-hidden="true" />
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "rose" ? "text-rose-700" : tone === "amber" ? "text-amber-700" : "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
