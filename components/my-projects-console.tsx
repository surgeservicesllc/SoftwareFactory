"use client";

import { ChevronDown, FolderTree, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { type Connection, type Project, ProjectInspector } from "@/components/projects-console";
import { BlockedState, Card, SectionTitle, StatusBadge } from "@/components/ui";
import { cn } from "@/lib/cn";

type State = "loading" | "signed-out" | "setup" | "ready" | "error";

/**
 * My Projects: every project in the workspace as a collapsible row, per the
 * owner's 2026-08-17 design. The row states the project's identity; the down
 * arrow opens the same live inspector the Projects page renders — one source
 * of truth for project detail, reached from two reading postures. The data is
 * the same two live reads the Projects page makes; nothing here is computed
 * or illustrative.
 */
export function MyProjectsConsole() {
  const [state, setState] = useState<State>("loading");
  const [projects, setProjects] = useState<Project[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [message, setMessage] = useState("");
  // Keyed by project id; the first project opens expanded (the state the
  // design shows) and the rest start folded so a long portfolio scans as a
  // list. Only set once — a refresh must not undo what the person folded.
  const [expanded, setExpanded] = useState<Record<string, boolean> | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const [projectsResponse, connectionsResponse] = await Promise.all([
        fetch("/api/projects", { cache: "no-store" }),
        fetch("/api/github/connections", { cache: "no-store" }),
      ]);
      if (projectsResponse.status === 401 || connectionsResponse.status === 401) {
        setState("signed-out");
        return;
      }
      if (projectsResponse.status === 409 || connectionsResponse.status === 409) {
        setState("setup");
        return;
      }
      const projectsBody = (await projectsResponse.json()) as { projects?: Project[]; error?: { message?: string } };
      const connectionsBody = (await connectionsResponse.json()) as { connections?: Connection[]; error?: { message?: string } };
      if (!projectsResponse.ok) throw new Error(projectsBody.error?.message ?? "Projects could not be loaded.");
      if (!connectionsResponse.ok) throw new Error(connectionsBody.error?.message ?? "GitHub connections could not be loaded.");
      const loaded = projectsBody.projects ?? [];
      setProjects(loaded);
      setConnections(connectionsBody.connections ?? []);
      setExpanded((current) => current ?? (loaded[0] ? { [loaded[0].id]: true } : {}));
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Projects could not be loaded.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (state === "loading") {
    return (
      <Card className="grid min-h-64 place-items-center">
        <Loader2 className="size-6 animate-spin text-accent" aria-label="Loading projects" />
      </Card>
    );
  }
  if (state === "signed-out") return <BlockedState icon={FolderTree} title="Sign in to see your projects" description="Projects belong to your organization." href="/auth/sign-in?next=/solutions/myprojects" label="Sign in" />;
  if (state === "setup") return <BlockedState icon={FolderTree} title="Finish setting up" description="Create or choose a workspace before linking a repository." href="/solutions/connections" label="Open connections" />;
  if (state === "error") return <BlockedState icon={FolderTree} title="Projects are unavailable" description={message || "Your projects could not be loaded."} href="/solutions/connections" label="Check connections" />;

  if (!projects.length) {
    return (
      <Card className="p-5 sm:p-6">
        <SectionTitle
          title="No projects yet"
          description="A project is one GitHub repository. Add your first one and it appears here with its live branches, commits, and pull requests."
        />
        <Link href="/solutions/projects#add-project" className="btn btn-primary btn-sm mt-4">
          <Plus className="size-4" aria-hidden="true" />
          New Project
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {projects.map((project) => {
        const isExpanded = Boolean(expanded?.[project.id]);
        return (
          <section key={project.id} aria-label={project.name}>
            <button
              type="button"
              onClick={() => setExpanded((current) => ({ ...current, [project.id]: !current?.[project.id] }))}
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? "Hide" : "Show"} ${project.name} details`}
              className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-line-strong"
            >
              <ChevronDown
                className={cn("size-4 shrink-0 text-muted transition-transform", !isExpanded && "-rotate-90")}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-semibold text-foreground">{project.name}</span>
                <span className="block truncate text-sm text-muted">
                  {project.githubRepository ?? "No repository linked"} · {project.defaultBranch}
                </span>
              </span>
              <StatusBadge tone={project.connectionStatus === "connected" ? "safe" : "danger"}>
                {project.connectionStatus === "connected" ? "Connected" : "Not Connected"}
              </StatusBadge>
            </button>
            {isExpanded ? (
              <div className="mt-2">
                <ProjectInspector
                  project={project}
                  connection={connections.find((item) => item.id === project.connectionId) ?? null}
                  connections={connections}
                  onChanged={load}
                />
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
