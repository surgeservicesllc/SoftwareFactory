"use client";

import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Card, SectionTitle } from "@/components/ui";
import { SDLC_LIFECYCLE } from "@/lib/sdlc/lifecycle";

/**
 * One sentence in, one lifecycle out.
 *
 * The reference asks for a person to describe what they want and have the
 * system carry it through all ten stages. This is the front door for that: a
 * project, a sentence, and a button. It records the sentence as the graph's
 * goal — verbatim, because `graphs.goal` is what every downstream surface shows
 * as "what this run is for", and paraphrasing there would be the product
 * telling someone what they meant.
 *
 * ## What it deliberately does not claim
 *
 * Launching plans a graph; it does not run one. `create_graph_from_plan` writes
 * the nodes and edges and stops, and the executor worker claims recorded graphs
 * when it is dispatched with a subscription credential. There is no credential
 * configured in this repository, so the honest thing to say after a successful
 * launch is that the graph is planned and waiting — which is what this says,
 * rather than "your run has started".
 */

type Project = { readonly id: string; readonly name: string };
type State = "loading" | "signed-out" | "setup" | "no-projects" | "ready";

type Launched = {
  readonly graphId: string;
  readonly goal: string;
  readonly nodeCount: number;
  readonly maxParallelism: number;
  readonly note: string;
};

export function FactoryIntake() {
  const [state, setState] = useState<State>("loading");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [launched, setLaunched] = useState<Launched | null>(null);

  const loadProjects = useCallback(async () => {
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      if (response.status === 401) {
        setState("signed-out");
        return;
      }
      if (response.status === 409) {
        setState("setup");
        return;
      }
      const body = (await response.json()) as { projects?: Project[] };
      const rows = body.projects ?? [];
      setProjects(rows);
      setProjectId((current) => current || (rows[0]?.id ?? ""));
      setState(rows.length === 0 ? "no-projects" : "ready");
    } catch {
      // A project list that cannot be read is not a reason to hide the form's
      // explanation; it is a reason not to offer a picker that would submit an
      // id nobody chose.
      setState("no-projects");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void loadProjects(), 0);
    return () => window.clearTimeout(kickoff);
  }, [loadProjects]);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!projectId || goal.trim().length === 0) return;
      setBusy(true);
      setProblem("");
      setLaunched(null);
      try {
        const response = await fetch("/api/graphs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            templateKey: "agentic_sdlc",
            goal: goal.trim(),
          }),
        });
        const body = (await response.json()) as Partial<Launched> & {
          error?: { message?: string; details?: string[] };
        };
        if (!response.ok) {
          // The route's own sentence, including the compiler's refusals. A
          // friendlier one written here would discard the only text that says
          // what is actually wrong.
          setProblem(
            [body.error?.message, ...(body.error?.details ?? [])]
              .filter(Boolean)
              .join(" ")
            || "The request could not be recorded.",
          );
          return;
        }
        setLaunched({
          graphId: body.graphId ?? "",
          goal: body.goal ?? goal.trim(),
          nodeCount: body.nodeCount ?? 0,
          maxParallelism: body.maxParallelism ?? 1,
          note: body.note ?? "",
        });
        setGoal("");
      } catch {
        setProblem("The request did not reach the server.");
      } finally {
        setBusy(false);
      }
    },
    [goal, projectId],
  );

  return (
    <Card className="p-5">
      <SectionTitle
        title="Describe what you want"
        description={
          "One sentence. It becomes a ten-stage run: the request is turned into criteria that "
          + "can be checked, what already exists is found and scored before anything is built, "
          + "and the result is reviewed, proved and watched."
        }
      />

      {state === "loading" ? (
        <div className="mt-5 flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading your projects.
        </div>
      ) : null}

      {state === "signed-out" ? (
        <p className="mt-5 text-sm text-muted">
          <Link className="font-medium text-accent-text underline underline-offset-4" href="/auth/sign-in">Sign in</Link> to start a run. A run belongs
          to a project in your organization.
        </p>
      ) : null}

      {state === "setup" ? (
        <p className="mt-5 text-sm text-muted">
          <Link className="font-medium text-accent-text underline underline-offset-4" href="/auth/onboarding">Finish setting up your organization</Link>
          {" "}before starting a run.
        </p>
      ) : null}

      {state === "no-projects" ? (
        <p className="mt-5 text-sm text-muted">
          A run belongs to a project, and there is no project to attach one to yet.{" "}
          <Link className="font-medium text-accent-text underline underline-offset-4" href="/solutions/projects">Create a project</Link> first.
        </p>
      ) : null}

      {state === "ready" ? (
        <form className="mt-5 space-y-4" onSubmit={(event) => void submit(event)}>
          <div>
            <label className="label" htmlFor="factory-intake-project">
              Project
            </label>
            <select
              id="factory-intake-project"
              className="input mt-1.5"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="factory-intake-goal">
              What do you want built?
            </label>
            <textarea
              id="factory-intake-goal"
              className="input mt-1.5 min-h-24"
              maxLength={4000}
              placeholder="Add world-class backtesting to my trading platform."
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
            />
            <p className="mt-1.5 text-xs text-muted">
              Stored word for word as the run&rsquo;s goal. Every stage is measured against it.
            </p>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || goal.trim().length === 0 || projectId.length === 0}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="size-4" aria-hidden="true" />
            )}
            Start the lifecycle
          </button>
        </form>
      ) : null}

      {problem ? (
        <p role="alert" className="mt-4 text-sm text-[var(--danger)]">
          {problem}
        </p>
      ) : null}

      {launched ? (
        <div role="status" className="mt-5 rounded-lg border border-line-strong bg-surface-raised p-4 text-sm">
          <p className="font-medium text-foreground">Recorded: {launched.goal}</p>
          <p className="mt-1 text-muted">
            {launched.nodeCount} nodes across {SDLC_LIFECYCLE.length} stages, up to{" "}
            {launched.maxParallelism} running at once.
          </p>
          {/* The route's own sentence about what has and has not happened. It
              says the graph is planned rather than started, and that
              distinction is the whole reason it is repeated here. */}
          <p className="mt-2 text-muted">{launched.note}</p>
          <Link className="btn btn-secondary btn-sm mt-3" href="/solutions/factory/requirement">
            Open 1 Requirement
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      ) : null}
    </Card>
  );
}
