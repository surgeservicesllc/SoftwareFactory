"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleDotDashed,
  ExternalLink,
  FolderTree,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  GitPullRequestArrow,
  Loader2,
  Plus,
  RefreshCw,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { BlockedState, Card, SectionTitle, StatusBadge } from "@/components/ui";
import { cn } from "@/lib/cn";

type Repository = {
  id: number;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  archived: boolean;
  disabled?: boolean;
  htmlUrl: string;
  selected: boolean;
  lastSyncedAt?: string | null;
};

type Connection = {
  id: string;
  name?: string;
  status: "connected" | "not_connected";
  statusLabel: string;
  account: { login: string; type: string } | null;
  installation: { id: number; lastSyncedAt: string | null; suspendedAt: string | null } | null;
  repositories: Repository[];
};

type Project = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  githubRepository: string | null;
  defaultBranch: string;
  healthStatus: string;
  autonomousMode: boolean;
  maximumAutonomousRisk: string;
  connectionId: string | null;
  connectionStatus: "connected" | "not_connected";
};

type Branch = { name: string; sha: string; protected: boolean };
type Commit = { sha: string; message: string; author: { name: string; githubLogin: string | null }; date: string | null; url: string };
type PullRequest = {
  id: number;
  number: number;
  title: string;
  state: string;
  draft: boolean;
  url: string;
  headBranch: string;
  baseBranch: string;
  headSha: string;
  author?: { login: string; avatarUrl: string | null } | null;
  createdAt?: string;
  updatedAt: string;
  mergeability?: "mergeable" | "conflicting" | "unknown";
};
type CheckRun = { id: number; name: string; status: string; conclusion: string | null; url: string | null; startedAt: string | null; completedAt: string | null };
type InspectorData = { branches: Branch[]; commits: Commit[]; pullRequests: PullRequest[]; checkRuns: CheckRun[]; warnings: string[] };
type State = "loading" | "signed-out" | "setup" | "ready" | "error";

const emptyInspector: InspectorData = { branches: [], commits: [], pullRequests: [], checkRuns: [], warnings: [] };

