"use client";

import { ListTodo, Loader2, Plus, RefreshCw, Search, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyPanel, TenantStateGate, formatDateTime, riskTone } from "@/components/tenant-states";
import { Panel, StatusBadge } from "@/components/ui";
import { postJson, useTenantResource } from "@/lib/client/use-tenant-resource";

type BacklogTask = {
  id: string;
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  status: string;
  risk: string;
  priority: number;
  source: string;
  commandId: string | null;
  dependsOnTaskId: string | null;
  pullRequestId: string | null;
  project: { id: string; name: string };
  agent: { id: string | null; name: string; role: string } | null;
  createdAt: string;
  completedAt: string | null;
};

type BacklogPayload = { canManage: boolean; tasks: BacklogTask[] };

const STATUSES = [
  "backlog",
  "awaiting_approval",
  "queued",
  "in_progress",
  "blocked",
  "completed",
  "failed",
  "cancelled",
  "superseded",
] as const;

const SOURCES = [
  "owner",
  "orchestrator",
  "ai_audit",
  "failed_test",
  "ci_failure",
  "security_finding",
  "incident",
  "feature_request",
] as const;

function statusTone(status: string): "safe" | "info" | "warning" | "danger" | "neutral" {
  if (status === "completed") return "safe";
  if (status === "in_progress" || status === "queued") return "info";
  if (status === "blocked" || status === "awaiting_approval") return "warning";
  if (status === "failed") return "danger";
  return "neutral";
}

