"use client";

import { Bot, Loader2, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * The bots serving one project, and the controls to change that set.
 *
 * A project may be served by many bots; a bot holds at most one open posting,
 * so assigning a bot here moves it from wherever it was. That rule lives in
 * the database (`assign_bot`), and this panel states it in the one place a
 * person can act on it rather than leaving it to be discovered.
 *
 * Honest about authority: an assignment is routing intent. No worker executes
 * because of it in this phase, and the panel says so instead of implying that
 * posting a bot starts work.
 */

type FabricBot = {
  id: string;
  name: string;
  provider: string;
  readiness?: string;
};

type FabricRole = {
  id: string;
  name: string;
};

type FabricAssignment = {
  id: string;
  botId: string;
  projectId: string;
  roleId: string | null;
  status: string;
};

type Fabric = {
  canManage: boolean;
  bots: FabricBot[];
  roles: FabricRole[];
  assignments: FabricAssignment[];
};

export function ProjectBots({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [fabric, setFabric] = useState<Fabric | null>(null);
  const [failed, setFailed] = useState(false);
  const [botId, setBotId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/bots", { cache: "no-store" });
      if (!response.ok) {
        // A failed read is an error state, never an empty roster pretending
        // the project has no bots.
        setFailed(true);
        return;
      }
      const body = (await response.json()) as Fabric;
      setFailed(false);
      setFabric({
        canManage: Boolean(body.canManage),
        bots: body.bots ?? [],
        roles: body.roles ?? [],
        assignments: body.assignments ?? [],
      });
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const assigned = useMemo(
    () => (fabric?.assignments ?? []).filter(
      (assignment) => assignment.projectId === projectId && assignment.status !== "released",
    ),
    [fabric, projectId],
  );

  // A bot with an open posting anywhere is not free to take. Naming where it
  // already serves is friendlier than hiding it, but this phase keeps the
  // picker to genuinely free bots so no click silently moves a bot off
  // another project.
  const availableBots = useMemo(() => {
    const posted = new Set(
      (fabric?.assignments ?? [])
        .filter((assignment) => assignment.status !== "released")
        .map((assignment) => assignment.botId),
    );
    return (fabric?.bots ?? []).filter((bot) => !posted.has(bot.id));
  }, [fabric]);

  const assign = useCallback(async () => {
    if (!botId || !roleId) return;
    setBusy("assign");
    setNotice("");
    try {
      const response = await fetch("/api/bot-assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ botId, projectId, roleId }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setNotice(body.error?.message ?? "The bot could not be assigned.");
        return;
      }
      setBotId("");
      setRoleId("");
      await load();
    } catch {
      setNotice("The bot could not be assigned.");
    } finally {
      setBusy(null);
    }
  }, [botId, roleId, projectId, load]);

  const release = useCallback(async (assignmentId: string) => {
    setBusy(assignmentId);
    setNotice("");
    try {
      const response = await fetch(`/api/bot-assignments/${assignmentId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "released" }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setNotice(body.error?.message ?? "The bot could not be released.");
        return;
      }
      await load();
    } catch {
      setNotice("The bot could not be released.");
    } finally {
      setBusy(null);
    }
  }, [load]);

  if (failed) {
    return (
      <div className="border-t border-line p-5">
        <p className="label">Bots on this project</p>
        <p className="mt-2 text-sm text-[var(--warning)]">
          The bot roster could not be loaded, so this project&apos;s bots are unknown.
        </p>
      </div>
    );
  }

  if (!fabric) return null;

  const botsById = new Map(fabric.bots.map((bot) => [bot.id, bot]));
  const rolesById = new Map(fabric.roles.map((role) => [role.id, role]));

  return (
    <div className="border-t border-line p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="label">Bots on this project</p>
        <span className="text-sm text-faint">
          {assigned.length === 0
            ? "None assigned"
            : `${assigned.length} assigned`}
        </span>
      </div>

      {assigned.length ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {assigned.map((assignment) => {
            const bot = botsById.get(assignment.botId);
            const role = assignment.roleId ? rolesById.get(assignment.roleId) : null;
            return (
              <li
                key={assignment.id}
                className="flex items-center gap-3 rounded-lg border border-line p-3"
              >
                <Bot className="size-4 shrink-0 text-accent" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {bot?.name ?? "Unknown bot"}
                  </span>
                  <span className="block truncate text-sm text-faint">
                    {role?.name ?? "No role"}
                    {assignment.status === "paused" ? " · Paused" : ""}
                  </span>
                </span>
                {fabric.canManage ? (
                  <button
                    type="button"
                    onClick={() => void release(assignment.id)}
                    disabled={busy !== null}
                    aria-label={`Release ${bot?.name ?? "bot"} from ${projectName}`}
                    className="btn btn-secondary btn-sm"
                  >
                    {busy === assignment.id ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <X className="size-3.5" aria-hidden="true" />
                    )}
                    Release
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">
          No bots serve this project yet. Assign one below — a project may have as many as you need.
        </p>
      )}

      {fabric.canManage ? (
        availableBots.length && fabric.roles.length ? (
          <form
            className="mt-4 flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void assign();
            }}
          >
            <div className="min-w-48 flex-1">
              <label htmlFor={`bot-${projectId}`} className="field-label">Bot</label>
              <select
                id={`bot-${projectId}`}
                value={botId}
                onChange={(event) => setBotId(event.target.value)}
                className="input"
              >
                <option value="">Choose a bot</option>
                {availableBots.map((bot) => (
                  <option key={bot.id} value={bot.id}>{bot.name}</option>
                ))}
              </select>
            </div>
            <div className="min-w-40 flex-1">
              <label htmlFor={`role-${projectId}`} className="field-label">Role</label>
              <select
                id={`role-${projectId}`}
                value={roleId}
                onChange={(event) => setRoleId(event.target.value)}
                className="input"
              >
                <option value="">Choose a role</option>
                {fabric.roles.map((role) => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={busy !== null || !botId || !roleId}
              className="btn btn-primary btn-sm"
            >
              {busy === "assign" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="size-4" aria-hidden="true" />
              )}
              Assign bot
            </button>
          </form>
        ) : (
          <p className="mt-3 text-sm text-faint">
            {fabric.bots.length === 0
              ? "Create a bot in Bot Manager, then assign it here."
              : availableBots.length === 0
                ? "Every bot already serves a project. Release one, or create another bot in Bot Manager."
                : "No roles are defined yet, so a bot cannot be given one."}
          </p>
        )
      ) : null}

      {notice ? (
        <p className="mt-2 text-sm text-[var(--warning)]" aria-live="polite">{notice}</p>
      ) : null}

      <p className="mt-3 text-sm text-faint">
        Assignment is routing intent: it records which bots serve this project. No worker
        executes because of it.
      </p>
    </div>
  );
}
