"use client";

import { GitFork, Link2, Link2Off, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

/**
 * The GitHub repository a project develops, and the control to change it.
 *
 * A project is the unit bots and runs attach to; the repository is what work
 * actually lands in. Keeping that choice on the project — rather than only on
 * the Connections page, where it first shipped — puts it where a person is
 * when they decide what a project should build.
 *
 * The refusals belong to the server and are shown verbatim: a repository
 * already linked to another project, a project with reserved work in flight,
 * an archived project. Nothing here second-guesses them.
 */

type PickerRepository = {
  id: number;
  fullName: string;
  defaultBranch: string;
  archived: boolean;
  disabled?: boolean;
  selected: boolean;
};

type PickerConnection = {
  id: string;
  status: string;
  account: { login: string } | null;
  installation: { id: number } | null;
  repositories: PickerRepository[];
};

export function ProjectRepository({
  projectId,
  projectName,
  currentRepository,
  currentRepositoryId,
  connections,
  onChanged,
}: {
  projectId: string;
  projectName: string;
  currentRepository: string | null;
  currentRepositoryId: number | null;
  connections: PickerConnection[];
  onChanged: () => Promise<void> | void;
}) {
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState<"link" | "unlink" | null>(null);
  const [notice, setNotice] = useState("");

  // Every repository a connected installation can actually read: selected,
  // not archived, not disabled. A repository the app cannot read is not a
  // choice, and offering it would only produce a failure later.
  const options = useMemo(() => {
    const multipleAccounts = connections.filter(
      (connection) => connection.status === "connected" && connection.installation,
    ).length > 1;
    return connections
      .filter((connection) => connection.status === "connected" && connection.installation)
      .flatMap((connection) => connection.repositories
        .filter((repository) => repository.selected && !repository.archived && !repository.disabled)
        .map((repository) => ({
          value: `${connection.id}:${repository.id}`,
          label: multipleAccounts && connection.account
            ? `${repository.fullName} (${connection.account.login})`
            : repository.fullName,
          repositoryId: repository.id,
        })));
  }, [connections]);

  const currentValue = useMemo(() => {
    if (currentRepositoryId === null) return "";
    return options.find((option) => option.repositoryId === currentRepositoryId)?.value ?? "";
  }, [options, currentRepositoryId]);

  const selectedValue = choice || currentValue;

  async function link() {
    const [connectionId, repositoryIdText] = selectedValue.split(":");
    const repositoryId = Number(repositoryIdText);
    if (!connectionId || !Number.isSafeInteger(repositoryId) || repositoryId <= 0) return;
    setBusy("link");
    setNotice("");
    try {
      const response = await fetch(`/api/projects/${projectId}/repository`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, repositoryId }),
      });
      const body = (await response.json()) as {
        project?: { githubRepository?: string };
        error?: { message?: string };
      };
      if (!response.ok) {
        setNotice(body.error?.message ?? "The project repository could not be changed safely.");
        return;
      }
      setChoice("");
      setNotice(`${projectName} now develops ${body.project?.githubRepository ?? "the selected repository"}.`);
      await onChanged();
    } catch {
      setNotice("The project repository could not be changed safely.");
    } finally {
      setBusy(null);
    }
  }

  async function unlink() {
    const confirmed = window.confirm(
      `Unlink ${currentRepository ?? "the repository"} from ${projectName}?\n\nThe project and its history are kept. New repository work cannot start until a repository is linked again.`,
    );
    if (!confirmed) return;
    setBusy("unlink");
    setNotice("");
    try {
      const response = await fetch(`/api/projects/${projectId}/repository`, { method: "DELETE" });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        setNotice(body.error?.message ?? "The project repository could not be unlinked safely.");
        return;
      }
      setChoice("");
      setNotice(`${projectName} no longer develops a GitHub repository.`);
      await onChanged();
    } catch {
      setNotice("The project repository could not be unlinked safely.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border-t border-line p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="label">Repository this project develops</p>
        <span className="truncate text-sm text-faint">
          {currentRepository ?? "None linked"}
        </span>
      </div>

      {options.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          No readable repository is available yet. Authorize one for SoftwareFactory on GitHub,
          then choose it here.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <label htmlFor={`repository-${projectId}`} className="field-label">
              GitHub repository
            </label>
            <select
              id={`repository-${projectId}`}
              value={selectedValue}
              onChange={(event) => setChoice(event.target.value)}
              className="input"
            >
              <option value="">Choose a repository</option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void link()}
            disabled={busy !== null || !selectedValue || selectedValue === currentValue}
            className="btn btn-primary btn-sm"
          >
            {busy === "link" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Link2 className="size-4" aria-hidden="true" />
            )}
            {currentRepository ? "Change repository" : "Link repository"}
          </button>
          {currentRepository ? (
            <button
              type="button"
              onClick={() => void unlink()}
              disabled={busy !== null}
              className="btn btn-secondary btn-sm"
            >
              {busy === "unlink" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Link2Off className="size-4" aria-hidden="true" />
              )}
              Unlink
            </button>
          ) : null}
        </div>
      )}

      {notice ? (
        <p className="mt-2 text-sm text-[var(--warning)]" aria-live="polite">{notice}</p>
      ) : null}

      {!currentRepository ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-faint">
          <GitFork className="size-3.5 shrink-0" aria-hidden="true" />
          Until a repository is linked, this project has nothing for a bot to modify or develop.
        </p>
      ) : null}
    </div>
  );
}