export function BacklogConsole() {
  const [status, setStatus] = useState("");
  const [risk, setRisk] = useState("");
  const [source, setSource] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: "200" });
    if (status) params.set("status", status);
    if (risk) params.set("risk", risk);
    if (source) params.set("source", source);
    if (search.trim()) params.set("search", search.trim());
    return `/api/tasks?${params.toString()}`;
  }, [risk, search, source, status]);

  const backlog = useTenantResource<BacklogPayload>(query);
  const projects = useTenantResource<{ projects: Array<{ id: string; name: string }> }>("/api/projects");

  if (backlog.state !== "ready" || !backlog.data) {
    return <TenantStateGate state={backlog.state} message={backlog.message} subject="the backlog" next="/backlog" />;
  }

  const { canManage, tasks } = backlog.data;

  async function updateStatus(task: BacklogTask, nextStatus: string) {
    const { ok, body } = await postJson("/api/tasks", {
      taskId: task.id,
      projectId: task.project.id,
      title: task.title,
      description: task.description ?? undefined,
      acceptanceCriteria: task.acceptanceCriteria ?? undefined,
      risk: task.risk,
      priority: task.priority,
      status: nextStatus,
      source: task.source,
      assignedAgentId: task.agent?.id ?? null,
      dependsOnTaskId: task.dependsOnTaskId,
    });
    setMessage(ok ? "" : (body.error?.message ?? "The backlog item could not be updated."));
    backlog.reload();
  }

  return (
    <>
      <Panel className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#212b37] p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative block min-w-0 sm:w-56">
              <span className="sr-only">Search the backlog</span>
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#5e6a79]" aria-hidden="true" />
              <input
                className="form-control h-8 pl-9 text-[10px]"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search titles…"
                type="search"
                value={search}
              />
            </label>
            <Filter label="Status" value={status} onChange={setStatus} options={STATUSES} />
            <Filter label="Risk" value={risk} onChange={setRisk} options={["green", "yellow", "red"] as const} />
            <Filter label="Source" value={source} onChange={setSource} options={SOURCES} />
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={backlog.reload} disabled={backlog.refreshing} className="secondary-action">
              {backlog.refreshing ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-3.5" aria-hidden="true" />
              )}
              Refresh
            </button>
            {canManage ? (
              <button type="button" onClick={() => setCreating((open) => !open)} className="primary-action">
                {creating ? <X className="size-3.5" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
                {creating ? "Close" : "New item"}
              </button>
            ) : null}
          </div>
        </div>

        {creating ? (
          <BacklogForm
            projects={projects.data?.projects ?? []}
            onDone={(created) => {
              setCreating(false);
              if (created) backlog.reload();
            }}
            onError={setMessage}
          />
        ) : null}

        {message ? (
          <p role="status" className="border-b border-[#212b37] bg-[#2b181c] p-3 text-[10px] leading-5 text-[#e59399]">
            {message}
          </p>
        ) : null}

        {tasks.length === 0 ? (
          <EmptyPanel
            title="No backlog items match this view"
            description="Items appear here when an owner creates one or when the orchestrator plans a command."
            icon={ListTodo}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left">
              <thead className="border-b border-[#202a36] bg-[#0b1017] font-mono text-[8px] uppercase tracking-[0.12em] text-[#596675]">
                <tr>
                  <th className="px-4 py-3 font-medium">Work item</th>
                  <th className="px-4 py-3 font-medium">Project</th>
                  <th className="px-4 py-3 font-medium">Priority</th>
                  <th className="px-4 py-3 font-medium">Risk</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Assigned</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202a36]">
                {tasks.map((task) => (
                  <tr key={task.id} className="transition-colors hover:bg-[#111821]">
                    <td className="px-4 py-4">
                      <p className="text-xs font-medium text-[#cfd6dd]">{task.title}</p>
                      {task.acceptanceCriteria ? (
                        <p className="mt-1 max-w-md text-[10px] leading-4 text-[#6a7787]">{task.acceptanceCriteria}</p>
                      ) : null}
                      <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.1em] text-[#4f5b69]">
                        {formatDateTime(task.createdAt)}
                        {task.dependsOnTaskId ? " · has a dependency" : ""}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-[10px] text-[#7d8998]">
                      <Link href={`/projects/${task.project.id}`} className="hover:text-[#c4ccd5]">
                        {task.project.name}
                      </Link>
                    </td>
                    <td className="px-4 py-4 font-mono text-[10px] text-[#8c99a9]">{task.priority}</td>
                    <td className="px-4 py-4">
                      <StatusBadge tone={riskTone(task.risk)}>{task.risk.toUpperCase()}</StatusBadge>
                    </td>
                    <td className="px-4 py-4 font-mono text-[9px] text-[#7d8998]">{task.source.replace(/_/g, " ")}</td>
                    <td className="px-4 py-4 text-[10px] text-[#7d8998]">{task.agent?.name ?? "—"}</td>
                    <td className="px-4 py-4">
                      {canManage ? (
                        <select
                          value={task.status}
                          onChange={(event) => void updateStatus(task, event.target.value)}
                          aria-label={`Status for ${task.title}`}
                          className="h-7 rounded border border-[#2b3644] bg-[#0a0f16] px-1.5 text-[10px] text-[#c4ccd5]"
                        >
                          {STATUSES.map((option) => (
                            <option key={option} value={option}>
                              {option.replace(/_/g, " ")}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <StatusBadge tone={statusTone(task.status)}>{task.status.replace(/_/g, " ")}</StatusBadge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function Filter<T extends readonly string[]>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: T;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#5c6978]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 rounded-md border border-[#2b3644] bg-[#0a0f16] px-2 text-[10px] text-[#c4ccd5]"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </label>
  );
}

function BacklogForm({
  projects,
  onDone,
  onError,
}: {
  projects: Array<{ id: string; name: string }>;
  onDone: (created: boolean) => void;
  onError: (message: string) => void;
}) {
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    const { ok, body } = await postJson("/api/tasks", {
      projectId: String(form.get("projectId") ?? ""),
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? "") || undefined,
      acceptanceCriteria: String(form.get("acceptanceCriteria") ?? "") || undefined,
      risk: String(form.get("risk") ?? "green"),
      priority: Number(form.get("priority") ?? 50),
      status: "backlog",
      source: String(form.get("source") ?? "owner"),
    });
    setPending(false);
    if (!ok) {
      onError(body.error?.message ?? "The backlog item could not be created.");
      return;
    }
    onError("");
    onDone(true);
  }

  return (
    <form onSubmit={submit} className="grid gap-3 border-b border-[#212b37] bg-[#0b1017] p-4 sm:grid-cols-2">
      <label className="sm:col-span-2">
        <span className="mb-1 block font-mono text-[8px] uppercase tracking-[0.12em] text-[#5c6978]">Title</span>
        <input name="title" required maxLength={240} className="form-control" placeholder="What needs to happen" />
      </label>
      <label>
        <span className="mb-1 block font-mono text-[8px] uppercase tracking-[0.12em] text-[#5c6978]">Project</span>
        <select name="projectId" required className="form-control">
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="mb-1 block font-mono text-[8px] uppercase tracking-[0.12em] text-[#5c6978]">Risk</span>
        <select name="risk" className="form-control" defaultValue="green">
          <option value="green">GREEN</option>
          <option value="yellow">YELLOW</option>
          <option value="red">RED</option>
        </select>
      </label>
      <label>
        <span className="mb-1 block font-mono text-[8px] uppercase tracking-[0.12em] text-[#5c6978]">Priority</span>
        <input name="priority" type="number" min={0} max={100} defaultValue={50} className="form-control" />
      </label>
      <label>
        <span className="mb-1 block font-mono text-[8px] uppercase tracking-[0.12em] text-[#5c6978]">Source</span>
        <select name="source" className="form-control" defaultValue="owner">
          {SOURCES.map((option) => (
            <option key={option} value={option}>
              {option.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>
      <label className="sm:col-span-2">
        <span className="mb-1 block font-mono text-[8px] uppercase tracking-[0.12em] text-[#5c6978]">
          Acceptance criteria
        </span>
        <textarea
          name="acceptanceCriteria"
          rows={2}
          maxLength={4000}
          className="form-control h-auto py-2"
          placeholder="How a reviewer will know this is done"
        />
      </label>
      <label className="sm:col-span-2">
        <span className="mb-1 block font-mono text-[8px] uppercase tracking-[0.12em] text-[#5c6978]">Description</span>
        <textarea name="description" rows={2} maxLength={4000} className="form-control h-auto py-2" />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" disabled={pending || projects.length === 0} className="primary-action">
          {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
          Create item
        </button>
        <button type="button" onClick={() => onDone(false)} className="secondary-action">
          Cancel
        </button>
      </div>
    </form>
  );
}
