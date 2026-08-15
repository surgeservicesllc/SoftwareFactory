"use client";

import { useEffect, useState } from "react";

import type { PortfolioView } from "@/lib/portfolio/aggregate";
import { Card, Notice } from "@/components/ui";

/**
 * Owner controls over the portfolio, as explicit actions.
 *
 * Goal 13 asks for a global Bot Manager that can carry portfolio goals like
 * "focus engineering on Project A" or "pause feature work". These are those
 * goals as buttons and selects rather than free text, because goal 14 binds
 * the global manager too: commands never guess. A form whose project is a
 * dropdown cannot misresolve an ambiguous name.
 *
 * Every action lands on an owner-only SECURITY DEFINER function that writes an
 * activity event. A non-owner sees the controls and receives the database's
 * refusal, verbatim — the truthful rendering of "you cannot do this", rather
 * than hiding the panel and implying the capability does not exist.
 */

type ActionState =
  | { phase: "idle" }
  | { phase: "working" }
  | { phase: "done"; message: string }
  | { phase: "failed"; message: string };

async function postControl(body: unknown): Promise<string> {
  const response = await fetch("/api/portfolio/controls", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null;
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "The action was refused.");
  }
  return "Applied.";
}

export function PortfolioControls() {
  const [projects, setProjects] = useState<readonly { id: string; name: string }[]>([]);
  const [projectId, setProjectId] = useState("");
  const [priority, setPriority] = useState("1");
  const [reason, setReason] = useState("");
  const [state, setState] = useState<ActionState>({ phase: "idle" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/portfolio", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<{ portfolio: PortfolioView }>;
      })
      .then((body) => {
        if (cancelled || !body) return;
        const rows = body.portfolio.projects.map((p) => ({ id: p.id, name: p.name }));
        setProjects(rows);
        if (rows.length > 0) setProjectId((current) => current || rows[0].id);
      })
      .catch(() => {
        // The panel stays usable-looking but empty; actions require a project.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(body: unknown) {
    setState({ phase: "working" });
    try {
      setState({ phase: "done", message: await postControl(body) });
    } catch (cause) {
      setState({
        phase: "failed",
        message: cause instanceof Error ? cause.message : "The action was refused.",
      });
    }
  }

  const trimmedReason = reason.trim();
  const disabled = state.phase === "working" || projectId === "";

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Portfolio controls</h2>
          <p className="text-xs text-muted">
            Owner-only. Each action is recorded as an activity event; nothing already running is
            touched.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Project
            <select
              className="rounded border border-edge bg-transparent px-2 py-1 text-sm text-foreground"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted">
            Priority
            <select
              className="rounded border border-edge bg-transparent px-2 py-1 text-sm text-foreground"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
            >
              <option value="0">P0 — incident</option>
              <option value="1">P1</option>
              <option value="2">P2</option>
              <option value="3">P3</option>
            </select>
          </label>

          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted">
            Reason
            <input
              className="rounded border border-edge bg-transparent px-2 py-1 text-sm text-foreground"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Recorded in the activity trail"
              maxLength={500}
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-edge px-3 py-1 text-sm hover:bg-surface"
            disabled={disabled}
            onClick={() =>
              run({
                action: "set_priority",
                projectId,
                priority: Number(priority),
                ...(trimmedReason ? { reason: trimmedReason } : {}),
              })}
          >
            Set priority
          </button>
          <button
            type="button"
            className="rounded border border-edge px-3 py-1 text-sm hover:bg-surface"
            disabled={disabled || trimmedReason === ""}
            title="A pause reason is required"
            onClick={() =>
              run({ action: "set_pause", projectId, paused: true, reason: trimmedReason })}
          >
            Pause engineering
          </button>
          <button
            type="button"
            className="rounded border border-edge px-3 py-1 text-sm hover:bg-surface"
            disabled={disabled}
            onClick={() =>
              run({
                action: "set_pause",
                projectId,
                paused: false,
                ...(trimmedReason ? { reason: trimmedReason } : {}),
              })}
          >
            Resume
          </button>
          <button
            type="button"
            className="rounded border border-edge px-3 py-1 text-sm hover:bg-surface"
            disabled={disabled}
            onClick={() =>
              run({
                action: "focus",
                projectIds: [projectId],
                ...(trimmedReason ? { reason: trimmedReason } : {}),
              })}
          >
            Focus engineering here
          </button>
          <button
            type="button"
            className="rounded border border-edge px-3 py-1 text-sm hover:bg-surface"
            disabled={state.phase === "working"}
            onClick={() =>
              run({
                action: "focus",
                projectIds: [],
                ...(trimmedReason ? { reason: trimmedReason } : {}),
              })}
          >
            Clear focus
          </button>
          <button
            type="button"
            className="rounded border border-edge px-3 py-1 text-sm hover:bg-surface"
            disabled={disabled || trimmedReason === ""}
            title="An archive reason is required"
            onClick={() => run({ action: "archive", projectId, reason: trimmedReason })}
          >
            Archive project
          </button>
          <button
            type="button"
            className="rounded border border-edge px-3 py-1 text-sm hover:bg-surface"
            disabled={disabled}
            onClick={() =>
              run({
                action: "unarchive",
                projectId,
                ...(trimmedReason ? { reason: trimmedReason } : {}),
              })}
          >
            Unarchive
          </button>
        </div>

        {state.phase === "done" && <Notice tone="info">{state.message}</Notice>}
        {state.phase === "failed" && <Notice tone="danger">{state.message}</Notice>}
      </div>
    </Card>
  );
}
