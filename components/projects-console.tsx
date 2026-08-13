"use client";

import {
  AlertTriangle,
  ArrowRight,
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
  ShieldCheck,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Panel, StatusBadge } from "@/components/ui";
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
      if (!response.ok) throw new Error(body.error?.message ?? "The project could not be connected.");
      setMessage(`${name} is now backed by live GitHub and Supabase data.`);
      setName("");
      setDescription("");
      setRepositoryId("");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The project could not be connected.");
    } finally {
      setSaving(false);
    }
  }

  if (state === "loading") return <Panel className="grid min-h-64 place-items-center"><Loader2 className="size-6 animate-spin text-[#c6f135]" aria-label="Loading projects" /></Panel>;
  if (state === "signed-out") return <ProjectNotice title="Sign in to load live projects" description="Projects are scoped to your authenticated SoftwareFactory organization." href="/sign-in?next=/projects" label="Sign in" />;
  if (state === "setup") return <ProjectNotice title="Complete organization setup" description="Create or select an organization before linking a repository." href="/connections" label="Open connections" />;
  if (state === "error") return <ProjectNotice title="Projects are unavailable" description={message || "The live project service could not be reached."} href="/connections" label="Review connections" />;

  return (
    <div className="space-y-5">
      {projects.length ? (
        <div className="space-y-4">
          {projects.map((project) => (
            <ProjectInspector key={project.id} project={project} connection={connections.find((item) => item.id === project.connectionId) ?? null} />
          ))}
        </div>
      ) : null}

      {!connectedConnections.length ? (
        <ProjectNotice title="Connect GitHub first" description="A verified GitHub App installation is required before a repository can become a managed project." href="/connections" label="Connect GitHub" />
      ) : unconnectedRepositories.length || !projects.length ? (
        <Panel className="p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-[#304020] bg-[#17210e] text-[#c6f135]"><Plus className="size-4" aria-hidden="true" /></span>
            <div><h2 className="text-sm font-semibold text-white">Add a GitHub-backed project</h2><p className="mt-1 text-xs leading-5 text-[#748191]">Repository and branch choices come from the verified GitHub App installation. The tenant relationship is stored transactionally in Supabase.</p></div>
          </div>
          <form onSubmit={createProject} className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="GitHub connection"><select value={activeConnectionId} onChange={(event) => { setConnectionId(event.target.value); setRepositoryId(""); setName(""); }} className="form-control">{connectedConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.account?.login ?? connection.name ?? "GitHub"}</option>)}</select></Field>
            <Field label="Repository"><select value={repositoryId} onChange={(event) => { setRepositoryId(event.target.value); const repo = unconnectedRepositories.find((item) => String(item.id) === event.target.value); setName(repo?.fullName.split("/")[1] ?? ""); }} className="form-control">{unconnectedRepositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.fullName}</option>)}</select></Field>
            <Field label="Verified default branch"><input value={selectedRepository?.defaultBranch ?? ""} readOnly className="form-control" /></Field>
            <Field label="Project name"><input value={name} onChange={(event) => setName(event.target.value)} required minLength={1} maxLength={160} className="form-control" /></Field>
            <Field label="Description" className="md:col-span-2"><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={3} className="form-control h-auto py-2.5" placeholder="What this software system does" /></Field>
            <div className="flex flex-col gap-3 md:col-span-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-[10px] text-[#798697]"><ShieldCheck className="size-4 text-[#c6f135]" aria-hidden="true" />Autonomous Mode and every automatic action start OFF; the global kill switch starts ON.</p>
              <button type="submit" disabled={saving || !selectedRepository || !name.trim()} className="primary-action justify-center">{saving ? <Loader2 className="size-4 animate-spin" /> : <GitFork className="size-4" />}Connect project</button>
            </div>
          </form>
          {message ? <p className="mt-4 text-xs text-[#d7b96d]" aria-live="polite">{message}</p> : null}
        </Panel>
      ) : (
        <Panel className="p-4 text-center text-xs text-[#718091]">Every selected repository in this installation is already connected to a project.</Panel>
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
      if (repository?.archived) warnings.push("Repository is archived in GitHub.");
      if (repository?.disabled) warnings.push("Repository is disabled in GitHub.");
      if (!next.branches.some((item) => item.name === project.defaultBranch)) warnings.push("Configured default branch was not returned by GitHub.");
      const failingChecks = next.checkRuns.filter((check) => check.status === "completed" && !["success", "neutral", "skipped"].includes(check.conclusion ?? ""));
      if (failingChecks.length) warnings.push(`${failingChecks.length} default-branch check${failingChecks.length === 1 ? " is" : "s are"} failing.`);
      const conflictingPullRequests = next.pullRequests.filter((pullRequest) => pullRequest.state === "open" && pullRequest.mergeability === "conflicting");
      if (conflictingPullRequests.length) warnings.push(`${conflictingPullRequests.length} open pull request${conflictingPullRequests.length === 1 ? " reports" : "s report"} a merge conflict.`);
      setData(next);
      if (warnings.length >= results.length) setError("GitHub repository details could not be fully refreshed.");
    } catch {
      setError("GitHub repository details could not be refreshed.");
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
    <Panel className="overflow-hidden">
      <div className="border-b border-[#202b38] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">{isConnected ? <CheckCircle2 className="size-4 shrink-0 text-[#c6f135]" aria-hidden="true" /> : <AlertTriangle className="size-4 shrink-0 text-[#ff7d84]" aria-hidden="true" />}<h2 className="truncate text-base font-semibold text-white">{project.name}</h2></div>
            <p className="mt-2 text-xs leading-5 text-[#748191]">{project.description || "GitHub-backed SoftwareFactory project"}</p>
          </div>
          <div className="flex flex-wrap gap-2"><StatusBadge tone={isConnected ? "safe" : "danger"}>{isConnected ? "GitHub Connected" : "Not Connected"}</StatusBadge><StatusBadge tone="neutral">{project.autonomousMode ? "Observation mode ON" : "Autonomy OFF"}</StatusBadge><StatusBadge tone="danger">Kill switch ON</StatusBadge></div>
        </div>

        <dl className="mt-5 grid gap-3 text-[11px] sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Repository" value={project.githubRepository ?? "Not linked"} mono />
          <Metric label="Visibility" value={repository ? (repository.private ? "Private" : "Public") : "Unavailable"} />
          <Metric label="Default branch" value={project.defaultBranch} mono />
          <Metric label="Last synchronized" value={lastSynced ? formatDate(lastSynced) : "Never"} />
          <Metric label="Latest commit" value={latestCommit ? shortSha(latestCommit.sha) : loading ? "Loading…" : "Unavailable"} detail={latestCommit?.message.split("\n")[0]} mono />
          <Metric label="Branches" value={loading ? "…" : String(data.branches.length)} />
          <Metric label="Open pull requests" value={loading ? "…" : String(openPullRequests.length)} />
          <Metric label="Default-branch checks" value={loading ? "Loading…" : checkSummary.label} tone={checkSummary.tone} />
        </dl>

        <div className="mt-5 flex flex-wrap gap-2">
          {isConnected ? <Link href={`/files?project=${project.id}`} className="primary-action">Browse real files<FolderTree className="size-4" aria-hidden="true" /></Link> : <Link href="/connections" className="primary-action">Restore connection<ArrowRight className="size-4" aria-hidden="true" /></Link>}
          {repository?.htmlUrl ? <a href={repository.htmlUrl} target="_blank" rel="noreferrer" className="secondary-action">Open GitHub<ExternalLink className="size-3.5" aria-hidden="true" /></a> : null}
          <button type="button" onClick={() => void refresh()} disabled={loading || !isConnected} className="secondary-action">{loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}Refresh live data</button>
        </div>
      </div>

      {!isConnected ? <WarningStrip text="GitHub Connection Lost. Repository operations are blocked until the installation is restored and synchronized." danger /> : null}
      {error ? <WarningStrip text={error} danger /> : null}
      {data.warnings.map((warning, index) => <WarningStrip key={`${index}-${warning}`} text={warning} />)}

      <div className="grid divide-y divide-[#202b38] lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        <InspectorSection title="Branches" icon={GitBranch} empty="No branch data available.">
          {data.branches.slice(0, 6).map((item) => (
            <div key={item.name} className="flex items-center gap-2 py-2 text-[10px]"><GitBranch className="size-3.5 shrink-0 text-[#71802c]" /><span className="min-w-0 flex-1 truncate font-mono text-[#aeb8c3]">{item.name}</span>{item.name === project.defaultBranch ? <StatusBadge tone="info" dot={false}>Default</StatusBadge> : null}{item.protected ? <StatusBadge tone="safe" dot={false}>Protected</StatusBadge> : null}<span className="font-mono text-[#8592a3]">{shortSha(item.sha)}</span></div>
          ))}
        </InspectorSection>
        <InspectorSection title="Recent commits" icon={GitCommitHorizontal} empty="No commit data available.">
          {data.commits.slice(0, 5).map((item) => (
            <a key={item.sha} href={item.url} target="_blank" rel="noreferrer" className="block rounded-md py-2 hover:bg-[#111821]"><p className="truncate text-[10px] font-medium text-[#b7c0ca]">{item.message.split("\n")[0]}</p><p className="mt-1 flex justify-between gap-2 font-mono text-[8px] text-[#566271]"><span>{shortSha(item.sha)} · {item.author.githubLogin ?? item.author.name}</span><span>{item.date ? formatDate(item.date) : "Date unavailable"}</span></p></a>
          ))}
        </InspectorSection>
        <InspectorSection title="Pull requests" icon={GitPullRequestArrow} empty="No pull requests returned by GitHub.">
          {data.pullRequests.slice(0, 6).map((item) => (
            <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="block rounded-md py-2 hover:bg-[#111821]"><div className="flex items-start gap-2"><GitPullRequestArrow className="mt-0.5 size-3.5 shrink-0 text-[#60d8ff]" /><p className="min-w-0 flex-1 truncate text-[10px] font-medium text-[#b7c0ca]">#{item.number} {item.title}</p><StatusBadge tone={item.state === "open" ? "info" : "neutral"} dot={false}>{item.draft ? "Draft" : item.state}</StatusBadge></div><p className="mt-1 truncate pl-5 font-mono text-[8px] text-[#566271]">{item.headBranch} → {item.baseBranch} · {item.author?.login ?? "Unknown author"} · {item.mergeability ?? "unknown"}</p></a>
          ))}
        </InspectorSection>
      </div>

      <div className="border-t border-[#202b38] bg-[#0a0f16] p-4">
        <div className="flex items-center gap-2"><CircleDotDashed className="size-4 text-[#7d8a99]" aria-hidden="true" /><h3 className="text-[11px] font-semibold text-[#c9d0d8]">GitHub Actions / checks</h3></div>
        {data.checkRuns.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{data.checkRuns.map((check) => <CheckItem key={check.id} check={check} />)}</div> : <p className="mt-2 text-[10px] text-[#8592a3]">{loading ? "Loading live check data…" : "No check data available."}</p>}
      </div>
    </Panel>
  );
}

