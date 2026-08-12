"use client";

import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  GitFork,
  Loader2,
  PlugZap,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { BlockedState, Card, NotConnectedBadge, StatusBadge } from "@/components/ui";

type Organization = { id: string; name: string; slug: string; role: string };
type Repository = {
  id: number;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  archived: boolean;
  disabled: boolean;
  htmlUrl: string;
  selected: boolean;
};
type GithubConnection = {
  id: string;
  name: string;
  status: string;
  statusLabel: "Connected" | "Not Connected";
  statusReason: string | null;
  account: { login: string; type: string | null } | null;
  installation: { id: number; repositorySelection: string; suspendedAt: string | null; lastSyncedAt: string | null } | null;
  repositories: Repository[];
};

type LoadState = "loading" | "signed-out" | "onboarding" | "selection" | "ready" | "error";

const otherProviders = ["OpenAI", "Anthropic", "Vercel", "Supabase"] as const;

export function ConnectionsConsole() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [connections, setConnections] = useState<GithubConnection[]>([]);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<"onboarding" | "connect" | "sync" | "disconnect" | null>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const organizationsResponse = await fetch("/api/organizations", { cache: "no-store" });
      if (organizationsResponse.status === 401) {
        setLoadState("signed-out");
        return;
      }
      const organizationsBody = (await organizationsResponse.json()) as {
        activeOrganizationId?: string | null;
        organizations?: Organization[];
        error?: { message?: string };
      };
      if (!organizationsResponse.ok) throw new Error(organizationsBody.error?.message ?? "Organizations could not be loaded.");
      const availableOrganizations = organizationsBody.organizations ?? [];
      setOrganizations(availableOrganizations);
      const active = availableOrganizations.find((item) => item.id === organizationsBody.activeOrganizationId)
        ?? (availableOrganizations.length === 1 ? availableOrganizations[0] : null);
      if (!active) {
        setLoadState(availableOrganizations.length ? "selection" : "onboarding");
        return;
      }
      setOrganization(active);

      const connectionsResponse = await fetch("/api/github/connections", { cache: "no-store" });
      const connectionsBody = (await connectionsResponse.json()) as { connections?: GithubConnection[]; error?: { message?: string } };
      if (!connectionsResponse.ok && connectionsResponse.status !== 503) {
        throw new Error(connectionsBody.error?.message ?? "GitHub connections could not be loaded.");
      }
      setConnections(connectionsBody.connections ?? []);
      if (connectionsResponse.status === 503) setMessage(connectionsBody.error?.message ?? "The GitHub App server configuration is not complete.");
      setLoadState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connections could not be loaded.");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function selectOrganization(organizationId: string) {
    setPending("onboarding");
    setMessage("");
    try {
      const response = await fetch("/api/organizations/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The organization could not be selected.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Organization selection failed.");
    } finally {
      setPending(null);
    }
  }

  async function createOrganization(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("onboarding");
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationName: String(form.get("organizationName") ?? "") }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The organization could not be created.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Onboarding failed.");
    } finally {
      setPending(null);
    }
  }

  async function connectGithub() {
    if (!organization) return;
    setPending("connect");
    setMessage("");
    try {
      const response = await fetch("/api/github/install/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: organization.id, returnTo: "/connections" }),
      });
      const body = (await response.json()) as { authorizationUrl?: string; error?: { message?: string } };
      if (!response.ok || !body.authorizationUrl) throw new Error(body.error?.message ?? "GitHub authorization could not start.");
      window.location.assign(body.authorizationUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "GitHub authorization failed.");
      setPending(null);
    }
  }

  async function syncConnection(connectionId: string) {
    setPending("sync");
    setMessage("");
    try {
      const response = await fetch(`/api/github/connections/${connectionId}/sync`, { method: "POST" });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The GitHub connection could not be synchronized.");
      setMessage("Repositories and branches are up to date.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "GitHub sync failed.");
    } finally {
      setPending(null);
    }
  }

  /*
   * Disconnecting revokes repository access for the whole organization, so it
   * keeps a typed confirmation rather than a single click.
   */
  async function disconnectConnection(connection: GithubConnection) {
    if (!connection.installation) return;
    const confirmation = window.prompt(
      `Disconnect GitHub installation #${connection.installation.id}?\n\nSoftwareFactory will lose access to these repositories. Your projects and history are kept.\n\nType DISCONNECT GITHUB to confirm.`,
    );
    if (confirmation !== "DISCONNECT GITHUB") return;
    setPending("disconnect");
    setMessage("");
    try {
      const response = await fetch(`/api/github/connections/${connection.id}/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation, installationId: connection.installation.id }),
      });
      const body = (await response.json()) as { affectedProjectCount?: number; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The GitHub connection could not be disconnected.");
      setMessage(`GitHub disconnected. ${body.affectedProjectCount ?? 0} project(s) kept their history.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "GitHub disconnect failed safely.");
    } finally {
      setPending(null);
    }
  }

  if (loadState === "loading") {
    return (
      <Card className="grid min-h-64 place-items-center">
        <Loader2 className="size-6 animate-spin text-accent" aria-label="Loading connections" />
      </Card>
    );
  }

  if (loadState === "signed-out") {
    return (
      <BlockedState
        icon={PlugZap}
        title="Sign in first"
        description="You need to be signed in as the owner before connecting GitHub."
        href="/auth/sign-in?next=/connections"
        label="Sign in"
      />
    );
  }

  if (loadState === "error") {
    return (
      <BlockedState
        icon={PlugZap}
        title="Connections are unavailable"
        description={message || "Your connections could not be loaded."}
      />
    );
  }

  if (loadState === "onboarding") {
    return (
      <Card className="mx-auto grid min-h-64 max-w-lg place-items-center p-8 text-center">
        <div>
          <PlugZap className="mx-auto size-8 text-faint" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-semibold text-foreground">Name your workspace</h2>
          <p className="mt-2 text-muted">
            This groups your projects and connections. You become its owner.
          </p>
          <form onSubmit={createOrganization} className="mt-5 flex flex-col gap-2 sm:flex-row">
            <input
              name="organizationName"
              required
              minLength={2}
              placeholder="Acme Engineering"
              aria-label="Workspace name"
              className="input flex-1"
            />
            <button disabled={pending === "onboarding"} className="btn btn-primary shrink-0">
              {pending === "onboarding" ? <Loader2 className="size-4 animate-spin" /> : null}
              Create
            </button>
          </form>
          {message ? <p className="mt-3 text-sm text-[var(--warning)]">{message}</p> : null}
        </div>
      </Card>
    );
  }

  if (loadState === "selection") {
    return (
      <Card className="mx-auto grid min-h-64 max-w-lg place-items-center p-8 text-center">
        <div>
          <PlugZap className="mx-auto size-8 text-faint" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-semibold text-foreground">Choose a workspace</h2>
          <p className="mt-2 text-muted">Pick the one whose GitHub connection you want to manage.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {organizations.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void selectOrganization(item.id)}
                disabled={pending !== null}
                className="btn btn-secondary"
              >
                {item.name}
                <ArrowRight className="size-4" aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {message ? (
        <p className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning)]" aria-live="polite">
          {message}
        </p>
      ) : null}

      {connections.length ? (
        connections.map((connection) => (
          <Card key={connection.id} className="overflow-hidden">
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <GitFork className="size-5 shrink-0 text-foreground" aria-hidden="true" />
                  <h2 className="text-lg font-semibold text-foreground">
                    {connection.account?.login ?? connection.name}
                  </h2>
                  <StatusBadge tone={connection.status === "connected" ? "safe" : "warning"}>
                    {connection.statusLabel}
                  </StatusBadge>
                </div>
                {connection.statusReason ? (
                  <p className="mt-2 text-sm text-[var(--warning)]">{connection.statusReason}</p>
                ) : null}
                <p className="mt-2 text-sm text-muted">
                  {connection.repositories.length} repositor{connection.repositories.length === 1 ? "y" : "ies"} ·
                  Last checked {formatDate(connection.installation?.lastSyncedAt ?? null)}
                </p>
              </div>
              {connection.installation ? (
                <div className="flex flex-wrap gap-2 sm:shrink-0">
                  <button type="button" onClick={() => syncConnection(connection.id)} disabled={pending !== null} className="btn btn-secondary btn-sm">
                    <RefreshCw className={`size-4 ${pending === "sync" ? "animate-spin" : ""}`} aria-hidden="true" />
                    Refresh
                  </button>
                  <a href={`https://github.com/settings/installations/${connection.installation.id}`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                    Manage on GitHub
                    <ExternalLink className="size-4" aria-hidden="true" />
                  </a>
                  <button type="button" onClick={() => void disconnectConnection(connection)} disabled={pending !== null} className="btn btn-danger btn-sm">
                    {pending === "disconnect" ? <Loader2 className="size-4 animate-spin" /> : null}
                    Disconnect
                  </button>
                </div>
              ) : null}
            </div>

            {connection.repositories.length ? (
              <div className="border-t border-line p-5">
                <p className="label">Repositories SoftwareFactory can read</p>
                <ul className="mt-3 grid gap-2 md:grid-cols-2">
                  {connection.repositories.map((repository) => (
                    <li key={repository.id}>
                      <a
                        href={repository.htmlUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-3 rounded-lg border border-line p-3 transition-colors hover:border-line-strong"
                      >
                        <CheckCircle2 className="size-4 shrink-0 text-accent" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{repository.fullName}</span>
                          <span className="block text-sm text-faint">
                            {repository.defaultBranch} · {repository.private ? "Private" : "Public"}
                          </span>
                        </span>
                        <ExternalLink className="size-4 shrink-0 text-faint" aria-hidden="true" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        ))
      ) : (
        <Card className="grid min-h-64 place-items-center p-8 text-center">
          <div className="max-w-md">
            <GitFork className="mx-auto size-8 text-faint" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold text-foreground">Connect GitHub to begin</h2>
            <p className="mt-2 text-muted">
              You will authorize the app on GitHub, then choose exactly which repositories it may read.
              You can change or remove that access at any time.
            </p>
            <button type="button" onClick={connectGithub} disabled={pending !== null} className="btn btn-primary mt-5">
              {pending === "connect" ? <Loader2 className="size-4 animate-spin" /> : <GitFork className="size-4" />}
              Connect GitHub
            </button>
          </div>
        </Card>
      )}

      {connections.length ? (
        <button type="button" onClick={connectGithub} disabled={pending !== null} className="btn btn-secondary">
          {pending === "connect" ? <Loader2 className="size-4 animate-spin" /> : <GitFork className="size-4" />}
          Connect another account
        </button>
      ) : null}

      <Card className="p-5">
        <p className="label">Other providers</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {otherProviders.map((name) => (
            <li key={name} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
              <span className="text-sm font-medium text-foreground">{name}</span>
              <NotConnectedBadge />
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-sm text-muted">
        Access tokens are created on the server, expire quickly, and are never sent to your browser or
        stored in the database.{" "}
        <Link href="/settings" className="font-medium text-accent-text underline underline-offset-4">
          See what it may do
        </Link>
      </p>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) return "never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
