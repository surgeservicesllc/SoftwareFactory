"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  FileText,
  Folder,
  GitPullRequestArrow,
  Loader2,
  RefreshCw,
  Save,
  Search,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { BlockedState, Card, StatusBadge } from "@/components/ui";
import { cn } from "@/lib/cn";

type Project = { id: string; name: string; githubRepository: string | null; defaultBranch: string; connectionId: string | null; connectionStatus: "connected" | "not_connected" };
type TreeEntry = { name: string; path: string; type: "directory" | "file" | "symlink" | "submodule"; sha: string; size: number; url: string };
type RepositoryFile = { path: string; sha: string; size: number; encoding: "utf-8"; content: string; url: string; ref: string };
type Commit = { sha: string; message: string; author: { name: string; githubLogin: string | null }; date: string | null; url: string };
type PullRequestResult = { number: number; title: string; url: string; draft: boolean; state: string };
type LoadState = "loading" | "signed-out" | "setup" | "ready" | "error";
type SaveState = "idle" | "saving" | "conflict" | "error" | "saved";
type PendingSaveIntent = { fingerprint: string; idempotencyKey: string };
type ProtectedApprovalRequirement = {
  path: string;
  requiredConfirmation: string;
  risk: "RED";
};
type ProtectedApprovalInput = {
  confirmation: string;
  reason: string;
  rollbackPlan: string;
};

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
  const [protectedApprovalRequirement, setProtectedApprovalRequirement] = useState<ProtectedApprovalRequirement | null>(null);
  const [protectedApprovalConfirmation, setProtectedApprovalConfirmation] = useState("");
  const [protectedApprovalReason, setProtectedApprovalReason] = useState("");
  const [protectedApprovalRollbackPlan, setProtectedApprovalRollbackPlan] = useState("");
  const fileRef = useRef<RepositoryFile | null>(null);
  const dirtyRef = useRef(false);
  const pendingSaveIntentRef = useRef<PendingSaveIntent | null>(null);

  const clearProtectedApproval = useCallback(() => {
    setProtectedApprovalRequirement(null);
    setProtectedApprovalConfirmation("");
    setProtectedApprovalReason("");
    setProtectedApprovalRollbackPlan("");
  }, []);

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

  /* Unsaved edits survive a stray click or tab close. */
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
      if (!window.confirm("Leave this page and lose your unsaved changes?")) {
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
    if (fileRef.current && dirtyRef.current && !options.preserveFile && !window.confirm("Discard your unsaved changes?")) return;
    const [activeOwner, activeRepository] = activeProject.githubRepository.split("/");
    if (!activeOwner || !activeRepository) return;
    setLoadingTree(true);
    setMessage("");
    try {
      const queryString = new URLSearchParams({ connectionId: activeProject.connectionId, ref: activeProject.defaultBranch, path: nextPath });
      const response = await fetch(`/api/github/repositories/${encodeURIComponent(activeOwner)}/${encodeURIComponent(activeRepository)}/tree?${queryString}`, { cache: "no-store" });
      const body = (await response.json()) as { entries?: TreeEntry[]; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "This folder could not be loaded.");
      setEntries(sortEntries(body.entries ?? []));
      setDirectoryPath(nextPath);
      if (!options.preserveFile) {
        pendingSaveIntentRef.current = null;
        clearProtectedApproval();
        setFile(null);
        setContent("");
        setLastCommit(null);
        setSaveState("idle");
        setCreatedPullRequest(null);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "This folder could not be loaded.");
    } finally {
      setLoadingTree(false);
    }
  }, [clearProtectedApproval, project]);

  useEffect(() => {
    if (!project) return;
    const timer = window.setTimeout(() => void loadDirectory("", project), 0);
    return () => window.clearTimeout(timer);
  }, [loadDirectory, project]);

  async function fetchFile(entry: TreeEntry, confirmDiscard = true) {
    if (!project?.connectionId) return;
    if (confirmDiscard && file?.path !== entry.path && isDirty && !window.confirm("Discard your unsaved changes?")) return;
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
      if (!contentResponse.ok || !body.file) throw new Error(body.error?.message ?? "This file could not be opened.");
      const commitBody = (await commitResponse.json()) as { commits?: Commit[] };
      setFile(body.file);
      pendingSaveIntentRef.current = null;
      clearProtectedApproval();
      setContent(body.file.content);
      setLastCommit(commitResponse.ok ? commitBody.commits?.[0] ?? null : null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "This file could not be opened.");
      setSaveState("error");
    } finally {
      setLoadingFile(false);
    }
  }

  async function reloadFile() {
    if (!file) return;
    if (isDirty && !window.confirm("Load the latest version from GitHub and lose your unsaved changes?")) return;
    await fetchFile({ name: file.path.split("/").at(-1) ?? file.path, path: file.path, type: "file", sha: file.sha, size: file.size, url: file.url }, false);
  }

  async function saveAsDraftPullRequest(protectedApproval?: ProtectedApprovalInput) {
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
          ...(protectedApproval ? { protectedApproval } : {}),
        }),
      });
      const body = (await response.json()) as {
        pullRequest?: PullRequestResult;
        error?: {
          code?: string;
          message?: string;
          path?: string;
          requiredConfirmation?: string;
          risk?: string;
        };
      };
      if (!response.ok || !body.pullRequest) {
        if (
          response.status === 409
          && (
            ["stale_file", "github_conflict"].includes(body.error?.code ?? "")
            || /changed in github|reload it before saving|conflict/i.test(body.error?.message ?? "")
          )
        ) {
          setSaveState("conflict");
          setMessage("Someone changed this file in GitHub after you opened it. Load the latest version, reapply your edit, then try again.");
          return;
        }
        if (
          response.status === 428
          && body.error?.code === "protected_resource_approval_required"
          && body.error.requiredConfirmation
          && body.error.path === file.path
          && body.error.risk === "RED"
        ) {
          setProtectedApprovalRequirement({
            path: body.error.path,
            requiredConfirmation: body.error.requiredConfirmation,
            risk: "RED",
          });
          setSaveState("idle");
          setMessage("Review the RED scope below. No provider write has occurred.");
          return;
        }
        throw new Error(body.error?.message ?? "The draft pull request could not be created.");
      }
      pendingSaveIntentRef.current = null;
      clearProtectedApproval();
      setCreatedPullRequest(body.pullRequest);
      setSaveState("saved");
      setMessage("Draft pull request created. Nothing was merged or deployed.");
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "The draft pull request could not be created.");
    }
  }

  function approveProtectedDraftPullRequest() {
    if (!protectedApprovalRequirement) return;
    void saveAsDraftPullRequest({
      confirmation: protectedApprovalConfirmation,
      reason: protectedApprovalReason.trim(),
      rollbackPlan: protectedApprovalRollbackPlan.trim(),
    });
  }

  function changeProject(projectId: string) {
    if (isDirty && !window.confirm("Switch projects and lose your unsaved changes?")) return;
    setSelectedProjectId(projectId);
    pendingSaveIntentRef.current = null;
    clearProtectedApproval();
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

  if (state === "loading") {
    return (
      <Card className="grid min-h-[420px] place-items-center">
        <Loader2 className="size-6 animate-spin text-accent" aria-label="Loading files" />
      </Card>
    );
  }
  if (state === "signed-out") return <BlockedState icon={Folder} title="Sign in to browse your files" description="Repository files are visible only to members of your organization." href="/auth/sign-in?next=/files" label="Sign in" />;
  if (state === "setup" || (state === "ready" && !projects.length)) return <BlockedState icon={Folder} title="No connected project yet" description="Add a project first, then come back to browse and edit its files." href="/solutions/projects" label="Add a project" />;
  if (state === "error" || !project) return <BlockedState icon={Folder} title="Files are unavailable" description={message || "This repository could not be loaded."} href="/solutions/connections" label="Check connections" />;

  const parentPath = directoryPath.includes("/") ? directoryPath.slice(0, directoryPath.lastIndexOf("/")) : "";
  const protectedApprovalReady = Boolean(
    protectedApprovalRequirement
    && protectedApprovalConfirmation === protectedApprovalRequirement.requiredConfirmation
    && protectedApprovalReason.trim().length >= 20
    && protectedApprovalReason.trim().length <= 500
    && protectedApprovalRollbackPlan.trim().length >= 20
    && protectedApprovalRollbackPlan.trim().length <= 500,
  );

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="truncate font-medium text-foreground">{project.githubRepository}</p>
          <StatusBadge tone="safe">{project.defaultBranch}</StatusBadge>
        </div>
        {projects.length > 1 ? (
          <select aria-label="Project" value={project.id} onChange={(event) => changeProject(event.target.value)} className="input sm:w-56">
            {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        ) : null}
      </Card>

      <div className="card overflow-hidden lg:grid lg:min-h-[640px] lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-b border-line lg:border-b-0 lg:border-r" aria-label="Repository files">
          <div className="border-b border-line p-3">
            <label className="relative block">
              <span className="sr-only">Search this folder</span>
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden="true" />
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this folder…" className="input pl-9" />
            </label>
          </div>

          <div className="flex min-h-12 items-center gap-2 border-b border-line px-3">
            <button
              type="button"
              onClick={() => void loadDirectory(parentPath)}
              disabled={!directoryPath || loadingTree}
              className="btn btn-secondary btn-sm size-9 px-0"
              aria-label="Go up one folder"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => void loadDirectory(directoryPath, project, { preserveFile: true })}
              disabled={loadingTree}
              className="btn btn-secondary btn-sm size-9 px-0"
              aria-label="Refresh this folder"
            >
              <RefreshCw className={cn("size-4", loadingTree && "animate-spin")} aria-hidden="true" />
            </button>
            <p className="min-w-0 flex-1 truncate text-sm text-muted">/{directoryPath}</p>
          </div>

          <div className="max-h-80 overflow-y-auto p-2 lg:max-h-[520px]">
            {loadingTree ? (
              <div className="grid min-h-40 place-items-center">
                <Loader2 className="size-5 animate-spin text-accent" aria-label="Loading folder" />
              </div>
            ) : visibleEntries.length ? (
              <ul>
                {visibleEntries.map((entry) => (
                  <li key={entry.sha + entry.path}>
                    <button
                      type="button"
                      onClick={() => entry.type === "directory" ? void loadDirectory(entry.path) : void fetchFile(entry)}
                      className={cn(
                        "flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors",
                        file?.path === entry.path
                          ? "bg-[var(--accent-surface)] text-[var(--accent-text)]"
                          : "text-muted hover:bg-surface-raised hover:text-foreground",
                      )}
                    >
                      {entry.type === "directory"
                        ? <Folder className="size-4 shrink-0 text-accent" aria-hidden="true" />
                        : <FileText className="size-4 shrink-0 text-faint" aria-hidden="true" />}
                      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-8 text-center text-sm text-faint">
                {query ? "Nothing matches that search." : "This folder is empty."}
              </p>
            )}
          </div>
        </aside>

        <section className="min-w-0">
          <header className="border-b border-line px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate font-medium text-foreground">{file?.path ?? "Pick a file"}</h2>
                {isDirty ? <StatusBadge tone="warning" dot={false}>Unsaved</StatusBadge> : null}
              </div>
              {file ? (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex rounded-lg border border-line p-0.5">
                    {(["edit", "preview"] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setMode(tab)}
                        aria-pressed={mode === tab}
                        className={cn(
                          "min-h-8 rounded px-3 text-sm font-medium capitalize transition-colors",
                          mode === tab ? "bg-surface-raised text-foreground" : "text-muted",
                        )}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => void reloadFile()} disabled={loadingFile} className="btn btn-secondary btn-sm">
                    <RefreshCw className={cn("size-4", loadingFile && "animate-spin")} aria-hidden="true" />
                    Reload
                  </button>
                  <button
                    id="save-github-file"
                    type="button"
                    onClick={() => void saveAsDraftPullRequest()}
                    disabled={!isDirty || saveState === "saving" || saveState === "saved" || Boolean(protectedApprovalRequirement)}
                    className="btn btn-primary btn-sm"
                  >
                    {saveState === "saving" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    Propose change
                  </button>
                </div>
              ) : null}
            </div>
          </header>

          {protectedApprovalRequirement ? (
            <form
              className="space-y-4 border-b border-[var(--danger-border)] bg-[var(--danger-surface)] px-4 py-4"
              onSubmit={(event) => {
                event.preventDefault();
                approveProtectedDraftPullRequest();
              }}
              aria-label={`Approve protected change to ${protectedApprovalRequirement.path}`}
            >
              <div className="flex items-start gap-3 text-sm text-[var(--danger)]">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <div>
                  <strong className="font-semibold">RED protected-file approval</strong>
                  <p className="mt-1">
                    Only an organization owner can authorize this exact content change. Approval expires after 15 minutes
                    and creates an isolated draft pull request only. It does not write the default branch, merge, or deploy.
                  </p>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-foreground">Type this exact phrase</p>
                <code className="mt-1 block break-all rounded-md border border-line bg-surface-inset px-3 py-2 text-xs text-foreground">
                  {protectedApprovalRequirement.requiredConfirmation}
                </code>
                <input
                  aria-label="Protected change confirmation"
                  autoComplete="off"
                  className="input mt-2"
                  maxLength={1100}
                  onChange={(event) => setProtectedApprovalConfirmation(event.target.value)}
                  value={protectedApprovalConfirmation}
                />
              </div>

              <label className="block">
                <span className="text-sm font-medium text-foreground">Reason for this protected change</span>
                <textarea
                  aria-label="Protected change reason"
                  className="input mt-1 min-h-24 resize-y"
                  maxLength={500}
                  minLength={20}
                  onChange={(event) => setProtectedApprovalReason(event.target.value)}
                  required
                  value={protectedApprovalReason}
                />
                <span className="mt-1 block text-xs text-muted">20–500 characters. Do not include credentials.</span>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-foreground">Rollback or containment plan</span>
                <textarea
                  aria-label="Protected change rollback or containment plan"
                  className="input mt-1 min-h-24 resize-y"
                  maxLength={500}
                  minLength={20}
                  onChange={(event) => setProtectedApprovalRollbackPlan(event.target.value)}
                  required
                  value={protectedApprovalRollbackPlan}
                />
                <span className="mt-1 block text-xs text-muted">20–500 characters. State how the draft can be withdrawn or contained.</span>
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={!protectedApprovalReady || saveState === "saving"}
                >
                  {saveState === "saving" ? <Loader2 className="size-4 animate-spin" /> : <GitPullRequestArrow className="size-4" />}
                  Approve RED draft PR
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={saveState === "saving"}
                  onClick={() => {
                    clearProtectedApproval();
                    pendingSaveIntentRef.current = null;
                    setMessage("Protected change approval cancelled. No provider write occurred.");
                    setSaveState("idle");
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          {saveState === "conflict" ? (
            <div className="flex items-start gap-3 border-b border-[var(--danger-border)] bg-[var(--danger-surface)] px-4 py-3 text-sm text-[var(--danger)]" role="alert">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div>
                <strong className="font-semibold">This file changed in GitHub</strong>
                <p className="mt-0.5">{message}</p>
                <button type="button" onClick={() => void reloadFile()} className="mt-2 font-medium underline underline-offset-4">
                  Load the latest version
                </button>
              </div>
            </div>
          ) : null}

          {loadingFile ? (
            <div className="grid min-h-[420px] place-items-center">
              <Loader2 className="size-6 animate-spin text-accent" aria-label="Opening file" />
            </div>
          ) : file ? (
            <div>
              {mode === "edit" ? (
                <textarea
                  value={content}
                  onChange={(event) => { pendingSaveIntentRef.current = null; clearProtectedApproval(); setContent(event.target.value); setCreatedPullRequest(null); setSaveState("idle"); setMessage(""); }}
                  spellCheck
                  className="min-h-[420px] w-full resize-y border-0 bg-surface-inset p-4 font-mono text-sm leading-6 text-foreground focus:outline-none sm:p-6"
                  aria-label={`Edit ${file.path}`}
                />
              ) : (
                <article className="prose-dark min-h-[420px] overflow-auto p-5 sm:p-8">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      img: ({ alt }) => (
                        <span role="img" aria-label={alt || "External image omitted"} className="block rounded-lg border border-line p-3 text-sm text-faint">
                          External image preview omitted for privacy.
                        </span>
                      ),
                    }}
                  >
                    {content}
                  </ReactMarkdown>
                </article>
              )}

              <footer className="flex flex-col gap-2 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p
                  className={cn(
                    "flex items-start gap-2 text-sm",
                    saveState === "error" || saveState === "conflict" ? "text-[var(--danger)]" : "text-muted",
                  )}
                  aria-live="polite"
                >
                  {saveState === "saved" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" /> : null}
                  {message || (isDirty
                    ? "Your changes are only in this browser so far."
                    : "Editing a file opens a draft pull request for you to review. It never writes to the main branch.")}
                </p>
                <div className="flex items-center gap-2">
                  {createdPullRequest ? (
                    <a href={createdPullRequest.url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                      <GitPullRequestArrow className="size-4" aria-hidden="true" />
                      Open PR #{createdPullRequest.number}
                      <ExternalLink className="size-4" aria-hidden="true" />
                    </a>
                  ) : lastCommit ? (
                    <a href={lastCommit.url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                      Last changed {lastCommit.date ? formatDate(lastCommit.date) : "at an unknown time"}
                      <ExternalLink className="size-4" aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
              </footer>
            </div>
          ) : (
            <div className="grid min-h-[420px] place-items-center p-8 text-center">
              <div className="max-w-sm">
                <FileText className="mx-auto size-8 text-faint" aria-hidden="true" />
                <p className="mt-4 font-semibold text-foreground">Pick a file to read or edit</p>
                <p className="mt-2 text-sm text-muted">
                  Files are read live from GitHub. Very large files, binary files, and protected files
                  cannot be edited here.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function preferredPath(path: string) { return path === "AGENTS.md" || preferredPathPrefixes.some((prefix) => path.startsWith(prefix)); }
function sortEntries(entries: TreeEntry[]) {
  return [...entries].sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    const leftPreferred = preferredPath(left.path);
    const rightPreferred = preferredPath(right.path);
    if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }

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