export function ProjectsConsole() {
  const [state, setState] = useState<State>("loading");
  const [projects, setProjects] = useState<Project[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [repositoryId, setRepositoryId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const [projectsResponse, connectionsResponse] = await Promise.all([
        fetch("/api/projects", { cache: "no-store" }),
        fetch("/api/github/connections", { cache: "no-store" }),
      ]);
      if (projectsResponse.status === 401 || connectionsResponse.status === 401) {
        setState("signed-out");
        return;
      }
      if (projectsResponse.status === 409 || connectionsResponse.status === 409) {
        setState("setup");
        return;
      }
      const projectsBody = (await projectsResponse.json()) as { projects?: Project[]; error?: { message?: string } };
      const connectionsBody = (await connectionsResponse.json()) as { connections?: Connection[]; error?: { message?: string } };
      if (!projectsResponse.ok) throw new Error(projectsBody.error?.message ?? "Projects could not be loaded.");
      if (!connectionsResponse.ok) throw new Error(connectionsBody.error?.message ?? "GitHub connections could not be loaded.");
      setProjects(projectsBody.projects ?? []);
      setConnections(connectionsBody.connections ?? []);
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Projects could not be loaded.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const connectedConnections = useMemo(
    () => connections.filter((connection) => connection.status === "connected" && connection.account && connection.installation && !connection.installation.suspendedAt),
    [connections],
  );
  const activeConnectionId = connectionId || connectedConnections[0]?.id || "";
  const selectedConnection = connectedConnections.find((connection) => connection.id === activeConnectionId) ?? connectedConnections[0];
  const availableRepositories = useMemo(
    () => selectedConnection?.repositories.filter((repository) => repository.selected && !repository.archived && !repository.disabled) ?? [],
    [selectedConnection],
  );
  const unconnectedRepositories = useMemo(
    () => availableRepositories.filter((repository) => !projects.some((project) => project.githubRepository?.toLowerCase() === repository.fullName.toLowerCase())),
    [availableRepositories, projects],
  );
  const selectedRepository = unconnectedRepositories.find((repository) => String(repository.id) === repositoryId) ?? unconnectedRepositories[0];

  useEffect(() => {
    if (!selectedRepository || !selectedConnection) return;
    const repository = selectedRepository.fullName.split("/")[1];
    if (!repository) return;
    const timer = window.setTimeout(() => {
      setRepositoryId(String(selectedRepository.id));
      setName((current) => current || repository);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedConnection, selectedRepository]);

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedConnection || !selectedRepository) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: selectedConnection.id,
          repositoryId: selectedRepository.id,
          name,
          description,
          defaultBranch: selectedRepository.defaultBranch,
        }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The project could not be added.");
      setMessage(`${name} is connected. Its live GitHub data is below.`);
      setName("");
      setDescription("");
      setRepositoryId("");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The project could not be added.");
    } finally {
      setSaving(false);
    }
  }

  if (state === "loading") {
    return (
      <Card className="grid min-h-64 place-items-center">
        <Loader2 className="size-6 animate-spin text-accent" aria-label="Loading projects" />
      </Card>
    );
  }
  if (state === "signed-out") return <BlockedState icon={FolderTree} title="Sign in to see your projects" description="Projects belong to your organization." href="/auth/sign-in?next=/projects" label="Sign in" />;
  if (state === "setup") return <BlockedState icon={FolderTree} title="Finish setting up" description="Create or choose a workspace before linking a repository." href="/connections" label="Open connections" />;
  if (state === "error") return <BlockedState icon={FolderTree} title="Projects are unavailable" description={message || "Your projects could not be loaded."} href="/connections" label="Check connections" />;

  return (
    <div className="space-y-4">
      {projects.map((project) => (
        <ProjectInspector
          key={project.id}
          project={project}
          connection={connections.find((item) => item.id === project.connectionId) ?? null}
        />
      ))}

      {!connectedConnections.length ? (
        <BlockedState
          icon={GitFork}
          title="Connect GitHub first"
          description="A repository becomes a project only after you have authorized GitHub."
          href="/connections"
          label="Connect GitHub"
        />
      ) : unconnectedRepositories.length || !projects.length ? (
        <Card className="p-5 sm:p-6">
          <SectionTitle
            title="Add a project"
            description="Pick one of the repositories you authorized. The branch comes straight from GitHub."
          />

          <form onSubmit={createProject} className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="project-connection" className="field-label">GitHub account</label>
              <select
                id="project-connection"
                value={activeConnectionId}
                onChange={(event) => { setConnectionId(event.target.value); setRepositoryId(""); setName(""); }}
                className="input"
              >
                {connectedConnections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.account?.login ?? connection.name ?? "GitHub"}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="project-repository" className="field-label">Repository</label>
              <select
                id="project-repository"
                value={repositoryId}
                onChange={(event) => {
                  setRepositoryId(event.target.value);
                  const repo = unconnectedRepositories.find((item) => String(item.id) === event.target.value);
                  setName(repo?.fullName.split("/")[1] ?? "");
                }}
                className="input"
              >
                {unconnectedRepositories.map((repository) => (
                  <option key={repository.id} value={repository.id}>{repository.fullName}</option>
                ))}
              </select>
              <span className="field-hint">
                Branch: {selectedRepository?.defaultBranch ?? "—"} (set by GitHub)
              </span>
            </div>

            <div>
              <label htmlFor="project-name" className="field-label">Name it</label>
              <input
                id="project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                minLength={1}
                maxLength={160}
                className="input"
              />
            </div>

            <div>
              <label htmlFor="project-description" className="field-label">
                What is it? <span className="font-normal text-faint">(optional)</span>
              </label>
              <input
                id="project-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={2000}
                className="input"
                placeholder="Customer-facing web app"
              />
            </div>

            <div className="md:col-span-2">
              <button type="submit" disabled={saving || !selectedRepository || !name.trim()} className="btn btn-primary">
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Add project
              </button>
              <p className="mt-3 text-sm text-muted">
                New projects start with everything automatic switched off.
              </p>
            </div>
          </form>

          {message ? <p className="mt-4 text-sm text-[var(--warning)]" aria-live="polite">{message}</p> : null}
        </Card>
      ) : (
        <p className="text-sm text-muted">Every repository you authorized is already a project.</p>
      )}
    </div>
  );
}

