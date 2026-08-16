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
import { WorkerStatusBadge } from "@/components/worker-status";

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
  status: "connected" | "not_connected" | "error";
  statusLabel: "Connected" | "Not Connected" | "Error";
  statusReason: string | null;
  account: { login: string; type: string | null } | null;
  installation: {
    appId?: number;
    appSlug?: string;
    id: number;
    repositorySelection: string;
    suspendedAt: string | null;
    lastSyncedAt: string | null;
  } | null;
  repositories: Repository[];
};
type ConfiguredGithubApp = {
  appId: number;
  appSlug: string;
  slot: "candidate" | "primary";
};
type GithubProject = {
  connectionId: string | null;
  githubRepositoryId: number | null;
  id: string;
  name: string;
};
type HandoffIntent = {
  confirmation: string;
  projectId: string;
  rationale: string;
  rollbackPlan: string;
  targetConnectionId: string;
};

type LoadState = "loading" | "signed-out" | "onboarding" | "selection" | "ready" | "error";

const otherProviders = [
  { name: "Anthropic model adapter", connected: false },
  { name: "Vercel deployment adapter", connected: false },
  { name: "Supabase control plane", connected: true },
] as const;

export function ConnectionsConsole() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [connections, setConnections] = useState<GithubConnection[]>([]);
  const [configuredApps, setConfiguredApps] = useState<ConfiguredGithubApp[]>([]);
  const [projects, setProjects] = useState<GithubProject[]>([]);
  const [handoffIntent, setHandoffIntent] = useState<HandoffIntent | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<"onboarding" | "connect" | "sync" | "disconnect" | "handoff" | null>(null);

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

      const [connectionsResponse, appMetadataResponse, projectsResponse] = await Promise.all([
        fetch("/api/github/connections", { cache: "no-store" }),
        fetch("/api/github/install/start", { cache: "no-store" }),
        fetch("/api/projects", { cache: "no-store" }),
      ]);
      const connectionsBody = (await connectionsResponse.json()) as { connections?: GithubConnection[]; error?: { message?: string } };
      if (!connectionsResponse.ok && connectionsResponse.status !== 503) {
        throw new Error(connectionsBody.error?.message ?? "GitHub connections could not be loaded.");
      }
      setConnections(connectionsBody.connections ?? []);
      const appMetadataBody = (await appMetadataResponse.json()) as {
        apps?: ConfiguredGithubApp[];
        error?: { message?: string };
      };
      setConfiguredApps(appMetadataResponse.ok ? appMetadataBody.apps ?? [] : []);
      const projectsBody = (await projectsResponse.json()) as {
        projects?: GithubProject[];
      };
      setProjects(projectsResponse.ok ? projectsBody.projects ?? [] : []);
      if (connectionsResponse.status === 503) setMessage(connectionsBody.error?.message ?? "The GitHub App server configuration is not complete.");
      else if (!appMetadataResponse.ok) {
        setMessage(appMetadataBody.error?.message ?? "Replacement GitHub App configuration is unavailable.");
      }
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

  function connectGithub(appSlot: "candidate" | "primary" = "primary") {
    if (!organization) return;
    setPending("connect");
    setMessage("");
    // A single top-level navigation to the launcher, which sets the anti-forgery
    // state cookie on its own redirect response and forwards the browser to
    // GitHub. This deliberately does not POST-then-redirect: a cookie set on a
    // background fetch response is dropped by Safari's tracking prevention on
    // iOS/iPadOS, which broke the return leg only on those devices.
    const params = new URLSearchParams({
      appSlot,
      organizationId: organization.id,
      returnTo: "/solutions/connections",
    });
    // A full-page navigation, not router.push: the target is a route handler
    // that sets a cookie and 303s to github.com. A client-side navigation would
    // fetch it as RSC and follow neither the Set-Cookie nor the off-origin
    // redirect.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/api/github/install/launch?${params.toString()}`);
  }

  async function handoffProject(
    event: React.FormEvent<HTMLFormElement>,
    targetConnection: GithubConnection,
    project: GithubProject,
  ) {
    event.preventDefault();
    const sourceConnection = connections.find(
      (connection) => connection.id === project.connectionId,
    );
    const targetRepository = targetConnection.repositories.find(
      (repository) => repository.id === project.githubRepositoryId,
    );
    if (
      !sourceConnection?.installation
      || !targetConnection.installation
      || !targetRepository
      || !project.githubRepositoryId
    ) return;

    if (
      handoffIntent?.targetConnectionId !== targetConnection.id
      || handoffIntent.projectId !== project.id
    ) return;
    const confirmation = handoffIntent.confirmation.trim();
    const rationale = handoffIntent.rationale.trim();
    const rollbackPlan = handoffIntent.rollbackPlan.trim();
    if (
      confirmation !== "HANDOFF GITHUB PROJECT"
      || rationale.length < 20
      || rationale.length > 500
      || rollbackPlan.length < 20
      || rollbackPlan.length > 500
    ) return;

    setPending("handoff");
    setMessage("");
    try {
      const response = await fetch(
        `/api/github/connections/${targetConnection.id}/handoff`,
        {
          body: JSON.stringify({
            confirmation,
            fromConnectionId: sourceConnection.id,
            fromInstallationId: sourceConnection.installation.id,
            projectId: project.id,
            rationale,
            repositoryId: project.githubRepositoryId,
            rollbackPlan,
            toInstallationId: targetConnection.installation.id,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The GitHub App handoff failed safely.");
      setMessage(`${project.name} now uses installation #${targetConnection.installation.id}. Existing history was preserved.`);
      setHandoffIntent(null);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The GitHub App handoff failed safely.");
    } finally {
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

  const candidateApp = configuredApps.find((app) => app.slot === "candidate") ?? null;
  const hasCandidateInstallation = Boolean(candidateApp && connections.some(
    (connection) => connection.installation?.appId === candidateApp.appId
      && connection.status === "connected",
  ));
  function eligibleHandoffProjects(targetConnection: GithubConnection) {
    if (!candidateApp || targetConnection.status !== "connected" || !targetConnection.installation) return [];
    const candidateTarget = targetConnection.installation.appId === candidateApp.appId;
    const primaryTarget = configuredApps.some(
      (app) => app.slot === "primary" && app.appId === targetConnection.installation?.appId,
    );
    if (!candidateTarget && !primaryTarget) return [];
    const repositoryIds = new Set(targetConnection.repositories.map((repository) => repository.id));
    return projects.filter((project) => (
      project.connectionId
      && project.connectionId !== targetConnection.id
      && project.githubRepositoryId
      && repositoryIds.has(project.githubRepositoryId)
      && (candidateTarget || connections.some(
        (connection) => connection.id === project.connectionId
          && connection.installation?.appId === candidateApp.appId,
      ))
    ));
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
      <div className="space-y-4">
        <BlockedState
          icon={PlugZap}
          title="Connections are unavailable"
          description={message || "Your connections could not be loaded."}
        />
        <button type="button" onClick={() => void load()} className="btn btn-secondary">
          <RefreshCw className="size-4" aria-hidden="true" />
          Retry
        </button>
      </div>
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
                  <StatusBadge tone={connection.status === "connected" ? "safe" : connection.status === "error" ? "danger" : "warning"}>
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
                {connection.installation ? (
                  <p className="mt-1 text-sm text-faint">
                    {connection.installation.appSlug ? `${connection.installation.appSlug} · ` : ""}Installation #{connection.installation.id} · Repository access: {formatRepositorySelection(connection.installation.repositorySelection)}
                  </p>
                ) : null}
              </div>
              {connection.installation ? (
                <div className="flex flex-wrap gap-2 sm:shrink-0">
                  <button type="button" onClick={() => syncConnection(connection.id)} disabled={pending !== null} className="btn btn-secondary btn-sm">
                    <RefreshCw className={`size-4 ${pending === "sync" ? "animate-spin" : ""}`} aria-hidden="true" />
                    Refresh
                  </button>
                  <a href={githubInstallationManagementUrl(connection)} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                    Manage on GitHub
                    <ExternalLink className="size-4" aria-hidden="true" />
                  </a>
                  <button type="button" onClick={() => void disconnectConnection(connection)} disabled={pending !== null} className="btn btn-danger btn-sm">
                    {pending === "disconnect" ? <Loader2 className="size-4 animate-spin" /> : null}
                    Disconnect
                  </button>
                  {eligibleHandoffProjects(connection).map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => {
                        setMessage("");
                        setHandoffIntent({
                          confirmation: "",
                          projectId: project.id,
                          rationale: "",
                          rollbackPlan: `Reverse the handoff to installation #${project.connectionId === connection.id ? "the prior live installation" : connections.find((item) => item.id === project.connectionId)?.installation?.id ?? "the prior live installation"} and verify repository reads.`,
                          targetConnectionId: connection.id,
                        });
                      }}
                      disabled={pending !== null || organization?.role !== "owner"}
                      className="btn btn-primary btn-sm"
                    >
                      {pending === "handoff" ? <Loader2 className="size-4 animate-spin" /> : null}
                      Activate for {project.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {eligibleHandoffProjects(connection).map((project) => (
              handoffIntent?.targetConnectionId === connection.id
              && handoffIntent.projectId === project.id ? (
                <form
                  key={`handoff-${project.id}`}
                  className="grid gap-4 border-t border-line bg-surface-muted p-5"
                  onSubmit={(event) => void handoffProject(event, connection, project)}
                >
                  <div>
                    <p className="font-medium text-foreground">Approve RED GitHub App handoff for {project.name}</p>
                    <p className="mt-1 text-sm text-muted">
                      The existing project ID and history are preserved. No merge, deploy, or default-branch write is authorized.
                    </p>
                  </div>
                  <label className="grid gap-1 text-sm text-muted">
                    Type HANDOFF GITHUB PROJECT
                    <input
                      className="input"
                      value={handoffIntent.confirmation}
                      onChange={(event) => setHandoffIntent({ ...handoffIntent, confirmation: event.target.value })}
                      autoComplete="off"
                      required
                    />
                  </label>
                  <label className="grid gap-1 text-sm text-muted">
                    Rationale (20–500 characters)
                    <textarea
                      className="input min-h-24 py-3"
                      value={handoffIntent.rationale}
                      onChange={(event) => setHandoffIntent({ ...handoffIntent, rationale: event.target.value })}
                      minLength={20}
                      maxLength={500}
                      required
                    />
                  </label>
                  <label className="grid gap-1 text-sm text-muted">
                    Rollback and containment plan (20–500 characters)
                    <textarea
                      className="input min-h-24 py-3"
                      value={handoffIntent.rollbackPlan}
                      onChange={(event) => setHandoffIntent({ ...handoffIntent, rollbackPlan: event.target.value })}
                      minLength={20}
                      maxLength={500}
                      required
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" disabled={pending !== null} className="btn btn-danger btn-sm">
                      {pending === "handoff" ? <Loader2 className="size-4 animate-spin" /> : null}
                      Approve and hand off
                    </button>
                    <button type="button" onClick={() => setHandoffIntent(null)} disabled={pending !== null} className="btn btn-secondary btn-sm">
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null
            ))}

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
            ) : (
              <p className="border-t border-line p-5 text-sm text-muted">
                No active selected repositories. Manage the installation on GitHub, select at least one repository, then refresh.
              </p>
            )}
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
            <button type="button" onClick={() => void connectGithub("primary")} disabled={pending !== null} className="btn btn-primary mt-5">
              {pending === "connect" ? <Loader2 className="size-4 animate-spin" /> : <GitFork className="size-4" />}
              Connect GitHub
            </button>
          </div>
        </Card>
      )}

      {connections.length ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void connectGithub("primary")} disabled={pending !== null} className="btn btn-secondary">
            {pending === "connect" ? <Loader2 className="size-4 animate-spin" /> : <GitFork className="size-4" />}
            Connect another account
          </button>
          {candidateApp && !hasCandidateInstallation ? (
            <button type="button" onClick={() => void connectGithub("candidate")} disabled={pending !== null} className="btn btn-primary">
              {pending === "connect" ? <Loader2 className="size-4 animate-spin" /> : <GitFork className="size-4" />}
              Install replacement GitHub App
            </button>
          ) : null}
        </div>
      ) : null}

      <Card className="p-5">
        <p className="label">Other providers</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          <li className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
            <span className="text-sm font-medium text-foreground">OpenAI Codex worker</span>
            <WorkerStatusBadge />
          </li>
          {otherProviders.map(({ name, connected }) => (
            <li key={name} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
              <span className="text-sm font-medium text-foreground">{name}</span>
              {connected ? <StatusBadge tone="safe">Connected</StatusBadge> : <NotConnectedBadge />}
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-sm text-muted">
        Access tokens are created on the server, expire quickly, and are never sent to your browser or
        stored in the database.{" "}
        <Link href="/solutions/settings" className="font-medium text-accent-text underline underline-offset-4">
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

function formatRepositorySelection(value: string) {
  return value === "all" ? "All repositories" : value === "selected" ? "Selected repositories" : "Unknown";
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
