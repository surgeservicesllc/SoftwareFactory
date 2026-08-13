"use client";

import {
  ArrowRight,
  Box,
  CheckCircle2,
  Cloud,
  Database,
  ExternalLink,
  GitFork,
  KeyRound,
  Loader2,
  PlugZap,
  RefreshCw,
  ShieldAlert,
  Waypoints,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { NotConnectedBadge, Card, StatusBadge } from "@/components/ui";

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
    const callbackNotice = readGitHubCallbackNotice(window.location.search);
    const timer = window.setTimeout(() => {
      if (callbackNotice) setMessage(callbackNotice);
      void load();
    }, 0);
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
      setMessage("GitHub account, repositories, and default branches synchronized.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "GitHub sync failed.");
    } finally {
      setPending(null);
    }
  }

  async function disconnectConnection(connection: GithubConnection) {
    if (!connection.installation) return;
    const confirmation = window.prompt(
      `Disconnect installation #${connection.installation.id} from SoftwareFactory? Project history will be preserved.\n\nType DISCONNECT GITHUB to continue.`,
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
      setMessage(`GitHub disconnected. ${body.affectedProjectCount ?? 0} affected project(s) retain their history.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "GitHub disconnect failed safely.");
    } finally {
      setPending(null);
    }
  }

  if (loadState === "loading") {
    return <Card className="grid min-h-64 place-items-center"><Loader2 className="size-6 animate-spin text-[var(--accent)]" aria-label="Loading connections" /></Card>;
  }

  if (loadState === "signed-out") {
    return <SetupNotice title="Authentication required" description="Sign in with the SoftwareFactory owner account before connecting GitHub." action={<Link href="/sign-in?next=/connections" className="btn btn-primary">Sign in<ArrowRight className="size-4" /></Link>} />;
  }

  if (loadState === "onboarding") {
    return (
      <SetupNotice
        title="Create the control-plane organization"
        description="The first authenticated user becomes its owner. GitHub connections and projects remain tenant-scoped through Supabase RLS."
        action={
          <form onSubmit={createOrganization} className="mt-4 flex w-full max-w-md flex-col gap-2 sm:flex-row">
            <input name="organizationName" required minLength={2} placeholder="Engineering organization" aria-label="Organization name" className="h-10 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] px-3 text-xs text-white focus:border-[var(--accent)] focus:outline-none" />
            <button disabled={pending === "onboarding"} className="btn btn-primary justify-center">{pending === "onboarding" ? <Loader2 className="size-4 animate-spin" /> : null}Create organization</button>
          </form>
        }
      />
    );
  }

  if (loadState === "selection") {
    return (
      <SetupNotice
        title="Select an organization"
        description="Choose the tenant whose GitHub installations and projects you want to manage."
        action={<div className="mt-4 flex flex-wrap justify-center gap-2">{organizations.map((item) => <button key={item.id} type="button" onClick={() => void selectOrganization(item.id)} disabled={pending !== null} className="btn btn-secondary btn-sm">{item.name}<ArrowRight className="size-3.5" /></button>)}</div>}
      />
    );
  }

  if (loadState === "error") {
    return (
      <SetupNotice
        title="Connections unavailable"
        description={message || "The live connection service could not be reached."}
        action={<button type="button" onClick={() => void load()} className="btn btn-secondary btn-sm"><RefreshCw className="size-3.5" />Retry</button>}
      />
    );
  }

  return (
    <div className="space-y-5">
      <Card className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]"><KeyRound className="size-4 text-[var(--accent)]" />Secret-safe GitHub App connection</div>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">Installation tokens are minted server-side, expire quickly, and are never returned to the browser or stored in Supabase. Database rows contain only installation and repository metadata.</p>
          {message ? <p className="mt-3 flex items-start gap-2 text-sm text-[var(--warning)]" aria-live="polite"><ShieldAlert className="mt-0.5 size-3.5 shrink-0" />{message}</p> : null}
        </div>
        <button type="button" onClick={connectGithub} disabled={pending !== null} className="btn btn-primary justify-center">
          {pending === "connect" ? <Loader2 className="size-4 animate-spin" /> : <GitFork className="size-4" />}
          {connections.length ? "Connect another GitHub account" : "Connect GitHub"}
        </button>
      </Card>

      {connections.length ? (
        <div className="space-y-4">
          {connections.map((connection) => (
            <Card key={connection.id} className="overflow-hidden">
              <div className="flex flex-col gap-4 border-b border-[var(--border)] p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
                <div>
                  <div className="flex items-center gap-2"><GitFork className="size-4 text-[var(--accent)]" /><h2 className="text-base font-semibold text-white">{connection.account?.login ?? connection.name}</h2><StatusBadge tone={connection.status === "connected" ? "safe" : "warning"}>{connection.statusLabel}</StatusBadge></div>
                  {connection.statusReason ? <p className="mt-2 text-xs text-[var(--warning)]">{connection.statusReason}</p> : null}
                  <dl className="mt-4 grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 text-sm">
                    <dt className="text-[var(--text-faint)]">Type</dt><dd className="text-[var(--text)]">GitHub App{connection.account?.type ? ` · ${connection.account.type}` : ""}</dd>
                    <dt className="text-[var(--text-faint)]">Installation</dt><dd className="font-mono text-[var(--text)]">{connection.installation ? `#${connection.installation.id}` : "Not Connected"}</dd>
                    <dt className="text-[var(--text-faint)]">Repositories</dt><dd className="text-[var(--text)]">{connection.repositories.length}</dd>
                    <dt className="text-[var(--text-faint)]">Last sync</dt><dd className="text-[var(--text)]">{formatDate(connection.installation?.lastSyncedAt ?? null)}</dd>
                  </dl>
                </div>
                <div className="flex gap-2">
                  {connection.installation ? <><button type="button" onClick={() => syncConnection(connection.id)} disabled={pending !== null} className="btn btn-secondary btn-sm"><RefreshCw className={`size-3.5 ${pending === "sync" ? "animate-spin" : ""}`} />Sync</button>
                  <a href={githubInstallationManagementUrl(connection)} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">Manage<ExternalLink className="size-3.5" /></a>
                  <button type="button" onClick={() => void disconnectConnection(connection)} disabled={pending !== null} className="btn btn-secondary btn-sm border-[var(--danger-border)] text-[var(--danger)]">{pending === "disconnect" ? <Loader2 className="size-3.5 animate-spin" /> : null}Disconnect</button></> : null}
                </div>
              </div>
              <div className="p-5 sm:p-6">
                <p className="label">Repositories</p>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {connection.repositories.map((repository) => (
                    <a key={repository.id} href={repository.htmlUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] p-3.5 hover:border-[var(--border-strong)]">
                      <CheckCircle2 className="size-4 shrink-0 text-[var(--accent)]" />
                      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-[var(--text)]">{repository.fullName}</span><span className="mt-1 block font-mono text-xs text-[var(--text-faint)]">{repository.defaultBranch} · {repository.private ? "private" : "public"}</span></span>
                      <ExternalLink className="size-3.5 text-[var(--text-faint)]" />
                    </a>
                  ))}
                  {!connection.repositories.length ? <p className="text-xs text-[var(--text-muted)]">No active selected repositories.</p> : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <SetupNotice title="No GitHub App installation connected" description="Choose Connect GitHub, authorize the app, select the intended account or organization, and grant access only to the repositories SoftwareFactory should manage." />
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {[
          { name: "OpenAI model adapter", Icon: Waypoints, connected: false },
          { name: "Anthropic model adapter", Icon: Waypoints, connected: false },
          { name: "Vercel deployment adapter", Icon: Cloud, connected: false },
          { name: "Supabase control plane", Icon: Database, connected: true },
          { name: "Other providers", Icon: Box, connected: false },
        ].map(({ name, Icon, connected }) => (
          <Card key={name} className="p-4"><Icon className="size-4 text-[var(--text-muted)]" /><h3 className="mt-3 text-xs font-semibold text-[var(--text)]">{name}</h3><div className="mt-3">{connected ? <StatusBadge tone="safe">Connected</StatusBadge> : <NotConnectedBadge />}</div></Card>
        ))}
      </div>
    </div>
  );
}

function SetupNotice({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <Card className="grid min-h-64 place-items-center p-6 text-center"><div className="max-w-lg"><span className="mx-auto grid size-11 place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--accent-text)]"><PlugZap className="size-5" /></span><h2 className="mt-4 text-base font-semibold text-white">{title}</h2><p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">{description}</p>{action ? <div className="mt-4 flex justify-center">{action}</div> : null}</div></Card>;
}

function formatDate(value: string | null) {
  if (!value) return "Not synchronized";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function readGitHubCallbackNotice(search: string) {
  const params = new URLSearchParams(search);
  if (params.get("github") === "connected") {
    const repositories = params.get("repositories");
    const repositoryCount = repositories && /^\d{1,6}$/.test(repositories)
      ? Number(repositories)
      : null;
    return repositoryCount === null
      ? "GitHub installation connected and synchronized."
      : `GitHub installation connected with ${repositoryCount} selected repositor${repositoryCount === 1 ? "y" : "ies"}.`;
  }

  if (params.get("github") !== "error") return "";
  const code = params.get("githubError") ?? "";
  const message = params.get("githubMessage") ?? "";
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(code)) {
    return "GitHub authorization could not be completed safely.";
  }
  if (!message || message.length > 240 || /[\u0000-\u001f\u007f]/.test(message)) {
    return `GitHub authorization could not be completed safely (${code}).`;
  }
  return `${message} (${code})`;
}

function githubInstallationManagementUrl(connection: Pick<GithubConnection, "account" | "installation">) {
  if (!connection.installation) return "https://github.com/settings/installations";
  if (connection.account?.type === "Organization" && connection.account.login) {
    return `https://github.com/organizations/${encodeURIComponent(connection.account.login)}/settings/installations/${connection.installation.id}`;
  }
  return `https://github.com/settings/installations/${connection.installation.id}`;
}
