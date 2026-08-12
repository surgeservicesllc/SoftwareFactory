"use client";

import { ArrowUp, CheckCircle2, Loader2, ShieldAlert, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";

const examples = [
  "Audit this repository",
  "Fix high-priority bugs",
  "Review security",
  "Improve mobile performance",
  "Plan the next sprint",
] as const;

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

export function CommandComposer() {
  const [instruction, setInstruction] = useState("");
  const [riskLevel, setRiskLevel] = useState<"GREEN" | "YELLOW" | "RED">("GREEN");
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
      setState({ kind: "error", message: "Describe the outcome you want before submitting." });
      return;
    }
    if (!projectId) {
      setState({
        kind: "error",
        message: "Choose a connected project before submitting this command.",
      });
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
        throw new Error(errorMessage || "The command could not be saved.");
      }

      const id = body.command?.id ?? body.commandId ?? "queued";
      setState({ kind: "success", id });
      setInstruction("");
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The command could not be saved. Supabase may not be connected.",
      });
    }
  }

  return (
    <form onSubmit={submitCommand} className="panel panel-grid overflow-hidden rounded-xl">
      <div className="border-b border-[#26313e] px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg border border-[#35451d] bg-[#c6f135]/[0.08] text-[#c6f135]">
              <Sparkles className="size-3.5" aria-hidden="true" />
            </span>
            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-[#819164]">Command intake</span>
          </div>
          <span className="inline-flex items-center gap-1.5 text-[10px] text-[#687586]">
            <span className="size-1.5 rounded-full bg-[#ff6b72]" aria-hidden="true" />
            Worker Not Connected
          </span>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <label className="mb-3 block">
          <span className="mb-2 block font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-[#788596]">Project context</span>
          <select
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setState({ kind: "idle" });
            }}
            disabled={projectsState !== "ready" || projects.length === 0}
            className="h-9 w-full rounded-lg border border-[#2b3644] bg-[#0a0f16] px-3 text-[11px] text-[#d8dee5] disabled:cursor-not-allowed disabled:text-[#687586]"
          >
            {projectsState === "loading" ? <option>Loading projects…</option> : null}
            {projectsState === "unavailable" ? <option>Supabase or authentication Not Connected</option> : null}
            {projectsState === "ready" && projects.length === 0 ? <option>No connected projects</option> : null}
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.status}</option>)}
          </select>
        </label>
        <label htmlFor="bot-command" className="sr-only">Tell the Bot Manager what to do</label>
        <textarea
          id="bot-command"
          value={instruction}
          onChange={(event) => {
            setInstruction(event.target.value);
            if (state.kind !== "idle") setState({ kind: "idle" });
          }}
          rows={5}
          maxLength={4000}
          placeholder="Tell the Bot Manager what to do..."
          className="w-full resize-y border-0 bg-transparent px-1 py-2 text-lg leading-8 text-[#eef2f5] placeholder:text-[#505c6a] focus:outline-none sm:text-xl"
          aria-describedby="command-help command-status"
        />
        <p id="command-help" className="mt-1 px-1 text-[10px] leading-5 text-[#637081]">
          Submissions are stored as queued intent in Supabase. Nothing is executed until a future authenticated worker, policy check, and approval flow are connected.
        </p>

        <div className="mt-5 flex flex-wrap gap-2" aria-label="Example commands">
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                setInstruction(example);
                setState({ kind: "idle" });
              }}
              className="min-h-8 rounded-md border border-[#293543] bg-[#101720] px-2.5 text-[10px] font-medium text-[#8491a1] transition-colors hover:border-[#3a4859] hover:text-[#c4ccd5]"
            >
              {example}
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-[#202a36] pt-4 sm:flex-row sm:items-end sm:justify-between">
          <fieldset>
            <legend className="mb-2 font-mono text-[9px] uppercase tracking-[0.13em] text-[#647182]">Declared maximum risk</legend>
            <div className="flex gap-1.5">
              {(["GREEN", "YELLOW", "RED"] as const).map((tier) => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => setRiskLevel(tier)}
                  aria-pressed={riskLevel === tier}
                  className={cn(
                    "min-h-8 rounded-md border px-2.5 font-mono text-[9px] font-bold tracking-[0.1em]",
                    riskLevel === tier
                      ? tier === "GREEN"
                        ? "border-[#445d20] bg-[#1a250f] text-[#c6f135]"
                        : tier === "YELLOW"
                          ? "border-[#5a4725] bg-[#2e2312] text-[#ffbe55]"
                          : "border-[#5a3035] bg-[#311a1e] text-[#ff7d84]"
                      : "border-[#293442] bg-[#10161f] text-[#627080]",
                  )}
                >
                  {tier}
                </button>
              ))}
            </div>
          </fieldset>
          <button
            type="submit"
            disabled={state.kind === "pending" || instruction.trim().length === 0 || !projectId}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#c6f135] px-4 text-xs font-bold text-[#0c1102] transition-colors hover:bg-[#d7ff4e] disabled:cursor-not-allowed disabled:bg-[#313924] disabled:text-[#697251]"
          >
            {state.kind === "pending" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ArrowUp className="size-4" aria-hidden="true" />}
            {state.kind === "pending" ? "Saving intent…" : "Submit command"}
          </button>
        </div>

        <div id="command-status" aria-live="polite" className="mt-4">
          {riskLevel === "RED" && state.kind === "idle" ? (
            <p className="flex items-start gap-2 rounded-lg border border-[#502c31] bg-[#2b181c] p-3 text-[10px] leading-5 text-[#e59399]">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              RED commands may be recorded, but Phase 1 requires a separate, explicit owner approval before execution.
            </p>
          ) : null}
          {state.kind === "success" ? (
            <p className="flex items-start gap-2 rounded-lg border border-[#36491d] bg-[#18220f] p-3 text-[10px] leading-5 text-[#c5dd77]">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[#c6f135]" aria-hidden="true" />
              Command {state.id} was saved as queued control-plane intent. No AI worker executed it.
            </p>
          ) : null}
          {state.kind === "error" ? (
            <p className="flex items-start gap-2 rounded-lg border border-[#502c31] bg-[#2b181c] p-3 text-[10px] leading-5 text-[#e59399]">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {state.message} No execution occurred.
            </p>
          ) : null}
        </div>
      </div>
    </form>
  );
}
