"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileCode2,
  FileText,
  Folder,
  GitCommitHorizontal,
  GitPullRequestArrow,
  Loader2,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Panel, StatusBadge } from "@/components/ui";
import { cn } from "@/lib/cn";

type Project = { id: string; name: string; githubRepository: string | null; defaultBranch: string; connectionId: string | null; connectionStatus: "connected" | "not_connected" };
type TreeEntry = { name: string; path: string; type: "directory" | "file" | "symlink" | "submodule"; sha: string; size: number; url: string };
type RepositoryFile = { path: string; sha: string; size: number; encoding: "utf-8"; content: string; url: string; ref: string };
type Commit = { sha: string; message: string; author: { name: string; githubLogin: string | null }; date: string | null; url: string };
type PullRequestResult = { number: number; title: string; url: string; draft: boolean; state: string };
type LoadState = "loading" | "signed-out" | "setup" | "ready" | "error";
type SaveState = "idle" | "saving" | "conflict" | "error" | "saved";
type PendingSaveIntent = { fingerprint: string; idempotencyKey: string };

const preferredPathPrefixes = ["AI/", "agents/", "policies/", "prompts/", "checklists/", "playbooks/", "docs/"];

export function GitHubFileManager() {
  const searchParams = useSearchParams();
  const requestedProjectId = searchParams.get("project") ?? "";
  const [state, setState] = useState<LoadState>("loading");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(requestedProjectId);
  const [directoryPath, setDirectoryPath] = useState("");
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [file, setFile] = useState<RepositoryFile | null>(null);
  const [lastCommit, setLastCommit] = useState<Commit | null>(null);
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const [createdPullRequest, setCreatedPullRequest] = useState<PullRequestResult | null>(null);
  const fileRef = useRef<RepositoryFile | null>(null);
  const dirtyRef = useRef(false);
  const pendingSaveIntentRef = useRef<PendingSaveIntent | null>(null);

  const loadProjects = useCallback(async () => {
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      if (response.status === 401) { setState("signed-out"); return; }
      if (response.status === 409) { setState("setup"); return; }
      const body = (await response.json()) as { projects?: Project[]; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Projects could not be loaded.");
      const liveProjects = (body.projects ?? []).filter(
        (project) => project.connectionStatus === "connected"
          && project.githubRepository
          && project.connectionId,
      );
      setProjects(liveProjects);
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Projects could not be loaded.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProjects(), 0);
    return () => window.clearTimeout(timer);
  }, [loadProjects]);

  const project = useMemo(() => projects.find((item) => item.id === selectedProjectId) ?? projects[0] ?? null, [projects, selectedProjectId]);
  const [owner = "", repository = ""] = project?.githubRepository?.split("/") ?? [];
  const isDirty = Boolean(file && content !== file.content && saveState !== "saved");

  useEffect(() => {
    fileRef.current = file;
    dirtyRef.current = isDirty;
  }, [file, isDirty]);

  useEffect(() => {
    function preventUnload(event: BeforeUnloadEvent) {
      if (isDirty) event.preventDefault();
    }
    function protectNavigation(event: MouseEvent) {
      if (!isDirty || event.defaultPrevented) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a[href]");
      if (!link || link.getAttribute("target") === "_blank") return;
      if (!window.confirm("Leave this page and discard unsaved GitHub file changes?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    window.addEventListener("beforeunload", preventUnload);
    document.addEventListener("click", protectNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", preventUnload);
      document.removeEventListener("click", protectNavigation, true);
    };
  }, [isDirty]);

  useEffect(() => {
    function keyboardSave(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        document.getElementById("save-github-file")?.click();
      }
    }
    window.addEventListener("keydown", keyboardSave);
    return () => window.removeEventListener("keydown", keyboardSave);
  }, []);

  const loadDirectory = useCallback(async (nextPath: string, activeProject = project, options: { preserveFile?: boolean } = {}) => {
    if (!activeProject?.connectionId || !activeProject.githubRepository) return;
    if (fileRef.current && dirtyRef.current && !options.preserveFile && !window.confirm("Discard unsaved changes to the open file?")) return;
    const [activeOwner, activeRepository] = activeProject.githubRepository.split("/");
    if (!activeOwner || !activeRepository) return;
    setLoadingTree(true);
    setMessage("");
    try {
      const queryString = new URLSearchParams({ connectionId: activeProject.connectionId, ref: activeProject.defaultBranch, path: nextPath });
      const response = await fetch(`/api/github/repositories/${encodeURIComponent(activeOwner)}/${encodeURIComponent(activeRepository)}/tree?${queryString}`, { cache: "no-store" });
      const body = (await response.json()) as { entries?: TreeEntry[]; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The repository tree could not be loaded.");
      setEntries(sortEntries(body.entries ?? []));
      setDirectoryPath(nextPath);
      if (!options.preserveFile) {
        pendingSaveIntentRef.current = null;
        setFile(null);
        setContent("");
        setLastCommit(null);
        setSaveState("idle");
        setCreatedPullRequest(null);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The repository tree could not be loaded.");
    } finally {
      setLoadingTree(false);
    }
  }, [project]);

  useEffect(() => {
    if (!project) return;
    const timer = window.setTimeout(() => void loadDirectory("", project), 0);
    return () => window.clearTimeout(timer);
  }, [loadDirectory, project]);

  async function fetchFile(entry: TreeEntry, confirmDiscard = true) {
    if (!project?.connectionId) return;
    if (confirmDiscard && file?.path !== entry.path && isDirty && !window.confirm("Discard unsaved changes to the open file?")) return;
    setLoadingFile(true);
    setMessage("");
    setCreatedPullRequest(null);
    setSaveState("idle");
    try {
      const common = { connectionId: project.connectionId, ref: project.defaultBranch, path: entry.path };
      const contentQuery = new URLSearchParams(common);
      const commitQuery = new URLSearchParams({ connectionId: project.connectionId, sha: project.defaultBranch, path: entry.path, perPage: "1" });
      const [contentResponse, commitResponse] = await Promise.all([
        fetch(`/api/github/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents?${contentQuery}`, { cache: "no-store" }),
        fetch(`/api/github/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits?${commitQuery}`, { cache: "no-store" }),
      ]);
      const body = (await contentResponse.json()) as { file?: RepositoryFile; error?: { message?: string } };
      if (!contentResponse.ok || !body.file) throw new Error(body.error?.message ?? "The GitHub file could not be loaded.");
      const commitBody = (await commitResponse.json()) as { commits?: Commit[] };
      setFile(body.file);
      pendingSaveIntentRef.current = null;
      setContent(body.file.content);
      setLastCommit(commitResponse.ok ? commitBody.commits?.[0] ?? null : null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The GitHub file could not be loaded.");
      setSaveState("error");
    } finally {
      setLoadingFile(false);
    }
  }

  async function reloadFile() {
    if (!file) return;
    if (isDirty && !window.confirm("Reload the latest GitHub version and discard your unsaved changes?")) return;
    await fetchFile({ name: file.path.split("/").at(-1) ?? file.path, path: file.path, type: "file", sha: file.sha, size: file.size, url: file.url }, false);
  }

  async function saveAsDraftPullRequest() {
    if (!project?.connectionId || !file || !isDirty) return;
    setSaveState("saving");
    setMessage("");
    try {
      const title = `Update ${file.path} via SoftwareFactory`;
      const fingerprint = githubSaveIntentFingerprint({
        baseBranch: project.defaultBranch,
        commitMessage: title,
        connectionId: project.connectionId,
        content,
        expectedBlobSha: file.sha,
        path: file.path,
        projectId: project.id,
        repository: project.githubRepository ?? "",
        title,
      });
      const pendingIntent = pendingSaveIntentRef.current;
      const idempotencyKey = pendingIntent?.fingerprint === fingerprint
        ? pendingIntent.idempotencyKey
        : `sf:${project.id}:${crypto.randomUUID()}`;
      pendingSaveIntentRef.current = { fingerprint, idempotencyKey };
      const response = await fetch(`/api/github/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/changes?connectionId=${encodeURIComponent(project.connectionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          path: file.path,
          content,
          expectedBlobSha: file.sha,
          baseBranch: project.defaultBranch,
          title,
          commitMessage: title,
          idempotencyKey,
        }),
      });
      const body = (await response.json()) as { pullRequest?: PullRequestResult; error?: { code?: string; message?: string } };
      if (!response.ok || !body.pullRequest) {
        if (
          response.status === 409
          && (
            ["stale_file", "github_conflict"].includes(body.error?.code ?? "")
            || /changed in github|reload it before saving|conflict/i.test(body.error?.message ?? "")
          )
        ) {
          setSaveState("conflict");
          setMessage("Conflict detected. GitHub has a newer file version. Reload the latest version and reconcile your edits before saving again.");
          return;
        }
        if (body.error?.code === "protected_resource") {
          setSaveState("error");
          setMessage("Owner approval required. This protected repository path cannot use the standard Phase 1B draft-PR save flow.");
          return;
        }
        throw new Error(body.error?.message ?? "The draft pull request could not be created.");
      }
      pendingSaveIntentRef.current = null;
      setCreatedPullRequest(body.pullRequest);
      setSaveState("saved");
      setMessage("Change committed on an isolated softwarefactory/* branch and opened as a draft pull request. Nothing was merged or deployed.");
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "The draft pull request could not be created.");
    }
  }

  function changeProject(projectId: string) {
    if (isDirty && !window.confirm("Switch projects and discard unsaved file changes?")) return;
    setSelectedProjectId(projectId);
    pendingSaveIntentRef.current = null;
    setDirectoryPath("");
    setEntries([]);
    setFile(null);
    setContent("");
    setQuery("");
    setMessage("");
    setLastCommit(null);
    setSaveState("idle");
    setCreatedPullRequest(null);
  }

  const visibleEntries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return entries.filter((entry) => !normalized || entry.name.toLowerCase().includes(normalized) || entry.path.toLowerCase().includes(normalized));
  }, [entries, query]);

  if (state === "loading") return <Panel className="grid min-h-[520px] place-items-center"><Loader2 className="size-6 animate-spin text-[#c6f135]" aria-label="Loading live repository" /></Panel>;
  if (state === "signed-out") return <FilesNotice title="Sign in to browse GitHub" description="Real repository files are available only to authenticated organization members." href="/sign-in?next=/files" label="Sign in" />;
  if (state === "setup" || (state === "ready" && !projects.length)) return <FilesNotice title="No connected GitHub project" description="Authorize or restore the GitHub App, then connect an active selected repository before browsing files." href="/projects" label="Open projects" />;
  if (state === "error" || !project) return <FilesNotice title="Repository unavailable" description={message || "The live repository could not be loaded."} href="/connections" label="Review connections" />;

  const parentPath = directoryPath.includes("/") ? directoryPath.slice(0, directoryPath.lastIndexOf("/")) : "";

  return (
    <div className="space-y-4">
      <Panel className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0"><p className="eyebrow">Live GitHub source</p><p className="mt-1 truncate font-mono text-xs text-[#d8dee5]">{project.githubRepository}@{project.defaultBranch}</p></div>
        <div className="flex flex-wrap items-center gap-2"><select aria-label="Project" value={project.id} onChange={(event) => changeProject(event.target.value)} className="form-control min-w-48">{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><StatusBadge tone="safe">GitHub Connected</StatusBadge></div>
      </Panel>

      <div className="panel min-h-[700px] overflow-hidden rounded-xl lg:grid lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="border-b border-[#202b38] bg-[#0a0f16] lg:border-b-0 lg:border-r" aria-label="Live GitHub repository files">
          <div className="border-b border-[#202b38] p-3">
            <label className="relative block"><span className="sr-only">Search current repository directory</span><Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#5e6a79]" aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this directory…" className="form-control pl-9" /></label>
          </div>
          <div className="flex min-h-12 items-center gap-2 border-b border-[#202b38] px-3">
            <button type="button" onClick={() => void loadDirectory(parentPath)} disabled={!directoryPath || loadingTree} className="grid size-8 place-items-center rounded-md border border-[#293442] text-[#8b98a7] disabled:opacity-35" aria-label="Parent directory"><ArrowLeft className="size-3.5" /></button>
            <button type="button" onClick={() => void loadDirectory(directoryPath, project, { preserveFile: true })} disabled={loadingTree} className="grid size-8 place-items-center rounded-md border border-[#293442] text-[#8b98a7]" aria-label="Refresh directory"><RefreshCw className={`size-3.5 ${loadingTree ? "animate-spin" : ""}`} /></button>
            <p className="min-w-0 flex-1 truncate font-mono text-[10px] text-[#718091]">/{directoryPath}</p>
          </div>
          <div className="max-h-[360px] overflow-y-auto p-2 lg:max-h-[620px]">
            {loadingTree ? <div className="grid min-h-40 place-items-center"><Loader2 className="size-5 animate-spin text-[#c6f135]" /></div> : visibleEntries.length ? visibleEntries.map((entry) => (
              <button key={entry.sha + entry.path} type="button" onClick={() => entry.type === "directory" ? void loadDirectory(entry.path) : void fetchFile(entry)} className={cn("flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-[10px] hover:bg-[#141c26] hover:text-[#d8dee5]", file?.path === entry.path ? "bg-[#c6f135]/[0.08] text-[#dffb7b]" : "text-[#8592a2]") }>
                {entry.type === "directory" ? <Folder className="size-4 shrink-0 text-[#899c38]" /> : <FileText className="size-4 shrink-0 text-[#637181]" />}
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>{preferredPath(entry.path) ? <span className="rounded border border-[#36441d] px-1 font-mono text-[7px] uppercase text-[#9cb545]">Core</span> : null}{entry.type === "directory" ? <ChevronRight className="size-3" /> : <span className="font-mono text-[8px] text-[#485462]">{formatBytes(entry.size)}</span>}
              </button>
            )) : <p className="px-3 py-8 text-center text-[10px] text-[#566271]">{query ? "No matching entries in this directory." : "No entries in this directory."}</p>}
          </div>
        </aside>

        <section className="min-w-0">
          <header className="border-b border-[#202b38] bg-[#0d131c] px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-2"><FileCode2 className="size-4 shrink-0 text-[#849427]" /><h2 className="truncate font-mono text-[11px] font-semibold text-[#d8dee5]">{file?.path ?? "Choose a file from GitHub"}</h2>{isDirty ? <span className="size-1.5 shrink-0 rounded-full bg-[#ffbe55]" title="Unsaved changes" /> : null}</div>
              <div className="flex flex-wrap items-center gap-2">
                {file ? <div className="flex rounded-md border border-[#293442] bg-[#0a0f16] p-0.5">{(["edit", "preview"] as const).map((tab) => <button key={tab} type="button" onClick={() => setMode(tab)} aria-pressed={mode === tab} className={cn("min-h-7 rounded px-2.5 text-[9px] font-semibold capitalize", mode === tab ? "bg-[#1d2632] text-[#d8dee5]" : "text-[#687586]")}>{tab}</button>)}</div> : null}
                <button type="button" onClick={() => void reloadFile()} disabled={!file || loadingFile} className="secondary-action"><RefreshCw className={cn("size-3.5", loadingFile && "animate-spin")} />Reload</button>
                <button id="save-github-file" type="button" onClick={() => void saveAsDraftPullRequest()} disabled={!isDirty || saveState === "saving" || saveState === "saved"} className="primary-action justify-center">{saveState === "saving" ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}Create draft PR</button>
              </div>
            </div>
            {file ? <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[8px] uppercase tracking-[0.08em] text-[#596675]"><div><dt className="inline">Version SHA </dt><dd className="inline text-[#8f9aa8]">{shortSha(file.sha)}</dd></div><div><dt className="inline">Size </dt><dd className="inline text-[#8f9aa8]">{formatBytes(file.size)}</dd></div><div><dt className="inline">Source </dt><dd className="inline text-[#8f9aa8]">{file.ref}</dd></div>{lastCommit ? <div><dt className="inline">Last commit </dt><dd className="inline text-[#8f9aa8]">{shortSha(lastCommit.sha)} · {lastCommit.author.githubLogin ?? lastCommit.author.name} · {lastCommit.date ? formatDate(lastCommit.date) : "Date unavailable"}</dd></div> : null}</dl> : null}
          </header>

          {saveState === "conflict" ? <div className="flex items-start gap-3 border-b border-[#543039] bg-[#2b171c] px-4 py-3 text-xs leading-5 text-[#f0a7ae]" role="alert"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><div><strong className="block text-[#ffc1c6]">Conflict detected</strong>{message}<button type="button" onClick={() => void reloadFile()} className="mt-2 underline underline-offset-4">Reload latest GitHub version</button></div></div> : null}

          {loadingFile ? <div className="grid min-h-[560px] place-items-center"><Loader2 className="size-6 animate-spin text-[#c6f135]" /></div> : file ? (
            <div>
              {mode === "edit" ? <textarea value={content} onChange={(event) => { pendingSaveIntentRef.current = null; setContent(event.target.value); setCreatedPullRequest(null); setSaveState("idle"); setMessage(""); }} spellCheck className="min-h-[540px] w-full resize-y border-0 bg-[#090e14] p-4 font-mono text-[12px] leading-6 text-[#b7c2cd] focus:outline-none sm:p-6" aria-label={`Edit ${file.path}`} /> : <article className="prose-dark min-h-[540px] overflow-auto bg-[#0b1017] p-5 sm:p-8"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></article>}
              <footer className="flex min-h-12 flex-col gap-2 border-t border-[#202b38] bg-[#0d131c] px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <p className={cn("flex items-start gap-1.5 text-[9px]", saveState === "error" || saveState === "conflict" ? "text-[#e59399]" : "text-[#718091]")} aria-live="polite">{message ? <ShieldAlert className="mt-0.5 size-3 shrink-0" /> : <CheckCircle2 className="size-3 shrink-0 text-[#829d29]" />}{message || (isDirty ? "Unsaved changes are protected during navigation and window close." : "Reads are live. Saves create an isolated branch and draft pull request.")}</p>
                <div className="flex items-center gap-2">{lastCommit ? <a href={lastCommit.url} target="_blank" rel="noreferrer" className="secondary-action"><GitCommitHorizontal className="size-3.5" />Commit {shortSha(lastCommit.sha)}<ExternalLink className="size-3" /></a> : null}{createdPullRequest ? <a href={createdPullRequest.url} target="_blank" rel="noreferrer" className="secondary-action"><GitPullRequestArrow className="size-3.5" />Draft PR #{createdPullRequest.number}<ExternalLink className="size-3" /></a> : null}</div>
              </footer>
            </div>
          ) : <div className="grid min-h-[610px] place-items-center p-8 text-center"><div><FileCode2 className="mx-auto size-9 text-[#4d5967]" /><p className="mt-4 text-sm font-semibold text-[#c6ced7]">Select a text file</p><p className="mt-2 max-w-sm text-xs leading-5 text-[#667485]">Files are fetched from GitHub at the verified default branch. Binary and oversized files fail closed; protected resources require a separate owner-approved workflow.</p></div></div>}
        </section>
      </div>
    </div>
  );
}

function FilesNotice({ title, description, href, label }: { title: string; description: string; href: string; label: string }) {
  return <Panel className="grid min-h-[520px] place-items-center p-6 text-center"><div className="max-w-md"><Folder className="mx-auto size-8 text-[#71802c]" /><h2 className="mt-4 text-base font-semibold text-white">{title}</h2><p className="mt-2 text-xs leading-5 text-[#748191]">{description}</p><Link href={href} className="primary-action mt-4 justify-center">{label}<ChevronRight className="size-4" /></Link></div></Panel>;
}

function preferredPath(path: string) { return path === "AGENTS.md" || preferredPathPrefixes.some((prefix) => path.startsWith(prefix)); }
function sortEntries(entries: TreeEntry[]) { return [...entries].sort((left, right) => {
  if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
  const leftPreferred = preferredPath(left.path);
  const rightPreferred = preferredPath(right.path);
  if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1;
  return left.name.localeCompare(right.name);
}); }
function shortSha(sha: string) { return sha.slice(0, 7); }
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function formatBytes(bytes: number) { if (bytes < 1_024) return `${bytes} B`; if (bytes < 1_024 * 1_024) return `${Math.round(bytes / 1_024)} KB`; return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`; }

export function githubSaveIntentFingerprint(intent: {
  baseBranch: string;
  commitMessage: string;
  connectionId: string;
  content: string;
  expectedBlobSha: string;
  path: string;
  projectId: string;
  repository: string;
  title: string;
}) {
  return JSON.stringify([
    intent.projectId,
    intent.connectionId,
    intent.repository,
    intent.baseBranch,
    intent.path,
    intent.expectedBlobSha,
    intent.content,
    intent.title,
    intent.commitMessage,
  ]);
}