function Metric({ label, value, detail, mono, tone = "neutral" }: { label: string; value: string; detail?: string; mono?: boolean; tone?: "neutral" | "safe" | "warning" | "danger" }) {
  return <div className="rounded-lg border border-[#25303d] bg-[#0a0f16] p-3"><dt className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#687586]">{label}</dt><dd className={cn("mt-2 truncate text-xs font-semibold", mono && "font-mono", tone === "safe" ? "text-[#c6f135]" : tone === "warning" ? "text-[#ffbe55]" : tone === "danger" ? "text-[#ff7d84]" : "text-[#d2d8df]")}>{value}</dd>{detail ? <p className="mt-1 truncate text-[9px] text-[#566271]" title={detail}>{detail}</p> : null}</div>;
}

function InspectorSection({ title, icon: Icon, empty, children }: { title: string; icon: typeof GitBranch; empty: string; children: React.ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return <section className="min-w-0 p-4 sm:p-5"><div className="flex items-center gap-2"><Icon className="size-4 text-[#82952e]" aria-hidden="true" /><h3 className="text-[11px] font-semibold text-[#d2d8df]">{title}</h3></div><div className="mt-3 divide-y divide-[#1d2631]">{hasChildren ? children : <p className="py-4 text-[10px] text-[#596675]">{empty}</p>}</div></section>;
}

function CheckItem({ check }: { check: CheckRun }) {
  const passed = check.status === "completed" && ["success", "neutral", "skipped"].includes(check.conclusion ?? "");
  const failed = check.status === "completed" && !passed;
  const Icon = passed ? CheckCircle2 : failed ? XCircle : CircleDotDashed;
  const content = <><Icon className={cn("size-3.5 shrink-0", passed ? "text-[#c6f135]" : failed ? "text-[#ff7d84]" : "text-[#ffbe55]")} /><span className="min-w-0 flex-1 truncate">{check.name}</span><span className="font-mono text-[8px] uppercase text-[#647182]">{check.conclusion ?? check.status}</span></>;
  return check.url ? <a href={check.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-[#26313e] bg-[#0d131c] p-3 text-[10px] text-[#aeb8c3]">{content}</a> : <div className="flex items-center gap-2 rounded-lg border border-[#26313e] bg-[#0d131c] p-3 text-[10px] text-[#aeb8c3]">{content}</div>;
}

function WarningStrip({ text, danger = false }: { text: string; danger?: boolean }) {
  return <div className={cn("flex items-start gap-2 border-b border-[#3e351e] bg-[#231c10] px-5 py-3 text-[10px] leading-5 text-[#d8ba75]", danger && "border-[#492b31] bg-[#26161a] text-[#e6a0a6]")}><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{text}</div>;
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`block ${className}`}><span className="mb-2 block text-[11px] font-semibold text-[#aeb7c2]">{label}</span>{children}</label>;
}

function ProjectNotice({ title, description, href, label }: { title: string; description: string; href: string; label: string }) {
  return <Panel className="grid min-h-64 place-items-center p-6 text-center"><div className="max-w-md"><GitBranch className="mx-auto size-7 text-[#71802c]" /><h2 className="mt-4 text-base font-semibold text-white">{title}</h2><p className="mt-2 text-xs leading-5 text-[#748191]">{description}</p><Link href={href} className="primary-action mt-4 justify-center">{label}<ArrowRight className="size-4" /></Link></div></Panel>;
}

function summarizeChecks(checkRuns: CheckRun[]): { label: string; tone: "neutral" | "safe" | "warning" | "danger" } {
  if (!checkRuns.length) return { label: "No check data", tone: "neutral" };
  if (checkRuns.some((check) => check.status !== "completed")) return { label: "Pending", tone: "warning" };
  if (checkRuns.some((check) => !["success", "neutral", "skipped"].includes(check.conclusion ?? ""))) return { label: "Failing", tone: "danger" };
  return { label: "Passing", tone: "safe" };
}

function labelForInspectorKey(key: keyof Omit<InspectorData, "warnings">) {
  return ({ branches: "Branch data", commits: "Commit data", pullRequests: "Pull request data", checkRuns: "Check data" })[key];
}

function shortSha(sha: string) { return sha.slice(0, 7); }
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
