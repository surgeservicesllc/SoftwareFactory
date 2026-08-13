"use client";

import { ArrowUp, CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";

const examples = [
  "Audit this repository",
  "Fix high-priority bugs",
  "Review security",
  "Improve mobile performance",
  "Plan the next sprint",
] as const;

const commandTypes = [
  { value: "fix_bug", label: "Fix a bug" },
  { value: "build_feature", label: "Build a feature" },
  { value: "audit", label: "Audit or review" },
  { value: "test", label: "Add or improve tests" },
  { value: "mobile", label: "Improve mobile UX" },
  { value: "performance", label: "Improve performance" },
  { value: "security", label: "Security work" },
  { value: "other", label: "Other engineering work" },
] as const;

const riskOptions = [
  { tier: "GREEN", label: "Low", detail: "Read-only or test-only work", tone: "safe" },
  { tier: "YELLOW", label: "Medium", detail: "Reversible code changes in a draft PR", tone: "warning" },
  { tier: "RED", label: "High", detail: "Recorded for owner review; not executable in Phase 1C", tone: "danger" },
] as const;

type CommandType = (typeof commandTypes)[number]["value"];
type RiskTier = (typeof riskOptions)[number]["tier"];

type SubmissionState =
  | { kind: "idle" }
  | { kind: "pending" }
  | {
      kind: "success";
      effectiveRisk: string;
      id: string;
      repository: string;
      requiresOwnerApproval: boolean;
      workerDispatch: "delayed" | "not_applicable" | "requested";
    }
  | { kind: "error"; message: string };

type ProjectOption = {
  connectionStatus?: "connected" | "not_connected";
  id: string;
  name: string;
  status: string;
};

type PendingIntent = {
  fingerprint: string;
  idempotencyKey: string;
};

const riskToneClass = {
  safe: "border-[var(--accent-border)] bg-[var(--accent-surface)] text-[var(--accent-text)]",
  warning: "border-[var(--warning-border)] bg-[var(--warning-surface)] text-[var(--warning)]",
  danger: "border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger)]",
} as const;

function acceptanceCriteriaFromText(value: string) {
  return value
    .split("\n")
    .map((criterion) => criterion.trim())
    .filter(Boolean);
}

export function CommandComposer({ onSaved }: { onSaved?: () => void } = {}) {
  const [instruction, setInstruction] = useState("");
  const [commandType, setCommandType] = useState<CommandType>("other");
  const [acceptanceText, setAcceptanceText] = useState("");
  const [riskLevel, setRiskLevel] = useState<RiskTier>("GREEN");
  const [state, setState] = useState<SubmissionState>({ kind: "idle" });
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState("");
  const [projectsState, setProjectsState] = useState<"loading" | "ready" | "unavailable">("loading");
  const pendingIntent = useRef<PendingIntent | null>(null);

  function markEdited() {
    pendingIntent.current = null;
    if (state.kind !== "idle") setState({ kind: "idle" });
  }

  useEffect(() => {
    let active = true;
    async function loadProjects() {
      try {
        const response = await fetch("/api/projects", { cache: "no-store" });
        const body = (await response.json()) as { projects?: ProjectOption[] };
        if (!response.ok) throw new Error("Project selection unavailable");
        if (!active) return;
        const availableProjects = (body.projects ?? []).filter(
          (project) => project.connectionStatus === "connected",
        );
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
    const acceptanceCriteria = acceptanceCriteriaFromText(acceptanceText);
    if (!trimmed) {
      setState({ kind: "error", message: "Describe the engineering outcome before queuing it." });
      return;
    }
    if (!projectId) {
      setState({ kind: "error", message: "Choose a project with a live GitHub connection first." });
      return;
    }
    if (acceptanceCriteria.length > 12) {
      setState({ kind: "error", message: "Use no more than 12 acceptance criteria." });
      return;
    }

    const fingerprint = JSON.stringify({
      acceptanceCriteria,
      commandType,
      projectId,
      prompt: trimmed,
      risk: riskLevel,
    });
    if (pendingIntent.current?.fingerprint !== fingerprint) {
      pendingIntent.current = {
        fingerprint,
        idempotencyKey: `command:${crypto.randomUUID()}`,
      };
    }

    setState({ kind: "pending" });

    try {
      const response = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acceptanceCriteria,
          commandType,
          idempotencyKey: pendingIntent.current.idempotencyKey,
          parameters: {},
          projectId,
          prompt: trimmed,
          risk: riskLevel.toLowerCase(),
        }),
      });
      const body = (await response.json()) as {
        command?: { id?: string };
        commandId?: string;
        error?: { message?: string } | string;
        message?: string;
        orchestration?: { effectiveRisk?: string; repository?: string };
        requiresOwnerApproval?: boolean;
        execution?: { workerDispatch?: "delayed" | "not_applicable" | "requested" };
      };

      if (!response.ok) {
        const apiError = body.error;
        const errorMessage =
          typeof apiError === "string"
            ? apiError
            : apiError && typeof apiError === "object"
              ? apiError.message
              : body.message;
        throw new Error(errorMessage || "The command could not be queued.");
      }

      const id = body.command?.id ?? body.commandId ?? "queued";
      const repository = body.orchestration?.repository ?? "connected repository";
      const effectiveRisk = body.orchestration?.effectiveRisk?.toUpperCase() ?? riskLevel;
      pendingIntent.current = null;
      setState({
        kind: "success",
        effectiveRisk,
        id,
        repository,
        requiresOwnerApproval: body.requiresOwnerApproval === true,
        workerDispatch: body.execution?.workerDispatch ?? "not_applicable",
      });
      setInstruction("");
      setAcceptanceText("");
      onSaved?.();
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "The command could not be queued safely.",
      });
    }
  }

  const projectPlaceholder =
    projectsState === "loading"
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
          markEdited();
        }}
        rows={4}
        maxLength={4000}
        placeholder="Describe the engineering outcome you want…"
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
              markEdited();
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
            Project
          </label>
          <select
            id="command-project"
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              markEdited();
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

        <div>
          <label htmlFor="command-type" className="field-label">
            Work type
          </label>
          <select
            id="command-type"
            value={commandType}
            onChange={(event) => {
              setCommandType(event.target.value as CommandType);
              markEdited();
            }}
            className="input"
          >
            {commandTypes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-5">
        <label htmlFor="acceptance-criteria" className="field-label">
          Acceptance criteria <span className="font-normal text-faint">(optional, one per line)</span>
        </label>
        <textarea
          id="acceptance-criteria"
          value={acceptanceText}
          onChange={(event) => {
            setAcceptanceText(event.target.value);
            markEdited();
          }}
          rows={3}
          maxLength={6000}
          placeholder={"Tests pass\nMobile layout has no overflow\nA draft pull request is created"}
          className="input resize-y"
        />
      </div>

      <fieldset className="mt-5">
        <legend className="field-label">Requested minimum risk tier</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {riskOptions.map((option) => (
            <button
              key={option.tier}
              type="button"
              onClick={() => {
                setRiskLevel(option.tier);
                markEdited();
              }}
              aria-pressed={riskLevel === option.tier}
              className={cn(
                "min-h-14 rounded-lg border px-3 py-2 text-left transition-colors",
                riskLevel === option.tier
                  ? riskToneClass[option.tone]
                  : "border-line text-muted hover:border-line-strong hover:text-foreground",
              )}
            >
              <span className="block text-sm font-semibold">{option.label} · {option.tier}</span>
              <span className="mt-0.5 block text-xs font-normal opacity-90">{option.detail}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p id="command-help" className="text-sm text-muted">
          The server re-checks the project, policy risk, and repository binding before it queues work.
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
          {state.kind === "pending" ? "Queuing…" : "Queue command"}
        </button>
      </div>

      <div id="command-status" aria-live="polite">
        {riskLevel === "RED" && state.kind === "idle" ? (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-surface)] p-3 text-sm text-[var(--danger)]">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            RED commands are recorded for owner review but cannot be claimed by the Phase 1C worker.
          </p>
        ) : null}
        {state.kind === "success" ? (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-surface)] p-3 text-sm text-[var(--accent-text)]">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {state.requiresOwnerApproval
              ? `Command ${state.id} is recorded as ${state.effectiveRisk} and remains blocked from Phase 1C execution.`
              : state.workerDispatch === "delayed"
                ? `Command ${state.id} is queued durably for ${state.repository}; it starts only when a connected worker claims it.`
              : `Command ${state.id} is queued for ${state.repository} as ${state.effectiveRisk}.`}
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
