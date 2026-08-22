"use client";

import { Check, ClipboardList, Copy, Loader2, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { PipelineTemplateSummary } from "@/components/pipelines-console";
import { Card, StatusBadge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { NODE_CAPABILITIES } from "@/lib/graph/contracts";
import { TEMPLATE_CATEGORIES } from "@/lib/graph/templates";

/**
 * The Templates tab, with the custom half wired to Supabase: create, edit,
 * and delete organization templates through the owner/admin definer
 * functions, and plan a real graph from any template — built-in or custom —
 * through the same launch endpoint. Every topology fact shown is compiled,
 * and a definition the compiler refuses never saves.
 *
 * Use selects the template for a project and writes that selection to
 * Supabase, so it survives closing the overlay, a refresh, and a move to
 * another surface — it is a record, not a highlight this component
 * remembers. A selected card's Use turns grey and says Selected, pressing it
 * again removes the selection, and a project may select as many pipelines as
 * it needs. Planning a graph is the separate, heavier act it always was, and
 * keeps its own button.
 */

type CustomTemplate = {
  id: string;
  slug: string;
  name: string;
  summary: string;
  category?: string;
  capability?: string;
  areas?: Array<{ id: string; job: string }>;
  version: number;
  editable: boolean;
  compiles: boolean;
  topology?: string | null;
  nodeCount?: number | null;
  maxParallelism?: number | null;
  anchorNodeCount?: number | null;
  errors?: string[];
};

type PipelineSelection = {
  id: string;
  projectId: string;
  templateKey: string;
  templateId: string | null;
};

type EditorSeed = {
  id?: string;
  slug: string;
  name: string;
  summary: string;
  category: string;
  capability: string;
  areas: Array<{ id: string; job: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCustomTemplate(value: unknown): value is CustomTemplate {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.slug === "string"
    && typeof value.name === "string"
    && typeof value.summary === "string"
    && typeof value.version === "number"
    && typeof value.editable === "boolean"
    && typeof value.compiles === "boolean";
}

function isPipelineSelection(value: unknown): value is PipelineSelection {
  return isRecord(value)
    && typeof value.projectId === "string"
    && typeof value.templateKey === "string";
}

function isProjectSummary(value: unknown): value is { id: string; name: string } {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string";
}

const EMPTY_SEED: EditorSeed = {
  slug: "",
  name: "",
  summary: "",
  category: "AUDIT",
  capability: "review",
  areas: [{ id: "area_1", job: "" }],
};

/**
 * A discovery template's shape promises rounds — discover, dedupe, verify,
 * generate the next round — and the executor does not add them: it runs the
 * nodes the plan recorded, once. The engine carries bounded discovery and the
 * canary exercises it, but nothing wires it to a stored graph yet, so the
 * label would otherwise promise behaviour the run will not perform.
 */
const DISCOVERY_EXECUTION_NOTE =
  "Recorded as a discovery shape. The executor runs these nodes once — it does not add rounds mid-run — so this executes as the plan you see here.";

/**
 * Anchor nodes need a workspace and real command execution — run the tests,
 * attempt the reproduction. The graph worker is a read-only analysis lane and
 * provides no such executor, and since migration 20260819001000 it does not
 * claim a graph containing one at all: the graph stays planned with its budget
 * intact, waiting for a worker that can run it. That is the honest state, but
 * it is a quiet one, so the person choosing the template is told here rather
 * than left watching a graph that never starts.
 */
function workspaceExecutionNote(anchorNodeCount: number): string {
  return anchorNodeCount === 1
    ? "One node here runs commands — tests or a reproduction — which needs a workspace worker. Until one is connected, this graph waits rather than running."
    : `${anchorNodeCount} nodes here run commands — tests or a reproduction — which needs a workspace worker. Until one is connected, this graph waits rather than running.`;
}

export function PipelineTemplatesManager({
  builtIns,
  projectContext,
  onSelectionChanged,
}: {
  builtIns: readonly PipelineTemplateSummary[];
  /**
   * The project the caller is already working on.
   *
   * Three distinct states, and the difference matters. A project means select
   * against that one. `null` means the caller *has* a project concept and
   * there is none right now — the AI Factory while a new factory is being
   * started — so falling back to some other project would select against a
   * factory the person is not looking at. `undefined` means the caller has no
   * project concept at all, and this component asks.
   */
  projectContext?: { id: string; name: string } | null;
  /** Lets a caller showing the same selections refresh alongside a toggle. */
  onSelectionChanged?: () => void;
}) {
  const [custom, setCustom] = useState<CustomTemplate[] | null>(null);
  const [customReadFailed, setCustomReadFailed] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [notice, setNotice] = useState("");
  const [editorSeed, setEditorSeed] = useState<EditorSeed | null>(null);
  const [deletingId, setDeletingId] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [planning, setPlanning] = useState<{ key: string; name: string } | null>(null);

  const [selections, setSelections] = useState<PipelineSelection[] | null>(null);
  const [selectionsReadFailed, setSelectionsReadFailed] = useState(false);
  const [canSelect, setCanSelect] = useState(false);
  /**
   * Whether this database can record a selection at all. Distinct from
   * "nothing is selected": both render an empty set, and only one of them
   * means pressing Use would silently do nothing.
   */
  const [selectionAvailable, setSelectionAvailable] = useState(true);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }> | null>(null);
  const [projectsReadFailed, setProjectsReadFailed] = useState(false);
  const [chosenProjectId, setChosenProjectId] = useState("");
  const [togglingKey, setTogglingKey] = useState("");
  const [selectionNotice, setSelectionNotice] = useState("");

  const load = useCallback(async () => {
    setCustomReadFailed(false);
    try {
      const response = await fetch("/api/pipeline-templates", { cache: "no-store" });
      if (!response.ok) throw new Error("Custom templates could not be loaded.");
      const body = (await response.json()) as { templates?: unknown; canManage?: boolean };
      if (!Array.isArray(body.templates) || !body.templates.every(isCustomTemplate)) {
        throw new Error("Custom template data was invalid.");
      }
      setCustom(body.templates);
      setCanManage(Boolean(body.canManage));
    } catch {
      setCanManage(false);
      setCustomReadFailed(true);
    }
  }, []);

  const loadSelections = useCallback(async () => {
    setSelectionsReadFailed(false);
    setCanSelect(false);
    try {
      const response = await fetch("/api/project-pipelines", { cache: "no-store" });
      if (!response.ok) throw new Error("Pipeline selections could not be loaded.");
      const body = (await response.json()) as {
        available?: boolean;
        canManage?: boolean;
        pipelines?: unknown;
      };
      if (!Array.isArray(body.pipelines) || !body.pipelines.every(isPipelineSelection)) {
        throw new Error("Pipeline selection data was invalid.");
      }
      setSelections(body.pipelines);
      setCanSelect(Boolean(body.canManage));
      setSelectionAvailable(body.available !== false);
    } catch {
      setSelectionsReadFailed(true);
    }
  }, []);

  // Only asked for when the caller did not say which project it is. A page
  // that already knows should not make a person answer twice.
  const loadProjects = useCallback(async () => {
    setProjectsReadFailed(false);
    if (projectContext !== undefined) return;
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      if (!response.ok) throw new Error("Projects could not be loaded.");
      const body = (await response.json()) as { projects?: unknown };
      if (!Array.isArray(body.projects) || !body.projects.every(isProjectSummary)) {
        throw new Error("Project data was invalid.");
      }
      setProjects(body.projects);
    } catch {
      setProjectsReadFailed(true);
    }
  }, [projectContext]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
      void loadSelections();
      void loadProjects();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, loadProjects, loadSelections]);

  /**
   * The project a press of Use applies to: the caller's if it gave one,
   * otherwise the one chosen here, falling back to the first so a workspace
   * with a single project needs no answer at all.
   */
  const activeProject = projectContext !== undefined
    ? projectContext
    : (projects ?? []).find((project) => project.id === chosenProjectId)
      ?? (projects ?? [])[0]
      ?? null;

  const selectedKeys = useMemo(() => {
    if (!activeProject) return new Set<string>();
    return new Set(
      (selections ?? [])
        .filter((selection) => selection.projectId === activeProject.id)
        .map((selection) => selection.templateKey),
    );
  }, [activeProject, selections]);

  async function toggleSelection(templateKey: string, templateName: string) {
    if (!activeProject) return;
    const alreadySelected = selectedKeys.has(templateKey);
    setTogglingKey(templateKey);
    setSelectionNotice("");
    try {
      const response = alreadySelected
        ? await fetch(
            `/api/project-pipelines?projectId=${encodeURIComponent(activeProject.id)}&templateKey=${encodeURIComponent(templateKey)}`,
            { method: "DELETE" },
          )
        : await fetch("/api/project-pipelines", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: activeProject.id, templateKey }),
          });
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(
          body.error?.message
            ?? `${templateName} could not be ${alreadySelected ? "removed" : "selected"}.`,
        );
      }
      await loadSelections();
      onSelectionChanged?.();
    } catch (error) {
      setSelectionNotice(
        error instanceof Error
          ? error.message
          : `${templateName} could not be ${alreadySelected ? "removed" : "selected"}.`,
      );
    } finally {
      setTogglingKey("");
    }
  }

  const selectionReadsFailed = selectionsReadFailed || projectsReadFailed;
  const selectionDisabledReason = selectionReadsFailed
    ? "Pipeline setup is unavailable because its current selections or projects could not be verified."
    : !activeProject
    ? "A pipeline is selected for a project, and this workspace has none yet."
    : !selectionAvailable
      ? "Not Connected — this database does not have the pipeline-selection migration applied yet, so a selection cannot be recorded."
      : !canSelect
        ? "Selecting a project's pipelines needs organization owner or administrator access."
        : "";

  function pipelineUseButton(templateKey: string, templateName: string, compiles: boolean) {
    const selected = selectedKeys.has(templateKey);
    return (
      <SelectPipelineButton
        busy={togglingKey === templateKey}
        compiles={compiles}
        disabledReason={selectionDisabledReason}
        onToggle={() => void toggleSelection(templateKey, templateName)}
        selected={selected}
        templateName={templateName}
      />
    );
  }

  async function deleteTemplate(template: CustomTemplate) {
    setDeleteBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/pipeline-templates/${template.id}`, { method: "DELETE" });
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The template could not be deleted.");
      setDeletingId("");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The template could not be deleted.");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          Versioned pipeline templates, compiled by the graph engine on every load — the topology,
          parallel width, and node counts are produced by the same code that schedules the work.
        </p>
        {canManage ? (
          <button type="button" onClick={() => setEditorSeed(EMPTY_SEED)} className="btn btn-primary btn-sm">
            <Plus className="size-4" aria-hidden="true" />
            New template
          </button>
        ) : null}
      </div>
      {notice ? <p className="text-sm text-[var(--danger)]" aria-live="polite">{notice}</p> : null}

      <SelectionSummary
        activeProject={activeProject}
        chosenProjectId={chosenProjectId}
        disabledReason={selectionDisabledReason}
        notice={selectionNotice}
        onChooseProject={setChosenProjectId}
        projects={projectContext !== undefined ? null : projects}
        projectsLoading={projectContext === undefined && projects === null}
        readFailed={selectionReadsFailed}
        onRetry={() => {
          if (selectionsReadFailed) void loadSelections();
          if (projectsReadFailed) void loadProjects();
        }}
        selectedCount={selectedKeys.size}
      />

      <section aria-label="Your templates">
        <h3 className="label">Your templates</h3>
        {customReadFailed ? (
          <Card className="mt-2 p-4">
            <p className="text-sm font-medium text-foreground">Custom templates are unavailable</p>
            <p className="mt-1 text-sm text-muted">We could not verify your saved templates. No empty template list was inferred.</p>
            <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => void load()}>Retry</button>
          </Card>
        ) : custom === null ? (
          <Card className="mt-2 grid min-h-24 place-items-center">
            <Loader2 className="size-5 animate-spin text-accent" aria-label="Loading your templates" />
          </Card>
        ) : custom.length === 0 ? (
          <Card className="mt-2 p-4">
            <p className="text-sm text-muted">
              No custom templates yet. Create one, or clone a built-in below and shape it to your
              workflow — it is stored in your workspace, versioned on every edit.
            </p>
          </Card>
        ) : (
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {custom.map((template) => (
              <Card key={template.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-semibold text-foreground">{template.name}</h4>
                  <StatusBadge tone={template.compiles ? "safe" : "danger"} dot={false}>
                    {template.compiles ? `v${template.version}` : "Does not compile"}
                  </StatusBadge>
                </div>
                <p className="mt-1 text-sm text-muted">{template.summary}</p>
                <p className="mt-2 text-xs text-faint">
                  {template.category ?? "—"}
                  {template.topology ? ` · ${template.topology}` : ""}
                  {template.nodeCount != null ? ` · ${template.nodeCount} nodes` : ""}
                  {template.maxParallelism != null ? ` · up to ${template.maxParallelism} in parallel` : ""}
                </p>
                {template.topology === "DISCOVERY_GRAPH" ? (
                  <p className="mt-2 text-xs text-[var(--warning)]">{DISCOVERY_EXECUTION_NOTE}</p>
                ) : null}
                {template.anchorNodeCount ? (
                  <p className="mt-2 text-xs text-[var(--warning)]">
                    {workspaceExecutionNote(template.anchorNodeCount)}
                  </p>
                ) : null}
                {template.errors?.length ? (
                  <p className="mt-2 text-xs text-[var(--danger)]">{template.errors[0]}</p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {pipelineUseButton(template.slug, template.name, template.compiles)}
                  <button
                    type="button"
                    aria-label={`Plan a graph from ${template.name}`}
                    onClick={() => setPlanning({ key: template.slug, name: template.name })}
                    disabled={!template.compiles}
                    className="btn btn-secondary btn-sm"
                  >
                    <Play className="size-4" aria-hidden="true" />
                    Plan graph
                  </button>
                  {canManage && template.editable ? (
                    <>
                      <button
                        type="button"
                        aria-label={`Edit ${template.name}`}
                        onClick={() => setEditorSeed({
                          id: template.id,
                          slug: template.slug,
                          name: template.name,
                          summary: template.summary,
                          category: template.category ?? "AUDIT",
                          capability: template.capability ?? "review",
                          areas: template.areas ?? [{ id: "area_1", job: "" }],
                        })}
                        className="btn btn-secondary btn-sm"
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                        Edit
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${template.name}`}
                        onClick={() => setDeletingId(template.id)}
                        className="btn btn-secondary btn-sm"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                        Delete
                      </button>
                    </>
                  ) : null}
                </div>
                {deletingId === template.id ? (
                  <div className="mt-3 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-surface)] p-2.5">
                    <p className="text-xs text-foreground">
                      Delete {template.name}? Graphs already planned from it keep their records; the
                      deletion is written to the audit trail.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void deleteTemplate(template)}
                        disabled={deleteBusy}
                        className="btn btn-primary btn-sm"
                      >
                        {deleteBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" aria-hidden="true" />}
                        Delete template
                      </button>
                      <button type="button" onClick={() => setDeletingId("")} className="btn btn-secondary btn-sm">
                        Keep it
                      </button>
                    </div>
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-label="Built-in templates">
        <h3 className="label">Built-in templates</h3>
        <p className="mt-1 text-xs text-faint">
          Maintained in code and versioned by review. Clone one to make an editable copy in your
          workspace.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {builtIns.map((template) => (
            <Card key={template.key} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-semibold text-foreground">{template.name}</h4>
                <StatusBadge tone={template.compiles ? "safe" : "danger"} dot={false}>
                  {template.compiles ? `v${template.version}` : "Does not compile"}
                </StatusBadge>
              </div>
              <p className="mt-1 text-sm text-muted">{template.summary}</p>
              <p className="mt-2 text-xs text-faint">
                {template.category}
                {template.topology ? ` · ${template.topology}` : ""}
                {template.nodeCount !== null ? ` · ${template.nodeCount} nodes` : ""}
                {template.maxParallelism !== null ? ` · up to ${template.maxParallelism} in parallel` : ""}
              </p>
              {template.topology === "DISCOVERY_GRAPH" ? (
                <p className="mt-2 text-xs text-[var(--warning)]">{DISCOVERY_EXECUTION_NOTE}</p>
              ) : null}
              {template.anchorNodeCount ? (
                <p className="mt-2 text-xs text-[var(--warning)]">
                  {workspaceExecutionNote(template.anchorNodeCount)}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {pipelineUseButton(template.key, template.name, template.compiles)}
                <button
                  type="button"
                  aria-label={`Plan a graph from ${template.name}`}
                  onClick={() => setPlanning({ key: template.key, name: template.name })}
                  disabled={!template.compiles}
                  className="btn btn-secondary btn-sm"
                >
                  <Play className="size-4" aria-hidden="true" />
                  Plan graph
                </button>
                {canManage ? (
                  <button
                    type="button"
                    aria-label={`Clone ${template.name}`}
                    onClick={() => setEditorSeed({
                      slug: `${template.key}_custom`.slice(0, 60),
                      name: `${template.name} (custom)`.slice(0, 160),
                      summary: template.summary,
                      category: template.category,
                      capability: "review",
                      areas: [{ id: "area_1", job: "" }],
                    })}
                    className="btn btn-secondary btn-sm"
                  >
                    <Copy className="size-4" aria-hidden="true" />
                    Clone
                  </button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      </section>

      <Card className="p-4">
        <p className="flex items-start gap-2.5 text-sm text-muted">
          <ClipboardList className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden="true" />
          The full compiled preview of every built-in — node contracts, lock waves, removed
          dependencies — lives on{" "}
          <Link href="/solutions/workflows" className="font-medium text-accent">Workflows</Link>.
        </p>
      </Card>

      {editorSeed ? (
        <TemplateEditorDialog
          seed={editorSeed}
          onClose={() => setEditorSeed(null)}
          onSaved={async () => {
            setEditorSeed(null);
            await load();
          }}
        />
      ) : null}
      {planning ? (
        <TemplatePlanDialog
          templateKey={planning.key}
          templateName={planning.name}
          projectContext={projectContext}
          onClose={() => setPlanning(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * The Use control, and the whole of what "selected" looks like.
 *
 * Selected renders grey rather than accent, because accent on this page means
 * "a thing you can still do" and a selection is a thing already done. The
 * state is carried by `aria-pressed` as well as by colour, so it reaches
 * someone who cannot see the difference, and the accessible name says what
 * pressing it will do rather than what the button currently is.
 */
function SelectPipelineButton({
  busy,
  compiles,
  disabledReason,
  onToggle,
  selected,
  templateName,
}: {
  busy: boolean;
  compiles: boolean;
  disabledReason: string;
  onToggle: () => void;
  selected: boolean;
  templateName: string;
}) {
  const blocked = Boolean(disabledReason) || !compiles;
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={selected ? `Stop using ${templateName}` : `Use ${templateName}`}
      title={
        compiles
          ? disabledReason || undefined
          : "This template does not compile, so it cannot be selected."
      }
      onClick={onToggle}
      disabled={blocked || busy}
      className={cn("btn btn-sm", selected ? "btn-secondary" : "btn-primary")}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : selected ? (
        <Check className="size-4" aria-hidden="true" />
      ) : (
        <Play className="size-4" aria-hidden="true" />
      )}
      {selected ? "Selected" : "Use"}
    </button>
  );
}

/**
 * What the selections below add up to, and which project they belong to.
 *
 * A grid of grey buttons is only meaningful if the page says what they are
 * grey *for*; and when the caller did not name a project, this is where one
 * is chosen — once, above the cards, rather than per card.
 */
function SelectionSummary({
  activeProject,
  chosenProjectId,
  disabledReason,
  notice,
  onChooseProject,
  onRetry,
  projects,
  projectsLoading,
  readFailed,
  selectedCount,
}: {
  activeProject: { id: string; name: string } | null;
  chosenProjectId: string;
  disabledReason: string;
  notice: string;
  onChooseProject: (projectId: string) => void;
  onRetry: () => void;
  projects: Array<{ id: string; name: string }> | null;
  /**
   * Distinct from `projects === null`: a caller that named its own project —
   * or named that it has none — never reads this list, so "not loaded" would
   * otherwise render as "still loading" forever.
   */
  projectsLoading: boolean;
  readFailed: boolean;
  selectedCount: number;
}) {
  const showPicker = projects !== null && projects.length > 1;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="label">Selected pipelines</h3>
          {readFailed ? (
            <div role="alert">
              <p className="mt-1 text-sm text-muted">Pipeline setup is unavailable because its current selections or projects could not be verified.</p>
              <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={onRetry}>Retry</button>
            </div>
          ) : activeProject ? (
            <p className="mt-1 text-sm text-muted">
              {selectedCount === 0
                ? `No pipeline selected for ${activeProject.name} yet. Press Use on a template to add one — a project can run as many as it needs.`
                : `${selectedCount} pipeline${selectedCount === 1 ? "" : "s"} selected for ${activeProject.name}. Selection is recorded intent: nothing runs until work is dispatched.`}
            </p>
          ) : projectsLoading ? (
            <p className="mt-1 text-sm text-muted">Reading your projects…</p>
          ) : (
            <p className="mt-1 text-sm text-muted">
              A pipeline is selected for a project, and this workspace has none yet.{" "}
              <Link href="/solutions/projects#add-project" className="text-accent underline">
                Create a project
              </Link>{" "}
              first.
            </p>
          )}
        </div>
        {showPicker && activeProject ? (
          <div className="min-w-48">
            <label htmlFor="pipeline-selection-project" className="field-label">Project</label>
            <select
              id="pipeline-selection-project"
              value={chosenProjectId || activeProject.id}
              onChange={(event) => onChooseProject(event.target.value)}
              className="input"
            >
              {(projects ?? []).map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      {activeProject && disabledReason && !readFailed ? (
        <p className="mt-2 text-xs text-faint">{disabledReason}</p>
      ) : null}
      {notice ? (
        <p className="mt-2 text-sm text-[var(--danger)]" aria-live="polite">{notice}</p>
      ) : null}
    </Card>
  );
}

function DialogShell({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={label}>
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        <button type="button" onClick={onClose} className="btn btn-secondary btn-sm absolute right-4 top-4 size-9 px-0" aria-label="Close">
          <X className="size-4" aria-hidden="true" />
        </button>
        {children}
      </div>
    </div>
  );
}

/** Create or edit a custom template in the audit-areas shape. */
function TemplateEditorDialog({
  seed,
  onClose,
  onSaved,
}: {
  seed: EditorSeed;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const isEdit = Boolean(seed.id);
  const [slug, setSlug] = useState(seed.slug);
  const [name, setName] = useState(seed.name);
  const [summary, setSummary] = useState(seed.summary);
  const [category, setCategory] = useState(seed.category);
  const [capability, setCapability] = useState(seed.capability);
  const [areas, setAreas] = useState(seed.areas.length ? seed.areas : [{ id: "area_1", job: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function setArea(index: number, patch: Partial<{ id: string; job: string }>) {
    setAreas((current) => current.map((area, i) => (i === index ? { ...area, ...patch } : area)));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...(isEdit ? {} : { slug: slug.trim() }),
        name: name.trim(),
        summary: summary.trim(),
        category,
        capability,
        areas: areas.map((area) => ({ id: area.id.trim(), job: area.job.trim() })),
      };
      const response = await fetch(
        isEdit ? `/api/pipeline-templates/${seed.id}` : "/api/pipeline-templates",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string; details?: string[] };
      };
      if (!response.ok) {
        throw new Error(
          [body.error?.message ?? "The template could not be saved.", ...(body.error?.details ?? [])].join(" "),
        );
      }
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The template could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell label={isEdit ? `Edit ${seed.name}` : "New template"} onClose={onClose}>
      <h2 className="text-lg font-semibold text-foreground">{isEdit ? "Edit template" : "New template"}</h2>
      <p className="mt-1 text-sm text-muted">
        A template is a set of independent areas the graph engine fans out over, reduces, and
        reports on. It saves only if it compiles; every edit bumps the version.
      </p>
      <form onSubmit={save} className="mt-4 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {!isEdit ? (
            <div>
              <label htmlFor="template-slug" className="field-label">Key</label>
              <input
                id="template-slug"
                value={slug}
                onChange={(event) => setSlug(event.target.value.toLowerCase())}
                required
                pattern="[a-z0-9_]{1,60}"
                className="input font-mono"
                placeholder="checkout_audit"
              />
              <span className="field-hint">a-z, 0-9, underscore. Fixed once created.</span>
            </div>
          ) : null}
          <div>
            <label htmlFor="template-name" className="field-label">Name</label>
            <input id="template-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} className="input" />
          </div>
          <div>
            <label htmlFor="template-category" className="field-label">Category</label>
            <select id="template-category" value={category} onChange={(event) => setCategory(event.target.value)} className="input">
              {TEMPLATE_CATEGORIES.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="template-capability" className="field-label">Inspector capability</label>
            <select id="template-capability" value={capability} onChange={(event) => setCapability(event.target.value)} className="input">
              {NODE_CAPABILITIES.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="template-summary" className="field-label">Summary</label>
          <input id="template-summary" value={summary} onChange={(event) => setSummary(event.target.value)} required maxLength={2000} className="input" />
        </div>

        <fieldset>
          <legend className="field-label">Areas (each becomes an independent inspector node)</legend>
          <div className="space-y-2">
            {areas.map((area, index) => (
              <div key={index} className="flex flex-wrap items-start gap-2">
                <input
                  aria-label={`Area ${index + 1} id`}
                  value={area.id}
                  onChange={(event) => setArea(index, { id: event.target.value.toLowerCase() })}
                  required
                  pattern="[a-z0-9_]{1,40}"
                  className="input w-36 font-mono"
                  placeholder="config"
                />
                <input
                  aria-label={`Area ${index + 1} job`}
                  value={area.job}
                  onChange={(event) => setArea(index, { job: event.target.value })}
                  required
                  maxLength={500}
                  className="input min-w-0 flex-1"
                  placeholder="Check configuration and environment handling for unsafe defaults."
                />
                <button
                  type="button"
                  aria-label={`Remove area ${index + 1}`}
                  onClick={() => setAreas((current) => current.filter((_, i) => i !== index))}
                  disabled={areas.length <= 1}
                  className="btn btn-secondary btn-sm size-9 px-0"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setAreas((current) => [...current, { id: `area_${current.length + 1}`, job: "" }])}
            disabled={areas.length >= 12}
            className="btn btn-secondary btn-sm mt-2"
          >
            <Plus className="size-4" aria-hidden="true" />
            Add area
          </button>
        </fieldset>

        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="btn btn-primary btn-sm">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" aria-hidden="true" />}
            {isEdit ? "Save (bumps version)" : "Create template"}
          </button>
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">Cancel</button>
        </div>
        {error ? <p className="text-sm text-[var(--danger)]" aria-live="polite">{error}</p> : null}
      </form>
    </DialogShell>
  );
}

/**
 * Plan a graph from a template against a chosen project, through the real
 * launch endpoint. The result states exactly what the endpoint states: the
 * graph is recorded and nothing has been dispatched.
 */
function TemplatePlanDialog({
  templateKey,
  templateName,
  projectContext,
  onClose,
}: {
  templateKey: string;
  templateName: string;
  projectContext?: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  const [loadingProjects, setLoadingProjects] = useState(projectContext === undefined);
  const [projectsReadFailed, setProjectsReadFailed] = useState(false);
  const [projectReadAttempt, setProjectReadAttempt] = useState(0);

  const availableProjects = projectContext === undefined
    ? projects
    : projectContext
      ? [projectContext]
      : [];
  const selectedProjectId = projectContext === undefined
    ? projectId
    : projectContext?.id ?? "";
  const projectsAreLoading = projectContext === undefined && loadingProjects;
  const projectReadHasFailed = projectContext === undefined && projectsReadFailed;

  useEffect(() => {
    if (projectContext !== undefined) return;

    let cancelled = false;
    void (async () => {
      if (!cancelled) {
        setLoadingProjects(true);
        setProjectsReadFailed(false);
      }
      try {
        const response = await fetch("/api/projects", { cache: "no-store" });
        if (!response.ok) throw new Error("Projects could not be loaded.");
        const body = (await response.json()) as { projects?: unknown };
        if (!Array.isArray(body.projects) || !body.projects.every(isProjectSummary)) {
          throw new Error("Project data was invalid.");
        }
        if (!cancelled) {
          const nextProjects = body.projects;
          setProjects(nextProjects);
          setProjectId(nextProjects[0]?.id ?? "");
        }
      } catch {
        if (!cancelled) setProjectsReadFailed(true);
      } finally {
        if (!cancelled) setLoadingProjects(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectContext, projectReadAttempt]);

  async function plan() {
    setBusy(true);
    setError("");
    setResult("");
    try {
      const response = await fetch("/api/graphs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedProjectId, templateKey }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        graphId?: string;
        nodeCount?: number;
        topology?: string;
        note?: string;
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "The graph could not be planned.");
      setResult(
        `Graph recorded (${body.topology}, ${body.nodeCount} nodes). ${body.note ?? ""}`,
      );
    } catch (planError) {
      setError(planError instanceof Error ? planError.message : "The graph could not be planned.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell label={`Plan a graph from ${templateName}`} onClose={onClose}>
      <h2 className="text-lg font-semibold text-foreground">Plan a graph from {templateName}</h2>
      <p className="mt-1 text-sm text-muted">
        This plans a graph from the template against a project and records it — nodes, edges, and
        budget — through the same write boundary the engine uses. The graph executor worker claims
        recorded graphs and runs their nodes in parallel up to the graph&apos;s own budget; until a
        worker with the subscription credential picks this one up, it stays planned.
      </p>
      <div className="mt-4">
        {/*
          A template is planned *against* a project, so with none there is
          nothing to plan against. This used to render an empty dropdown beside
          a permanently disabled button and say nothing — a dead end that reads
          as a broken dialog rather than as a missing prerequisite.
        */}
        {projectsAreLoading ? (
          <p className="text-sm text-muted">Reading your projects…</p>
        ) : projectReadHasFailed ? (
          <div role="alert">
            <p className="text-sm text-muted">Graph planning is unavailable because projects could not be verified.</p>
            <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => setProjectReadAttempt((attempt) => attempt + 1)}>Retry</button>
          </div>
        ) : availableProjects.length === 0 ? (
          <p className="text-sm text-muted">
            A pipeline is planned against a project, and this workspace has none yet.{" "}
            <Link href="/solutions/projects#add-project" className="text-accent underline">
              Create a project
            </Link>{" "}
            first, then plan a graph from this template.
          </p>
        ) : (
          <>
            <label htmlFor="use-template-project" className="field-label">Project</label>
            <select
              id="use-template-project"
              value={selectedProjectId}
              onChange={(event) => setProjectId(event.target.value)}
              disabled={projectContext !== undefined}
              className="input w-full"
            >
              {availableProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {availableProjects.length > 0 ? (
          <button type="button" onClick={() => void plan()} disabled={busy || !selectedProjectId} className="btn btn-primary btn-sm">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" aria-hidden="true" />}
            Plan graph
          </button>
        ) : null}
        <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">Close</button>
      </div>
      {result ? (
        <p className="mt-3 text-sm text-accent" aria-live="polite">
          {result}{" "}
          <Link href="/solutions/pipelines?view=graphs" className="underline">
            Watch it on Graph runs
          </Link>
          .
        </p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-[var(--danger)]" aria-live="polite">{error}</p> : null}
    </DialogShell>
  );
}
