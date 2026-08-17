"use client";

import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDotDashed,
  ExternalLink,
  FolderKanban,
  FolderTree,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  GitPullRequestArrow,
  Loader2,
  Pencil,
  Plus,
  PlugZap,
  RefreshCw,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ProjectBots } from "@/components/project-bots";
import { ProjectOperationsPanel } from "@/components/project-operations-panel";
import { ProjectRepository } from "@/components/project-repository";
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

export type Connection = {
  id: string;
  name?: string;
  status: "connected" | "not_connected";
  statusLabel: string;
  account: { login: string; type: string } | null;
  installation: { id: number; lastSyncedAt: string | null; suspendedAt: string | null } | null;
  repositories: Repository[];
};

export type Project = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  githubRepository: string | null;
  githubRepositoryId: number | null;
  defaultBranch: string;
  healthStatus: string;
  autonomousMode: boolean;
  maximumAutonomousRisk: string;
  updatedAt?: string | null;
  connectionId: string | null;
  connectionStatus: "connected" | "not_connected";
};

/** The slice of a run this page needs: whose it is, how it ended, and when. */
type RunSummary = {
  id: string;
  status: string;
  createdAt: string;
  project: { id: string; name: string } | null;
};

type ActivityItem = {
  id: string;
  description: string;
  occurredAt: string;
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
type InspectorData = {
  branches: Branch[];
  commits: Commit[];
  pullRequests: PullRequest[];
  checkRuns: CheckRun[];
  pullRequestChecks: Record<string, CheckRun[]>;
  warnings: string[];
};
type State = "loading" | "signed-out" | "setup" | "ready" | "error";

const emptyInspector: InspectorData = {
  branches: [],
  commits: [],
  pullRequests: [],
  checkRuns: [],
  pullRequestChecks: {},
  warnings: [],
};

export function ProjectsConsole() {
  const searchParams = useSearchParams();
  // The navigation's Archived subpage is this same console with the filter
  // flipped: the read is opt-in on the API too, so nothing archived leaks
  // into the default view.
  const showArchived = searchParams.get("filter") === "archived";
  const [state, setState] = useState<State>("loading");
  const [projects, setProjects] = useState<Project[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [repositoryId, setRepositoryId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  // Dashboard evidence, all best-effort: runs feed the Last-run and
  // Success-rate columns, activity feeds the rail, and the archived count
  // completes the by-status breakdown. Any of them failing degrades its own
  // surface to an honest absence rather than blocking the page.
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [archivedCount, setArchivedCount] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  // Edit and archive are dialogs so the table row states exactly what will
  // happen before it does; unarchive acts in place on the archived view.
  const [editing, setEditing] = useState<Project | null>(null);
  const [archiving, setArchiving] = useState<Project | null>(null);
  const [unarchivingId, setUnarchivingId] = useState("");
  const [unarchiveError, setUnarchiveError] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const [projectsResponse, connectionsResponse] = await Promise.all([
        fetch(showArchived ? "/api/projects?status=archived" : "/api/projects", { cache: "no-store" }),
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
      setPage(0);

      if (!showArchived) {
        const [runsResult, activityResult, archivedResult] = await Promise.allSettled([
          fetch("/api/runs", { cache: "no-store" }),
          fetch("/api/activity?limit=8", { cache: "no-store" }),
          fetch("/api/projects?status=archived", { cache: "no-store" }),
        ]);
        if (runsResult.status === "fulfilled" && runsResult.value.ok) {
          const body = (await runsResult.value.json().catch(() => ({}))) as { runs?: RunSummary[] };
          setRuns(body.runs ?? []);
        } else {
          setRuns([]);
        }
        if (activityResult.status === "fulfilled" && activityResult.value.ok) {
          const body = (await activityResult.value.json().catch(() => ({}))) as { events?: ActivityItem[] };
          setActivity(body.events ?? []);
        } else {
          setActivity(null);
        }
        if (archivedResult.status === "fulfilled" && archivedResult.value.ok) {
          const body = (await archivedResult.value.json().catch(() => ({}))) as { projects?: unknown[] };
          setArchivedCount(body.projects ? body.projects.length : null);
        } else {
          setArchivedCount(null);
        }
      }
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Projects could not be loaded.");
      setState("error");
    }
  }, [showArchived]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const unarchive = useCallback(async (projectId: string) => {
    setUnarchivingId(projectId);
    setUnarchiveError("");
    try {
      const response = await fetch("/api/portfolio/controls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unarchive", projectId }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The project could not be unarchived.");
      await load();
    } catch (error) {
      setUnarchiveError(error instanceof Error ? error.message : "The project could not be unarchived.");
    } finally {
      setUnarchivingId("");
    }
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
    () => availableRepositories.filter((repository) => !projects.some((project) => project.githubRepositoryId === repository.id)),
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
  if (state === "setup") return <BlockedState icon={FolderTree} title="Finish setting up" description="Create or choose a workspace before linking a repository." href="/solutions/connections" label="Open connections" />;
  if (state === "error") return <BlockedState icon={FolderTree} title="Projects are unavailable" description={message || "Your projects could not be loaded."} href="/solutions/connections" label="Check connections" />;

  if (showArchived) {
    // Archived projects are records, not workspaces: no live GitHub inspector,
    // no add form. Archiving deletes nothing, and unarchiving is an owner
    // control on the portfolio page — both facts stated rather than implied.
    return (
      <div className="space-y-4">
        <ProjectTabs active="archived" />
        {projects.map((project) => (
          <Card key={project.id} className="p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-foreground">{project.name}</h2>
                  <StatusBadge tone="neutral">Archived</StatusBadge>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {project.githubRepository ?? "No repository linked"} · {project.defaultBranch}
                </p>
                {project.description ? <p className="mt-2 text-sm text-muted">{project.description}</p> : null}
                <p className="mt-3 text-sm text-muted">
                  Every run, report, and activity record this project produced is kept.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void unarchive(project.id)}
                disabled={unarchivingId === project.id}
                className="btn btn-secondary btn-sm sm:shrink-0"
              >
                {unarchivingId === project.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Archive className="size-4" aria-hidden="true" />
                )}
                Unarchive
              </button>
            </div>
          </Card>
        ))}
        {unarchiveError ? (
          <p className="text-sm text-[var(--danger)]" aria-live="polite">{unarchiveError}</p>
        ) : null}
        {!projects.length ? (
          <Card className="p-5 sm:p-6">
            <SectionTitle
              title="No archived projects"
              description="Archiving stops new work on a project while keeping every run, report, and activity record. Nothing is archived right now."
            />
            <Link href="/solutions/projects" className="btn btn-secondary btn-sm mt-4">
              <FolderTree className="size-4" aria-hidden="true" />
              View all projects
            </Link>
          </Card>
        ) : null}
      </div>
    );
  }

  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(projects.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleProjects = projects.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const activeCount = projects.filter((project) => project.status === "active").length;
  const connectedCount = projects.filter((project) => project.connectionStatus === "connected").length;
  const repositoryCount = connectedConnections.reduce(
    (sum, connection) => sum
      + connection.repositories.filter((repository) => repository.selected && !repository.archived && !repository.disabled).length,
    0,
  );
  const statusBreakdown = [
    { label: "Active", count: activeCount, dotClassName: "bg-[var(--accent)]" },
    { label: "Paused", count: projects.filter((project) => project.status === "paused").length, dotClassName: "bg-[var(--warning)]" },
    { label: "Draft", count: projects.filter((project) => project.status === "draft").length, dotClassName: "bg-[var(--border)]" },
    ...(archivedCount !== null
      ? [{ label: "Archived", count: archivedCount, dotClassName: "bg-[var(--text-muted)]" }]
      : []),
  ];

  return (
    <div className="space-y-4">
      {editing ? (
        <ProjectEditDialog
          project={editing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      ) : null}
      {archiving ? (
        <ProjectArchiveDialog
          project={archiving}
          onClose={() => setArchiving(null)}
          onArchived={load}
        />
      ) : null}

      <ProjectTabs active="all" />

      {/* Every number here is counted from the two live reads above; there
          are no trend deltas because no historical snapshots exist to
          compute them from. */}
      {projects.length ? (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard icon={FolderKanban} label="Total projects" value={String(projects.length)} detail={archivedCount ? `+ ${archivedCount} archived` : "excluding archived"} />
          <StatCard icon={CheckCircle2} label="Active" value={String(activeCount)} detail={`${Math.round((activeCount / projects.length) * 100)}% of total`} />
          <StatCard icon={GitFork} label="Repositories" value={String(repositoryCount)} detail="authorized on GitHub" />
          <StatCard icon={PlugZap} label="Connected" value={String(connectedCount)} detail={`of ${projects.length} project${projects.length === 1 ? "" : "s"}`} />
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
      {projects.length ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-3 font-medium text-faint">Project</th>
                  <th scope="col" className="px-4 py-3 font-medium text-faint">Repository</th>
                  <th scope="col" className="px-4 py-3 font-medium text-faint">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium text-faint">Last run</th>
                  <th scope="col" className="px-4 py-3 font-medium text-faint">Success rate</th>
                  <th scope="col" className="px-4 py-3 font-medium text-faint">Updated</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {visibleProjects.map((project) => {
                  const facts = projectRunFacts(runs, project.id);
                  return (
                    <tr key={project.id}>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-foreground">{project.name}</p>
                        {project.description ? (
                          <p className="mt-0.5 max-w-56 truncate text-muted" title={project.description}>{project.description}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-muted">
                        <p className="max-w-56 truncate">{project.githubRepository ?? "None linked"}</p>
                        <p className="mt-0.5 text-xs text-faint">{project.defaultBranch}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <StatusBadge
                            tone={project.status === "active" ? "safe" : project.status === "paused" ? "warning" : "neutral"}
                            dot={false}
                          >
                            {formatStatusWord(project.status)}
                          </StatusBadge>
                          {project.connectionStatus !== "connected" ? (
                            <StatusBadge tone="danger" dot={false}>Not Connected</StatusBadge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {facts.latest ? (
                          <>
                            <span
                              className={cn(
                                "font-medium",
                                facts.latest.status === "succeeded"
                                  ? "text-accent"
                                  : facts.latest.status === "failed"
                                    ? "text-[var(--danger)]"
                                    : "text-muted",
                              )}
                            >
                              {formatStatusWord(facts.latest.status)}
                            </span>
                            <p className="mt-0.5 text-xs text-faint">{formatDate(facts.latest.createdAt)}</p>
                          </>
                        ) : (
                          <span className="text-faint">No runs yet</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {facts.successRate !== null ? (
                          <div>
                            <span className="font-semibold text-foreground">{facts.successRate}%</span>
                            <span className="ml-1 text-xs text-faint">
                              of {facts.finished} finished
                            </span>
                            <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-surface-raised">
                              <div className="h-full rounded-full bg-accent" style={{ width: `${facts.successRate}%` }} aria-hidden="true" />
                            </div>
                          </div>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {project.updatedAt ? formatDate(project.updatedAt) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditing(project)}
                            aria-label={`Edit ${project.name}`}
                            className="btn btn-secondary btn-sm size-8 px-0"
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setArchiving(project)}
                            aria-label={`Archive ${project.name}`}
                            className="btn btn-secondary btn-sm size-8 px-0"
                          >
                            <Archive className="size-4" aria-hidden="true" />
                          </button>
                          <Link href={`/solutions/portfolio/${project.id}`} className="btn btn-secondary btn-sm">
                            Open
                            <ArrowRight className="size-4" aria-hidden="true" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
            <p>
              Showing {currentPage * pageSize + 1} to {Math.min(projects.length, (currentPage + 1) * pageSize)} of {projects.length} project{projects.length === 1 ? "" : "s"}
            </p>
            {pageCount > 1 ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(Math.max(0, currentPage - 1))}
                  disabled={currentPage === 0}
                  className="btn btn-secondary btn-sm"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="size-4" aria-hidden="true" />
                </button>
                <span className="tabular">{currentPage + 1} / {pageCount}</span>
                <button
                  type="button"
                  onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))}
                  disabled={currentPage >= pageCount - 1}
                  className="btn btn-secondary btn-sm"
                  aria-label="Next page"
                >
                  <ChevronRight className="size-4" aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {!connectedConnections.length ? (
        <BlockedState
          icon={GitFork}
          title="Connect GitHub first"
          description="A repository becomes a project only after you have authorized GitHub."
          href="/solutions/connections"
          label="Connect GitHub"
        />
      ) : unconnectedRepositories.length || !projects.length ? (
        /* The id anchors the navigation's "New Project" quick action; the
           scroll margin keeps the heading clear of the fixed mobile header. */
        <Card id="add-project" className="scroll-mt-24 p-5 sm:p-6">
          <SectionTitle
            title="Add a project"
            description="Pick one of the repositories you authorized. The branch comes straight from GitHub."
          />

          <form onSubmit={createProject} className="mt-5 grid gap-4 md:grid-cols-2">
            {/* One connected account is the common case, and a picker with a
                single option is a dead control. The repository list below
                already names the owner (owner/repo), so nothing is lost. */}
            {connectedConnections.length > 1 ? (
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
            ) : null}

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
        /* Every authorized repository is taken. Saying only that leaves the
           person at a dead end, because the way to add another project is not
           on this page at all: it is authorizing another repository on
           GitHub. Name that, and link to where it starts. */
        <Card className="p-5 sm:p-6">
          <SectionTitle
            title="Add another project"
            description="Every repository you authorized is already a project. A project is one repository, so the next one starts by authorizing another repository for SoftwareFactory on GitHub."
          />
          <Link href="/solutions/connections" className="btn btn-secondary btn-sm mt-4">
            <GitFork className="size-4" aria-hidden="true" />
            Manage repository access
          </Link>
        </Card>
      )}
        </div>

        <div className="min-w-0 space-y-4">
          <Card className="p-5">
            <SectionTitle title="Projects by status" />
            <ul className="mt-4 space-y-2.5 text-sm">
              {statusBreakdown.map((row) => (
                <li key={row.label} className="flex items-center gap-2.5">
                  <span className={cn("size-2 shrink-0 rounded-full", row.dotClassName)} aria-hidden="true" />
                  <span className="flex-1 text-muted">{row.label}</span>
                  <span className="tabular font-semibold text-foreground">{row.count}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5">
            <div className="flex items-start justify-between gap-2">
              <SectionTitle title="Recent activity" />
              <Link href="/solutions/activity" className="text-sm font-medium text-accent">View all</Link>
            </div>
            {activity === null ? (
              <p className="mt-3 text-sm text-faint">Activity is unavailable right now.</p>
            ) : activity.length === 0 ? (
              <p className="mt-3 text-sm text-faint">No activity recorded yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-[var(--border)]">
                {activity.map((item) => (
                  <li key={item.id} className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
                    <Activity className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">{item.description}</p>
                      <p className="mt-0.5 text-xs text-faint">{formatDate(item.occurredAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

export function ProjectInspector({
  project,
  connection,
  connections,
  onChanged,
}: {
  project: Project;
  connection: Connection | null;
  connections: Connection[];
  onChanged: () => Promise<void> | void;
}) {
  const [data, setData] = useState<InspectorData>(emptyInspector);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingSelf, setEditingSelf] = useState(false);
  const [archivingSelf, setArchivingSelf] = useState(false);
  const repository = connection?.repositories.find((item) => item.id === project.githubRepositoryId);
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
        fetch(`${base}/pulls?${query}&includeMergeability=true`, { cache: "no-store" }),
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
      const inspectedPullRequests = next.pullRequests.slice(0, 6);
      const pullRequestCheckResults = await Promise.allSettled(
        inspectedPullRequests.map((pullRequest) => fetch(
          `${base}/checks?${query}&ref=${encodeURIComponent(pullRequest.headSha)}`,
          { cache: "no-store" },
        )),
      );
      for (let index = 0; index < pullRequestCheckResults.length; index += 1) {
        const pullRequest = inspectedPullRequests[index];
        const result = pullRequestCheckResults[index];
        if (!pullRequest || !result) continue;
        if (result.status === "rejected") {
          warnings.push(`Checks for pull request #${pullRequest.number} are unavailable.`);
          continue;
        }
        try {
          const body = (await result.value.json()) as { checkRuns?: CheckRun[]; error?: { message?: string } };
          if (!result.value.ok) {
            warnings.push(body.error?.message ?? `Checks for pull request #${pullRequest.number} are unavailable.`);
            continue;
          }
          next.pullRequestChecks[String(pullRequest.id)] = body.checkRuns ?? [];
        } catch {
          warnings.push(`Checks for pull request #${pullRequest.number} returned an unreadable response.`);
        }
      }
      if (repository?.archived) warnings.push("This repository is archived in GitHub.");
      if (repository?.disabled) warnings.push("This repository is disabled in GitHub.");
      if (!next.branches.some((item) => item.name === project.defaultBranch)) warnings.push("GitHub did not return the branch this project points at.");
      const failingChecks = next.checkRuns.filter(isAdverseCheck);
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
  const lastSynced = connection?.installation?.lastSyncedAt ?? repository?.lastSyncedAt ?? null;

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
              /* Setting a project up ends with nothing to do with it. This is
                 the next step a person actually wants — and it carries the
                 project, so Bot Manager opens already pointed at it. */
              <Link
                href={`/solutions/bot-manager?project=${project.id}`}
                className="btn btn-primary btn-sm"
              >
                <Bot className="size-4" aria-hidden="true" />
                Give this project work
              </Link>
            ) : null}
            {isConnected ? (
              <Link href={`/solutions/files?project=${project.id}`} className="btn btn-secondary btn-sm">
                <FolderTree className="size-4" aria-hidden="true" />
                Browse files
              </Link>
            ) : (
              <Link href="/solutions/connections" className="btn btn-primary btn-sm">Reconnect</Link>
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
            <button type="button" onClick={() => setEditingSelf(true)} className="btn btn-secondary btn-sm">
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </button>
            <button type="button" onClick={() => setArchivingSelf(true)} className="btn btn-secondary btn-sm">
              <Archive className="size-4" aria-hidden="true" />
              Archive
            </button>
          </div>
        </div>

        {editingSelf ? (
          <ProjectEditDialog
            project={project}
            onClose={() => setEditingSelf(false)}
            onSaved={onChanged}
          />
        ) : null}
        {archivingSelf ? (
          <ProjectArchiveDialog
            project={project}
            onClose={() => setArchivingSelf(false)}
            onArchived={onChanged}
          />
        ) : null}

        <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Visibility" value={repository ? (repository.private ? "Private" : "Public") : "Unavailable"} />
          <Stat label="Last synchronized" value={lastSynced ? formatDate(lastSynced) : "Never"} />
          <Stat label="Latest commit" value={latestCommit ? shortSha(latestCommit.sha) : loading ? "…" : "—"} detail={latestCommit?.message.split("\n")[0]} />
          <Stat label="Branches" value={loading ? "…" : String(data.branches.length)} />
          <Stat label="Open pull requests" value={loading ? "…" : String(openPullRequests.length)} />
          <Stat label="Checks" value={loading ? "…" : checkSummary.label} tone={checkSummary.tone} />
        </dl>

        <ProjectOperationsPanel projectId={project.id} />
      </div>

      {!isConnected ? <WarningStrip text="GitHub access was lost. Nothing can be read from this repository until you reconnect." danger /> : null}
      {error ? <WarningStrip text={error} danger /> : null}
      {data.warnings.map((warning, index) => <WarningStrip key={`${index}-${warning}`} text={warning} />)}

      {isConnected ? (
        <div className="grid border-t border-line lg:grid-cols-3">
          <InspectorSection title="Branches" icon={GitBranch} empty="No branches returned.">
            {data.branches.slice(0, 6).map((item) => (
              <li key={item.name} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-muted">{item.name}</span>
                {item.name === project.defaultBranch ? <StatusBadge tone="info" dot={false}>Default</StatusBadge> : null}
                <StatusBadge tone={item.protected ? "safe" : "neutral"} dot={false}>
                  {item.protected ? "Protected" : "Unprotected"}
                </StatusBadge>
                <span className="font-mono text-xs text-faint" aria-label={`Latest SHA ${item.sha}`}>
                  {shortSha(item.sha)}
                </span>
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
                  <p className="mt-0.5 truncate text-sm text-faint">
                    Author: {item.author?.login ?? "Unknown"} · Mergeability: {formatMergeability(item.mergeability)}
                  </p>
                  <p className="mt-0.5 text-sm text-faint">
                    Created {item.createdAt ? formatDate(item.createdAt) : "unknown"} · Updated {formatDate(item.updatedAt)}
                  </p>
                </a>
                <PullRequestChecks checks={data.pullRequestChecks[String(item.id)] ?? []} />
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

      {/* What this project develops, and who develops it, both belong with
          the project rather than on other pages: the repository picker first
          shipped only on Connections, and assignments only in a diagnostics
          drawer. */}
      <ProjectRepository
        projectId={project.id}
        projectName={project.name}
        currentRepository={project.githubRepository}
        currentRepositoryId={project.githubRepositoryId}
        connections={connections}
        onChanged={onChanged}
      />

      <ProjectBots projectId={project.id} projectName={project.name} />
    </Card>
  );
}

/**
 * The design's view switcher. All Projects and Archived are this console's
 * two real filters; My Projects is its sibling page. The design's Starred tab
 * has no starring model behind it and is deliberately absent.
 */
function ProjectTabs({ active }: { active: "all" | "archived" }) {
  const tabs = [
    { key: "all", label: "All Projects", href: "/solutions/projects" },
    { key: "mine", label: "My Projects", href: "/solutions/myprojects" },
    { key: "archived", label: "Archived", href: "/solutions/projects?filter=archived" },
  ] as const;
  return (
    <nav aria-label="Project views" className="flex flex-wrap gap-1 border-b border-line">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === active ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            tab.key === active
              ? "border-[var(--accent)] text-foreground"
              : "border-transparent text-muted hover:text-foreground",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

function DialogShell({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div className="relative w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="btn btn-secondary btn-sm absolute right-4 top-4 size-9 px-0"
          aria-label="Close"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
        {children}
      </div>
    </div>
  );
}

/** Name and description, bounded exactly like the create form. */
export function ProjectEditDialog({
  project,
  onClose,
  onSaved,
}: {
  project: Project;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The project could not be updated.");
      onClose();
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The project could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell label={`Edit ${project.name}`} onClose={onClose}>
      <h2 className="text-lg font-semibold text-foreground">Edit project</h2>
      <p className="mt-1 text-sm text-muted">
        The repository link, history, and status stay exactly as they are.
      </p>
      <form onSubmit={save} className="mt-4 space-y-4">
        <div>
          <label htmlFor="edit-project-name" className="field-label">Name</label>
          <input
            id="edit-project-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={1}
            maxLength={160}
            className="input"
          />
        </div>
        <div>
          <label htmlFor="edit-project-description" className="field-label">
            Description <span className="font-normal text-faint">(optional)</span>
          </label>
          <input
            id="edit-project-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={2000}
            className="input"
          />
        </div>
        <div className="flex gap-2">
          <button type="submit" disabled={busy || !name.trim()} className="btn btn-primary btn-sm">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />}
            Save changes
          </button>
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">Cancel</button>
        </div>
        {error ? <p className="text-sm text-[var(--danger)]" aria-live="polite">{error}</p> : null}
      </form>
    </DialogShell>
  );
}

/**
 * Archive is the delete that keeps history: the database requires a reason,
 * and the dialog says what survives before anything happens.
 */
export function ProjectArchiveDialog({
  project,
  onClose,
  onArchived,
}: {
  project: Project;
  onClose: () => void;
  onArchived: () => Promise<void> | void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function archive(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/portfolio/controls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive", projectId: project.id, reason: reason.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The project could not be archived.");
      onClose();
      await onArchived();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "The project could not be archived.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell label={`Archive ${project.name}`} onClose={onClose}>
      <h2 className="text-lg font-semibold text-foreground">Archive {project.name}</h2>
      <p className="mt-1 text-sm text-muted">
        Archiving stops new work. Every run, report, and activity record is kept, and you can
        unarchive it from the Archived view at any time. Nothing is deleted.
      </p>
      <form onSubmit={archive} className="mt-4 space-y-4">
        <div>
          <label htmlFor="archive-project-reason" className="field-label">Why archive it?</label>
          <input
            id="archive-project-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            minLength={1}
            maxLength={500}
            className="input"
            placeholder="Superseded by the new repository"
          />
          <span className="field-hint">Recorded in the audit trail with the transition.</span>
        </div>
        <div className="flex gap-2">
          <button type="submit" disabled={busy || !reason.trim()} className="btn btn-primary btn-sm">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Archive className="size-4" />}
            Archive project
          </button>
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">Cancel</button>
        </div>
        {error ? <p className="text-sm text-[var(--danger)]" aria-live="polite">{error}</p> : null}
      </form>
    </DialogShell>
  );
}

function StatCard({ icon: Icon, label, value, detail }: { icon: typeof FolderKanban; label: string; value: string; detail?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-faint" aria-hidden="true" />
        <p className="text-sm text-faint">{label}</p>
      </div>
      <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
      {detail ? <p className="mt-0.5 text-xs text-faint">{detail}</p> : null}
    </Card>
  );
}

/**
 * Last run and success rate for one project, from the live runs list. Only
 * succeeded and failed carry a verdict; queued, running, and cancelled runs
 * are excluded from the rate the same way cancelled checks are excluded from
 * "failing" — no verdict is not a verdict.
 */
function projectRunFacts(runs: RunSummary[], projectId: string) {
  const own = runs.filter((run) => run.project?.id === projectId);
  const latest = own.reduce<RunSummary | null>(
    (best, run) => (!best || Date.parse(run.createdAt) > Date.parse(best.createdAt) ? run : best),
    null,
  );
  const succeeded = own.filter((run) => run.status === "succeeded").length;
  const failed = own.filter((run) => run.status === "failed").length;
  const finished = succeeded + failed;
  return {
    latest,
    finished,
    successRate: finished ? Math.round((succeeded / finished) * 100) : null,
  };
}

function formatStatusWord(value: string) {
  const spaced = value.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
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

function PullRequestChecks({ checks }: { checks: CheckRun[] }) {
  if (!checks.length) return <p className="pb-2 text-xs text-faint">No checks returned for this head commit.</p>;
  return (
    <ul className="space-y-1 pb-2" aria-label="Pull request checks">
      {checks.slice(0, 6).map((check) => (
        <li key={check.id} className="flex items-center justify-between gap-2 text-xs text-faint">
          <span className="min-w-0 truncate">{check.name}</span>
          <span className="shrink-0">{check.status} / {check.conclusion ?? "—"}</span>
        </li>
      ))}
    </ul>
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
      <span className="min-w-0 flex-1 truncate">
        <span className="block truncate text-foreground">{check.name}</span>
        <span className="mt-0.5 block truncate text-xs text-faint">
          Status: {check.status} · Conclusion: {check.conclusion ?? "—"}
        </span>
      </span>
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

/**
 * Only conclusions that carry actual failure evidence count as failing. A
 * cancelled or stale run carries no verdict — the worker queue cancels its own
 * superseded beats by design, and labelling that "1 check is failing on the
 * main branch" misled the owner on 2026-08-16 while every real check was
 * green. Cancelled runs still render their literal conclusion in the detail
 * rows; they just do not raise a failure warning.
 */
const ADVERSE_CHECK_CONCLUSIONS = new Set(["failure", "timed_out", "action_required", "startup_failure"]);

function isAdverseCheck(check: CheckRun) {
  return check.status === "completed" && ADVERSE_CHECK_CONCLUSIONS.has(check.conclusion ?? "");
}

function summarizeChecks(checkRuns: CheckRun[]): { label: string; tone: "neutral" | "safe" | "warning" | "danger" } {
  if (!checkRuns.length) return { label: "None", tone: "neutral" };
  if (checkRuns.some((check) => check.status !== "completed")) return { label: "Running", tone: "warning" };
  if (checkRuns.some(isAdverseCheck)) return { label: "Failing", tone: "danger" };
  return { label: "Passing", tone: "safe" };
}

function labelForInspectorKey(key: keyof Omit<InspectorData, "warnings" | "pullRequestChecks">) {
  return ({ branches: "Branch data", commits: "Commit data", pullRequests: "Pull request data", checkRuns: "Check data" })[key];
}

function shortSha(sha: string) { return sha.slice(0, 7); }
function formatMergeability(value: PullRequest["mergeability"]) {
  if (value === "mergeable") return "Mergeable";
  if (value === "conflicting") return "Conflicting";
  return "Unknown";
}
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
