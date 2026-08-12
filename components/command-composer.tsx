"use client";

import { ArrowUp, CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";

const examples = [
  "Audit this repository",
  "Fix high-priority bugs",
  "Review security",
  "Improve mobile performance",
  "Plan the next sprint",
] as const;

/**
 * The API takes GREEN/YELLOW/RED. People do not think in colours, so the
 * button says what the tier actually means and keeps the tier as a subtitle.
 */
const riskOptions = [
  { tier: "GREEN", label: "Low", detail: "Safe and easy to undo", tone: "safe" },
  { tier: "YELLOW", label: "Medium", detail: "Changes how something works", tone: "warning" },
  { tier: "RED", label: "High", detail: "Touches something sensitive", tone: "danger" },
] as const;

type RiskTier = (typeof riskOptions)[number]["tier"];

type SubmissionState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "success"; id: string }
  | { kind: "error"; message: string };

type ProjectOption = {
  id: string;
  name: string;
  status: string;
};

const riskToneClass = {
  safe: "border-[var(--accent-border)] bg-[var(--accent-surface)] text-[var(--accent-text)]",
  warning: "border-[var(--warning-border)] bg-[var(--warning-surface)] text-[var(--warning)]",
  danger: "border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger)]",
} as const;

export function CommandComposer({ onSaved }: { onSaved?: () => void } = {}) {
  const [instruction, setInstruction] = useState("");
  const [riskLevel, setRiskLevel] = useState<RiskTier>("GREEN");
  const [state, setState] = useState<SubmissionState>({ kind: "idle" });
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState("");
  const [projectsState, setProjectsState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let active = true;
    async function loadProjects() {
      try {
        const response = await fetch("/api/projects", { cache: "no-store" });
        const body = (await response.json()) as { projects?: ProjectOption[] };
        if (!response.ok) throw new Error("Project selection unavailable");
        if (!active) return;
        const availableProjects = body.projects ?? [];
        setProjects(availableProjects);
        setProjectId(availableProjects[0]?.id ?? "");
        setProjectsState("ready");
      } catch {
        if (active) setProjectsState("unavailable");
      }
    }
    void loadProjects();
    return () => {
      active = false;
    };
  }, []);

  async function submitCommand(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = instruction.trim();
    if (!trimmed) {
      setState({ kind: "error", message: "Describe what you want done before saving." });
      return;
    }
    if (!projectId) {
      setState({ kind: "error", message: "Choose a connected project first." });
      return;
    }

    setState({ kind: "pending" });

    try {
      const response = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          risk: riskLevel.toLowerCase(),
          projectId,
          parameters: {},
        }),
      });
      const body = (await response.json()) as {
        command?: { id?: string };
        commandId?: string;
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        const apiError = body.error;
        const errorMessage =
          typeof apiError === "string"
            ? apiError
            : apiError && typeof apiError === "object" && "message" in apiError
              ? String((apiError as { message?: unknown }).message ?? "")
              : body.message;
        throw new Error(errorMessage || "The request could not be saved.");
      }

      const id = body.command?.id ?? body.commandId ?? "queued";
      setState({ kind: "success", id });
      setInstruction("");
      onSaved?.();
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The request could not be saved. Supabase may not be connected.",
      });
    }
  }

  const projectPlaceholder = projectsState === "loading"
    ? "Loading projects…"
    : projectsState === "unavailable"
      ? "Sign in to choose a project"
      : "No connected projects yet";

  return (
    <form onSubmit={submitCommand} className="card p-5 sm:p-6">
      <label htmlFor="bot-command" className="block text-lg font-semibold text-foreground">
        What do you want done?
      </label>
      <textarea
        id="bot-command"
        value={instruction}
        onChange={(event) => {
          setInstruction(event.target.value);
          if (state.kind !== "idle") setState({ kind: "idle" });
        }}
        rows={4}
        maxLength={4000}
        placeholder="Describe the outcome you want, in your own words…"
        className="input mt-3 resize-y text-base"
        aria-describedby="command-help command-status"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {examples.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => {
              setInstruction(example);
              setState({ kind: "idle" });
            }}
            className="rounded-full border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:border-line-strong hover:text-foreground"
          >
            {example}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="command-project" className="field-label">
            Which project?
          </label>
          <select
            id="command-project"
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setState({ kind: "idle" });
            }}
            disabled={projectsState !== "ready" || projects.length === 0}
            className="input"
          >
            {projects.length === 0 ? <option>{projectPlaceholder}</option> : null}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        <fieldset>
          <legend className="field-label">How risky is it?</legend>
          <div className="flex gap-2">
            {riskOptions.map((option) => (
              <button
                key={option.tier}
                type="button"
                onClick={() => setRiskLevel(option.tier)}
                aria-pressed={riskLevel === option.tier}
                title={option.detail}
                className={cn(
                  "min-h-10 flex-1 rounded-lg border px-2 text-sm font-semibold transition-colors",
                  riskLevel === option.tier
                    ? riskToneClass[option.tone]
                    : "border-line text-muted hover:border-line-strong hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p id="command-help" className="text-sm text-muted">
          This saves your request. Nothing runs — no worker is connected yet.
        </p>
        <button
          type="submit"
          disabled={state.kind === "pending" || instruction.trim().length === 0 || !projectId}
          className="btn btn-primary shrink-0"
        >
          {state.kind === "pending" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ArrowUp className="size-4" aria-hidden="true" />
          )}
          {state.kind === "pending" ? "Saving…" : "Save request"}
        </button>
      </div>

      <div id="command-status" aria-live="polite">
        {riskLevel === "RED" && state.kind === "idle" ? (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-surface)] p-3 text-sm text-[var(--danger)]">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            High-risk requests can be saved, but they will always need your explicit approval before
            anything happens.
          </p>
        ) : null}
        {state.kind === "success" ? (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-surface)] p-3 text-sm text-[var(--accent-text)]">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Saved as request {state.id}. Nothing has run.
          </p>
        ) : null}
        {state.kind === "error" ? (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-surface)] p-3 text-sm text-[var(--danger)]">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