function ProjectInspector({ project, connection }: { project: Project; connection: Connection | null }) {
  const [data, setData] = useState<InspectorData>(emptyInspector);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const repository = connection?.repositories.find((item) => item.fullName.toLowerCase() === project.githubRepository?.toLowerCase());
  const isConnected = project.connectionStatus === "connected"
    && connection?.status === "connected"
    && Boolean(connection.installation)
    && !connection.installation?.suspendedAt
    && Boolean(repository);
  const coordinates = project.githubRepository?.split("/") ?? [];
  const owner = coordinates[0] ?? "";
  const repo = coordinates[1] ?? "";

  const refresh = useCallback(async () => {
    if (!project.connectionId || !owner || !repo || !isConnected) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const base = `/api/github/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
      const query = `connectionId=${encodeURIComponent(project.connectionId)}`;
      const results = await Promise.allSettled([
        fetch(`${base}/branches?${query}`, { cache: "no-store" }),
        fetch(`${base}/commits?${query}&sha=${encodeURIComponent(project.defaultBranch)}&perPage=5`, { cache: "no-store" }),
        fetch(`${base}/pulls?${query}`, { cache: "no-store" }),
        fetch(`${base}/checks?${query}&ref=${encodeURIComponent(project.defaultBranch)}`, { cache: "no-store" }),
      ]);
      const warnings: string[] = [];
      const next: InspectorData = { ...emptyInspector, warnings };
      const keys = ["branches", "commits", "pullRequests", "checkRuns"] as const;
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        const key = keys[index];
        if (result.status === "rejected") {
          warnings.push(`${labelForInspectorKey(key)} unavailable.`);
          continue;
        }
        let body: Record<string, unknown> & { error?: { message?: string } };
        try {
          body = (await result.value.json()) as typeof body;
        } catch {
          warnings.push(`${labelForInspectorKey(key)} returned an unreadable response.`);
          continue;
        }
        if (!result.value.ok) {
          warnings.push(body.error?.message ?? `${labelForInspectorKey(key)} unavailable.`);
          continue;
        }
        if (key === "branches") next.branches = (body.branches as Branch[] | undefined) ?? [];
        if (key === "commits") next.commits = (body.commits as Commit[] | undefined) ?? [];
        if (key === "pullRequests") next.pullRequests = (body.pullRequests as PullRequest[] | undefined) ?? [];
        if (key === "checkRuns") next.checkRuns = (body.checkRuns as CheckRun[] | undefined) ?? [];
      }
      if (repository?.archived) warnings.push("This repository is archived in GitHub.");
      if (repository?.disabled) warnings.push("This repository is disabled in GitHub.");
      if (!next.branches.some((item) => item.name === project.defaultBranch)) warnings.push("GitHub did not return the branch this project points at.");
      const failingChecks = next.checkRuns.filter((check) => check.status === "completed" && !["success", "neutral", "skipped"].includes(check.conclusion ?? ""));
      if (failingChecks.length) warnings.push(`${failingChecks.length} check${failingChecks.length === 1 ? " is" : "s are"} failing on the main branch.`);
      const conflictingPullRequests = next.pullRequests.filter((pullRequest) => pullRequest.state === "open" && pullRequest.mergeability === "conflicting");
      if (conflictingPullRequests.length) warnings.push(`${conflictingPullRequests.length} open pull request${conflictingPullRequests.length === 1 ? " has" : "s have"} a merge conflict.`);
      setData(next);
      if (warnings.length >= results.length) setError("Live GitHub data could not be fully refreshed.");
    } catch {
      setError("Live GitHub data could not be refreshed.");
    } finally {
      setLoading(false);
    }
  }, [isConnected, owner, project.connectionId, project.defaultBranch, repo, repository]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const openPullRequests = data.pullRequests.filter((pullRequest) => pullRequest.state === "open");
  const latestCommit = data.commits[0];
  const checkSummary = summarizeChecks(data.checkRuns);

  return (
    <Card className="overflow-hidden">
      <div className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">{project.name}</h2>
              <StatusBadge tone={isConnected ? "safe" : "danger"}>
                {isConnected ? "Connected" : "Not Connected"}
              </StatusBadge>
            </div>
            <p className="mt-1 text-sm text-muted">
              {project.githubRepository ?? "No repository linked"} · {project.defaultBranch}
            </p>
            {project.description ? <p className="mt-2 text-sm text-muted">{project.description}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2 sm:shrink-0">
            {isConnected ? (
              <Link href={`/files?project=${project.id}`} className="btn btn-primary btn-sm">
                <FolderTree className="size-4" aria-hidden="true" />
                Browse files
              </Link>
            ) : (
              <Link href="/connections" className="btn btn-primary btn-sm">Reconnect</Link>
            )}
            {repository?.htmlUrl ? (
              <a href={repository.htmlUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                GitHub
                <ExternalLink className="size-4" aria-hidden="true" />
              </a>
            ) : null}
            <button type="button" onClick={() => void refresh()} disabled={loading || !isConnected} className="btn btn-secondary btn-sm">
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Refresh
            </button>
          </div>
        </div>

        <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Latest commit" value={latestCommit ? shortSha(latestCommit.sha) : loading ? "…" : "—"} detail={latestCommit?.message.split("\n")[0]} />
          <Stat label="Branches" value={loading ? "…" : String(data.branches.length)} />
          <Stat label="Open pull requests" value={loading ? "…" : String(openPullRequests.length)} />
          <Stat label="Checks" value={loading ? "…" : checkSummary.label} tone={checkSummary.tone} />
        </dl>
      </div>

      {!isConnected ? <WarningStrip text="GitHub access was lost. Nothing can be read from this repository until you reconnect." danger /> : null}
      {error ? <WarningStrip text={error} danger /> : null}
      {data.warnings.map((warning, index) => <WarningStrip key={`${index}-${warning}`} text={warning} />)}

      {isConnected ? (
        <div className="grid border-t border-line lg:grid-cols-3">
          <InspectorSection title="Branches" icon={GitBranch} empty="No branches returned.">
            {data.branches.slice(0, 6).map((item) => (
              <li key={item.name} className="flex items-center gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-muted">{item.name}</span>
                {item.name === project.defaultBranch ? <StatusBadge tone="info" dot={false}>Main</StatusBadge> : null}
              </li>
            ))}
          </InspectorSection>

          <InspectorSection title="Recent commits" icon={GitCommitHorizontal} empty="No commits returned.">
            {data.commits.slice(0, 5).map((item) => (
              <li key={item.sha}>
                <a href={item.url} target="_blank" rel="noreferrer" className="block py-2">
                  <p className="truncate text-sm text-foreground">{item.message.split("\n")[0]}</p>
                  <p className="mt-0.5 text-sm text-faint">
                    {item.author.githubLogin ?? item.author.name} · {item.date ? formatDate(item.date) : "unknown date"}
                  </p>
                </a>
              </li>
            ))}
          </InspectorSection>

          <InspectorSection title="Pull requests" icon={GitPullRequestArrow} empty="No pull requests returned.">
            {data.pullRequests.slice(0, 6).map((item) => (
              <li key={item.id}>
                <a href={item.url} target="_blank" rel="noreferrer" className="block py-2">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm text-foreground">#{item.number} {item.title}</p>
                    <StatusBadge tone={item.state === "open" ? "info" : "neutral"} dot={false}>
                      {item.draft ? "Draft" : item.state}
                    </StatusBadge>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-faint">{item.headBranch} → {item.baseBranch}</p>
                </a>
              </li>
            ))}
          </InspectorSection>
        </div>
      ) : null}

      {isConnected && data.checkRuns.length ? (
        <div className="border-t border-line p-5">
          <p className="label">Checks on {project.defaultBranch}</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {data.checkRuns.map((check) => <CheckItem key={check.id} check={check} />)}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function Stat({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail?: string; tone?: "neutral" | "safe" | "warning" | "danger" }) {
  return (
    <div className="card-inset p-3">
      <dt className="text-sm text-faint">{label}</dt>
      <dd
        className={cn(
          "mt-1 truncate font-semibold",
          tone === "safe" ? "text-accent" : tone === "warning" ? "text-[var(--warning)]" : tone === "danger" ? "text-[var(--danger)]" : "text-foreground",
        )}
      >
        {value}
      </dd>
      {detail ? <p className="mt-1 truncate text-sm text-faint" title={detail}>{detail}</p> : null}
    </div>
  );
}

function InspectorSection({ title, icon: Icon, empty, children }: { title: string; icon: typeof GitBranch; empty: string; children: React.ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="min-w-0 border-b border-line p-5 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-faint" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {hasChildren ? (
        <ul className="mt-2 divide-y divide-[var(--border)]">{children}</ul>
      ) : (
        <p className="mt-2 py-2 text-sm text-faint">{empty}</p>
      )}
    </section>
  );
}

function CheckItem({ check }: { check: CheckRun }) {
  const passed = check.status === "completed" && ["success", "neutral", "skipped"].includes(check.conclusion ?? "");
  const failed = check.status === "completed" && !passed;
  const Icon = passed ? CheckCircle2 : failed ? XCircle : CircleDotDashed;
  const content = (
    <>
      <Icon
        className={cn("size-4 shrink-0", passed ? "text-accent" : failed ? "text-[var(--danger)]" : "text-[var(--warning)]")}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate">{check.name}</span>
    </>
  );
  return (
    <li>
      {check.url ? (
        <a href={check.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-line p-3 text-sm text-muted transition-colors hover:border-line-strong">
          {content}
        </a>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-line p-3 text-sm text-muted">{content}</div>
      )}
    </li>
  );
}

function WarningStrip({ text, danger = false }: { text: string; danger?: boolean }) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 border-t px-5 py-3 text-sm",
        danger
          ? "border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger)]"
          : "border-[var(--warning-border)] bg-[var(--warning-surface)] text-[var(--warning)]",
      )}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {text}
    </p>
  );
}

function summarizeChecks(checkRuns: CheckRun[]): { label: string; tone: "neutral" | "safe" | "warning" | "danger" } {
  if (!checkRuns.length) return { label: "None", tone: "neutral" };
  if (checkRuns.some((check) => check.status !== "completed")) return { label: "Running", tone: "warning" };
  if (checkRuns.some((check) => !["success", "neutral", "skipped"].includes(check.conclusion ?? ""))) return { label: "Failing", tone: "danger" };
  return { label: "Passing", tone: "safe" };
}

function labelForInspectorKey(key: keyof Omit<InspectorData, "warnings">) {
  return ({ branches: "Branch data", commits: "Commit data", pullRequests: "Pull request data", checkRuns: "Check data" })[key];
}

function shortSha(sha: string) { return sha.slice(0, 7); }
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
