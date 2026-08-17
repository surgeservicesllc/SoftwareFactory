"use client";

import { ArrowUp, CheckCircle2, ChevronRight, Loader2, ShieldAlert } from "lucide-react";
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

type TaskOption = {
  id: string;
  project: { id: string; name: string } | null;
  status: string;
  title: string;
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

function canonicalTaskIds(taskIds: readonly string[]) {
  return [...new Set(taskIds)].sort((left, right) => left.localeCompare(right));
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
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [tasksState, setTasksState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [dependencyTaskIds, setDependencyTaskIds] = useState<string[]>([]);
  // Simple by default: describing the outcome and picking a project is the whole
  // job. Work type, acceptance criteria, dependencies, and the risk tier are
  // real controls, but they all carry safe defaults — so they open on demand
  // rather than confronting every owner every time.
  const [showAdvanced, setShowAdvanced] = useState(false);
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
        // A person arriving from a specific project ("give this project work")
        // means that project. Honour it when it is genuinely available, and
        // fall back to the first rather than leaving an empty selection that
        // silently disables the button.
        const requested = new URLSearchParams(window.location.search).get("project");
        const preselected = requested
          && availableProjects.some((project) => project.id === requested)
          ? requested
          : availableProjects[0]?.id ?? "";
        setProjectId(preselected);
        setProjectsState("ready");

        try {
          const tasksResponse = await fetch("/api/tasks?limit=100", { cache: "no-store" });
          const tasksBody = (await tasksResponse.json()) as { tasks?: TaskOption[] };
          if (!tasksResponse.ok) throw new Error("Dependency selection unavailable");
          if (!active) return;
          setTasks(tasksBody.tasks ?? []);
          setTasksState("ready");
        } catch {
          if (active) setTasksState("unavailable");
        }
      } catch {
        if (active) {
          setProjectsState("unavailable");
          setTasksState("unavailable");
        }
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
    const canonicalDependencyTaskIds = canonicalTaskIds(dependencyTaskIds);
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
      dependencyTaskIds: canonicalDependencyTaskIds,
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
          dependencyTaskIds: canonicalDependencyTaskIds,
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
      setDependencyTaskIds([]);
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
  const dependencyOptions = tasks.filter(
    (task) => task.project?.id === projectId && !["cancelled", "failed"].includes(task.status),
  );
  const acceptanceCount = acceptanceCriteriaFromText(acceptanceText).length;
  const advancedSummary = [
    commandType !== "other"
      ? commandTypes.find((option) => option.value === commandType)?.label
      : null,
    riskLevel !== "GREEN" ? `${riskLevel} risk requested` : null,
    acceptanceCount
      ? `${acceptanceCount} acceptance criteri${acceptanceCount === 1 ? "on" : "a"}`
      : null,
    dependencyTaskIds.length
      ? `${dependencyTaskIds.length} dependenc${dependencyTaskIds.length === 1 ? "y" : "ies"}`
      : null,
  ].filter((part): part is string => Boolean(part));

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
              setDependencyTaskIds([]);
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
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => setShowAdvanced((open) => !open)}
          aria-expanded={showAdvanced}
          aria-controls="advanced-options"
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
        >
          <ChevronRight
            className={cn("size-4 transition-transform", showAdvanced && "rotate-90")}
            aria-hidden="true"
          />
          Advanced options
        </button>
        {!showAdvanced && advancedSummary.length ? (
          // Anything non-default chosen behind the fold stays visible when the
          // fold is closed — hidden-but-active settings are how owners get
          // surprised.
          <p className="text-xs text-faint">{advancedSummary.join(" · ")}</p>
        ) : null}
      </div>

      <div id="advanced-options" className={showAdvanced ? "space-y-5 pt-1" : undefined}>
      {showAdvanced ? (<>
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

      <div>
        <label htmlFor="acceptance-criteria" className="field-label">
          Acceptance criteria <span className="font-normal text-faint">(optional, one per line; derived from work type when blank)</span>
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

      <fieldset>
        <legend className="field-label">Depends on existing work <span className="font-normal text-faint">(optional)</span></legend>
        <p className="mb-2 text-sm text-muted">
          Selected work must belong to this project and complete before the new run can start.
        </p>
        {tasksState === "loading" ? (
          <p className="rounded-lg border border-line p-3 text-sm text-muted">Loading project backlog…</p>
        ) : tasksState === "unavailable" ? (
          <p className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning)]">
            Existing work could not be loaded. You can still queue this command without dependencies.
          </p>
        ) : dependencyOptions.length === 0 ? (
          <p className="rounded-lg border border-line p-3 text-sm text-faint">No eligible backlog items exist for this project.</p>
        ) : (
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
            {dependencyOptions.map((task) => {
              const checked = dependencyTaskIds.includes(task.id);
              const selectionFull = dependencyTaskIds.length >= 20;
              return (
                <li key={task.id}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 text-sm hover:bg-surface-raised">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && selectionFull}
                      onChange={(event) => {
                        setDependencyTaskIds((current) => canonicalTaskIds(
                          event.target.checked
                            ? [...current, task.id]
                            : current.filter((taskId) => taskId !== task.id),
                        ));
                        markEdited();
                      }}
                      className="mt-0.5 size-4"
                    />
                    <span className="min-w-0">
                      <span className="block font-medium text-foreground">{task.title}</span>
                      <span className="block text-faint">{task.status.replace(/_/g, " ")}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {dependencyTaskIds.length ? (
          <p className="mt-2 text-xs text-faint">{dependencyTaskIds.length} of 20 dependencies selected.</p>
        ) : null}
      </fieldset>

      <fieldset>
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
      </>) : null}
      </div>

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
