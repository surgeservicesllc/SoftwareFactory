"use client";

import { ClipboardList, Copy, Loader2, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { PipelineTemplateSummary } from "@/components/pipelines-console";
import { Card, StatusBadge } from "@/components/ui";
import { NODE_CAPABILITIES } from "@/lib/graph/contracts";
import { TEMPLATE_CATEGORIES } from "@/lib/graph/templates";

/**
 * The Templates tab, with the custom half wired to Supabase: create, edit,
 * and delete organization templates through the owner/admin definer
 * functions, and plan a real graph from any template — built-in or custom —
 * through the same launch endpoint. Every topology fact shown is compiled,
 * and a definition the compiler refuses never saves.
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
  errors?: string[];
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

export function PipelineTemplatesManager({ builtIns }: { builtIns: readonly PipelineTemplateSummary[] }) {
  const [custom, setCustom] = useState<CustomTemplate[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [notice, setNotice] = useState("");
  const [editorSeed, setEditorSeed] = useState<EditorSeed | null>(null);
  const [deletingId, setDeletingId] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [using, setUsing] = useState<{ key: string; name: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/pipeline-templates", { cache: "no-store" });
      if (!response.ok) {
        setCustom([]);
        return;
      }
      const body = (await response.json()) as { templates?: CustomTemplate[]; canManage?: boolean };
      setCustom(body.templates ?? []);
      setCanManage(Boolean(body.canManage));
    } catch {
      setCustom([]);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

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

      <section aria-label="Your templates">
        <h3 className="label">Your templates</h3>
        {custom === null ? (
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
                {template.errors?.length ? (
                  <p className="mt-2 text-xs text-[var(--danger)]">{template.errors[0]}</p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setUsing({ key: template.slug, name: template.name })}
                    disabled={!template.compiles}
                    className="btn btn-primary btn-sm"
                  >
                    <Play className="size-4" aria-hidden="true" />
                    Use
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
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setUsing({ key: template.key, name: template.name })}
                  disabled={!template.compiles}
                  className="btn btn-primary btn-sm"
                >
                  <Play className="size-4" aria-hidden="true" />
                  Use
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
      {using ? (
        <TemplateUseDialog templateKey={using.key} templateName={using.name} onClose={() => setUsing(null)} />
      ) : null}
    </div>
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
function TemplateUseDialog({
  templateKey,
  templateName,
  onClose,
}: {
  templateKey: string;
  templateName: string;
  onClose: () => void;
}) {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  const [loadingProjects, setLoadingProjects] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/projects", { cache: "no-store" });
        const body = (await response.json().catch(() => ({}))) as { projects?: Array<{ id: string; name: string }> };
        if (!cancelled) {
          setProjects(body.projects ?? []);
          setProjectId((body.projects ?? [])[0]?.id ?? "");
        }
      } catch {
        if (!cancelled) setProjects([]);
      } finally {
        if (!cancelled) setLoadingProjects(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function plan() {
    setBusy(true);
    setError("");
    setResult("");
    try {
      const response = await fetch("/api/graphs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, templateKey }),
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
    <DialogShell label={`Use ${templateName}`} onClose={onClose}>
      <h2 className="text-lg font-semibold text-foreground">Use {templateName}</h2>
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
        {loadingProjects ? (
          <p className="text-sm text-muted">Reading your projects…</p>
        ) : projects.length === 0 ? (
          <p className="text-sm text-muted">
            A pipeline is planned against a project, and this workspace has none yet.{" "}
            <Link href="/solutions/projects#add-project" className="text-accent underline">
              Create a project
            </Link>{" "}
            first, then use this template.
          </p>
        ) : (
          <>
            <label htmlFor="use-template-project" className="field-label">Project</label>
            <select
              id="use-template-project"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="input w-full"
            >
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {projects.length > 0 ? (
          <button type="button" onClick={() => void plan()} disabled={busy || !projectId} className="btn btn-primary btn-sm">
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
