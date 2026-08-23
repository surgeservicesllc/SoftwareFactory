"use client";

import { GitFork, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { BlockedState, Card, SectionTitle } from "@/components/ui";

/**
 * The add-a-project form, self-contained so both the Projects dashboard and
 * the AI Factory journey embed the identical control: same reads, same
 * create call, same refusals. It renders its own honest gates — connect
 * GitHub first, or "every repository is taken" — rather than a dead form.
 */

type Repository = {
  id: number;
  fullName: string;
  defaultBranch: string;
  archived: boolean;
  disabled?: boolean;
  selected: boolean;
};

type Connection = {
  id: string;
  name?: string | null;
  status: string;
  account: { login: string; type: string | null } | null;
  installation: { id: number; suspendedAt: string | null } | null;
  repositories: Repository[];
};

type ProjectSummary = { githubRepositoryId: number | null };
type ReadState = "loading" | "ready" | "error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRepository(value: unknown): value is Repository {
  return isRecord(value)
    && typeof value.id === "number"
    && typeof value.fullName === "string"
    && typeof value.defaultBranch === "string"
    && typeof value.archived === "boolean"
    && (value.disabled === undefined || typeof value.disabled === "boolean")
    && typeof value.selected === "boolean";
}

function isConnection(value: unknown): value is Connection {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.status !== "string"
    || !Array.isArray(value.repositories)
    || !value.repositories.every(isRepository)) {
    return false;
  }
  const account = value.account;
  const installation = value.installation;
  return (account === null
      || (isRecord(account)
        && typeof account.login === "string"
        && (typeof account.type === "string" || account.type === null)))
    && (installation === null
      || (isRecord(installation)
        && typeof installation.id === "number"
        && (typeof installation.suspendedAt === "string" || installation.suspendedAt === null)));
}

function parseProjectsPayload(value: unknown): ProjectSummary[] | null {
  if (!isRecord(value) || !Array.isArray(value.projects)) return null;
  return value.projects.every(
    (project) => isRecord(project)
      && (typeof project.githubRepositoryId === "number" || project.githubRepositoryId === null),
  )
    ? value.projects as ProjectSummary[]
    : null;
}

function parseConnectionsPayload(value: unknown): Connection[] | null {
  if (!isRecord(value) || !Array.isArray(value.connections)) return null;
  return value.connections.every(isConnection) ? value.connections : null;
}

export function AddProjectForm({
  id,
  onCreated,
}: {
  id?: string;
  onCreated?: (projectId: string) => Promise<void> | void;
}) {
  const [readState, setReadState] = useState<ReadState>("loading");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [projectRepositoryIds, setProjectRepositoryIds] = useState<number[]>([]);
  const [hasProjects, setHasProjects] = useState(false);
  const [connectionId, setConnectionId] = useState("");
  const [repositoryId, setRepositoryId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setReadState("loading");
    try {
      const [projectsResponse, connectionsResponse] = await Promise.all([
        fetch("/api/projects", { cache: "no-store" }),
        fetch("/api/github/connections", { cache: "no-store" }),
      ]);
      if (!projectsResponse.ok || !connectionsResponse.ok) {
        throw new Error("Project setup reads failed.");
      }
      const [projectsBody, connectionsBody] = await Promise.all([
        projectsResponse.json() as Promise<unknown>,
        connectionsResponse.json() as Promise<unknown>,
      ]);
      const projects = parseProjectsPayload(projectsBody);
      const nextConnections = parseConnectionsPayload(connectionsBody);
      if (!projects || !nextConnections) throw new Error("Project setup reads were invalid.");

      setHasProjects(projects.length > 0);
      setProjectRepositoryIds(
        projects
          .map((project) => project.githubRepositoryId)
          .filter((value): value is number => typeof value === "number"),
      );
      setConnections(nextConnections);
      setReadState("ready");
    } catch {
      setReadState("error");
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
    () => availableRepositories.filter((repository) => !projectRepositoryIds.includes(repository.id)),
    [availableRepositories, projectRepositoryIds],
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
      const body: unknown = await response.json();
      const errorMessage = isRecord(body)
        && isRecord(body.error)
        && typeof body.error.message === "string"
        ? body.error.message
        : "The project could not be added.";
      if (!response.ok) throw new Error(errorMessage);
      const createdProjectId = isRecord(body)
        && isRecord(body.project)
        && typeof body.project.id === "string"
        && body.project.id.trim().length > 0
        ? body.project.id
        : null;
      if (!createdProjectId) {
        throw new Error(
          "The project was saved, but its exact identity could not be confirmed. Reload Projects before continuing.",
        );
      }
      setMessage(`${name} is connected. Its live GitHub data is on Projects.`);
      setName("");
      setDescription("");
      setRepositoryId("");
      await load();
      await onCreated?.(createdProjectId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The project could not be added.");
    } finally {
      setSaving(false);
    }
  }

  if (readState === "loading") {
    return (
      <Card className="grid min-h-24 place-items-center">
        <Loader2 className="size-5 animate-spin text-accent" aria-label="Loading the project form" />
      </Card>
    );
  }

  if (readState === "error") {
    return (
      <Card className="grid min-h-64 place-items-center p-8 text-center">
        <div className="max-w-md">
          <h2 className="text-lg font-semibold text-foreground">Project setup is unavailable</h2>
          <p className="mt-2 text-muted">
            We could not verify your current projects and GitHub connections. No empty state was inferred from missing data.
          </p>
          <button type="button" className="btn btn-primary mt-5" onClick={() => void load()}>
            Retry
          </button>
        </div>
      </Card>
    );
  }

  if (!connectedConnections.length) {
    return (
      <BlockedState
        icon={GitFork}
        title="Connect GitHub first"
        description="A repository becomes a project only after you have authorized GitHub."
        href="/solutions/connections"
        label="Connect GitHub"
      />
    );
  }

  if (!unconnectedRepositories.length && hasProjects) {
    return (
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
    );
  }

  return (
    /* The id anchors the navigation's "New Project" quick action; the
       scroll margin keeps the heading clear of the fixed mobile header. */
    <Card id={id} className="scroll-mt-24 p-5 sm:p-6">
      <SectionTitle
        title="Add a project"
        description="Pick one of the repositories you authorized. The branch comes straight from GitHub."
      />

      <form onSubmit={createProject} className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
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
  );
}
