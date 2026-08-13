"use client";

import {
  Activity,
  ArrowLeft,
  CloudCog,
  ExternalLink,
  FolderTree,
  GitPullRequestArrow,
  ListTodo,
  Loader2,
  Play,
  RefreshCw,
  Save,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { SafetyControls } from "@/components/safety-controls";
import {
  EmptyPanel,
  TenantStateGate,
  formatDateTime,
  riskTone,
  runStatusTone,
} from "@/components/tenant-states";
import { Panel, SectionTitle, StatusBadge } from "@/components/ui";
import { postJson, useTenantResource } from "@/lib/client/use-tenant-resource";

type ProjectDetail = {
  project: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    githubRepository: string | null;
    defaultBranch: string;
    productionUrl: string | null;
    healthStatus: string;
    tags: string[];
    vercelProjectId: string | null;
    vercelTeamSlug: string | null;
    supabaseProjectRef: string | null;
    createdAt: string;
    updatedAt: string;
    archivedAt: string | null;
    connectionId: string | null;
    connectionStatus: string;
    connectionStatusLabel: string;
    connectionAccount: string | null;
    connectionVerifiedAt: string | null;
    autonomy: {
      autonomousMode: boolean;
      maximumAutonomousRisk: string;
      autoApprove: boolean;
      autoMerge: boolean;
      autoDeploy: boolean;
      autoRollback: boolean;
      locked: boolean;
    };
  };
  canManage: boolean;
  backlog: {
    total: number;
    open: number;
    items: Array<{ id: string; title: string; status: string; risk: string; priority: number; source: string; createdAt: string }>;
  };
  runs: Array<{
    id: string;
    status: string;
    provider: string | null;
    model: string | null;
    step: string | null;
    failureKind: string | null;
    createdAt: string;
    completedAt: string | null;
    agent: { name: string; role: string } | null;
  }>;
  pullRequests: Array<{
    id: string;
    number: number;
    title: string;
    url: string;
    status: string;
    headBranch: string;
    baseBranch: string;
    openedAt: string | null;
  }>;
  activity: Array<{ id: string; type: string; description: string; occurredAt: string }>;
  latestReport: { id: string; type: string; title: string; summary: string | null; status: string } | null;
  deployments: { availability: string; detail: string };
};

const TABS = [
  "overview",
  "repository",
  "backlog",
  "runs",
  "pull-requests",
  "deployments",
  "activity",
  "settings",
] as const;

type Tab = (typeof TABS)[number];

export function ProjectDetailConsole({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<Tab>("overview");
  const detail = useTenantResource<ProjectDetail>(`/api/projects/${projectId}`, { pollMs: 30_000 });

  if (detail.state !== "ready" || !detail.data) {
    return (
      <TenantStateGate
        state={detail.state}
        message={detail.message}
        subject="this project"
        next={`/projects/${projectId}`}
      />
    );
  }

  const data = detail.data;
  const { project } = data;
  const connected = project.connectionStatus === "connected";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/projects" className="secondary-action">
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          All projects
        </Link>
        <div className="flex items-center gap-2">
          <StatusBadge tone={connected ? "safe" : "danger"}>{project.connectionStatusLabel}</StatusBadge>
          <button type="button" onClick={detail.reload} disabled={detail.refreshing} className="secondary-action">
            {detail.refreshing ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-3.5" aria-hidden="true" />
            )}
            Refresh
          </button>
        </div>
      </div>

      <Panel className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-white">{project.name}</h2>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-[#8490a0]">
              {project.description || "No description recorded."}
            </p>
            {project.tags.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {project.tags.map((tag) => (
                  <span key={tag} className="rounded border border-[#2a3542] bg-[#111821] px-2 py-1 text-[9px] text-[#8290a0]">
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="grid min-w-[240px] grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#27313f] bg-[#27313f]">
            <Meta label="Status" value={project.status} />
            <Meta label="Health" value={project.healthStatus} />
            <Meta label="Repository" value={project.githubRepository ?? "Not linked"} />
            <Meta label="Default branch" value={project.defaultBranch} />
          </div>
        </div>
      </Panel>

      <div role="tablist" aria-label="Project sections" className="flex flex-wrap gap-1.5 border-b border-[#1b2430] pb-3">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={`min-h-8 rounded-md border px-3 text-[10px] font-semibold capitalize transition-colors ${
              tab === name
                ? "border-[#2e3a25] bg-[#c6f135]/[0.08] text-[#eaffaa]"
                : "border-[#293442] bg-[#10161f] text-[#7d8998] hover:text-[#c4ccd5]"
            }`}
          >
            {name.replace(/-/g, " ")}
          </button>
        ))}
      </div>

      {tab === "overview" ? <Overview data={data} /> : null}
      {tab === "repository" ? <Repository data={data} /> : null}
      {tab === "backlog" ? <Backlog data={data} /> : null}
      {tab === "runs" ? <Runs data={data} /> : null}
      {tab === "pull-requests" ? <PullRequests data={data} /> : null}
      {tab === "deployments" ? <Deployments data={data} /> : null}
      {tab === "activity" ? <ActivityTab data={data} /> : null}
      {tab === "settings" ? <Settings data={data} onSaved={detail.reload} /> : null}
    </div>
  );
}

function Overview({ data }: { data: ProjectDetail }) {
  const activeRuns = data.runs.filter((run) => ["queued", "running", "validating"].includes(run.status));
  const openPullRequests = data.pullRequests.filter((pr) => pr.status === "draft" || pr.status === "open");

  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
      <div className="space-y-4">
        <Panel className="p-5">
          <SectionTitle title="Current state" description="Live tenant records for this project." />
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Open backlog" value={String(data.backlog.open)} />
            <Stat label="Active runs" value={String(activeRuns.length)} />
            <Stat label="Open pull requests" value={String(openPullRequests.length)} />
            <Stat label="Connection" value={data.project.connectionStatusLabel} />
          </dl>
        </Panel>

        <Panel className="p-5">
          <SectionTitle title="Active work" description="Runs currently queued or executing." />
          <div className="mt-4">
            {activeRuns.length === 0 ? (
              <p className="text-[11px] text-[#667485]">No run is queued or executing for this project.</p>
            ) : (
              <ul className="space-y-2">
                {activeRuns.map((run) => (
                  <li key={run.id}>
                    <Link
                      href={`/runs/${run.id}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-[#293442] bg-[#0a0f16] p-3 transition-colors hover:border-[#3a4859]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs text-[#cfd6dd]">
                          {run.agent?.name ?? "Agent"} · {run.step?.replace(/_/g, " ") ?? "starting"}
                        </span>
                        <span className="mt-0.5 block font-mono text-[9px] text-[#5f6c7c]">{run.id.slice(0, 8)}</span>
                      </span>
                      <StatusBadge tone={runStatusTone(run.status)}>{run.status}</StatusBadge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <Panel className="p-5">
          <SectionTitle title="Latest activity" />
          <div className="mt-4">
            {data.activity.length === 0 ? (
              <p className="text-[11px] text-[#667485]">No activity recorded for this project.</p>
            ) : (
              <ul className="divide-y divide-[#202a36]">
                {data.activity.slice(0, 8).map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0">
                    <span className="min-w-0 text-[11px] leading-5 text-[#a3aebd]">{event.description}</span>
                    <time dateTime={event.occurredAt} className="shrink-0 font-mono text-[9px] text-[#566271]">
                      {formatDateTime(event.occurredAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel className="p-5">
          <SectionTitle title="Autonomy configuration" description="Enforced by hosted database constraints." />
          <dl className="mt-4 space-y-2 text-[10px]">
            {(
              [
                ["Autonomous mode", data.project.autonomy.autonomousMode ? "ON" : "OFF"],
                ["Risk ceiling", data.project.autonomy.maximumAutonomousRisk.toUpperCase()],
                ["Auto approve", data.project.autonomy.autoApprove ? "ON" : "OFF"],
                ["Auto merge", data.project.autonomy.autoMerge ? "ON" : "OFF"],
                ["Auto deploy", data.project.autonomy.autoDeploy ? "ON" : "OFF"],
                ["Auto rollback", data.project.autonomy.autoRollback ? "ON" : "OFF"],
              ] as const
            ).map(([label, state]) => (
              <div key={label} className="flex items-center justify-between gap-3">
                <dt className="text-[#5f6c7c]">{label}</dt>
                <dd className="font-mono font-semibold text-[#a3aebd]">{state}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        {data.latestReport ? (
          <Panel className="p-5">
            <SectionTitle title="Latest report" />
            <p className="mt-3 text-xs font-semibold text-[#d5dbe2]">{data.latestReport.title}</p>
            {data.latestReport.summary ? (
              <p className="mt-2 text-[11px] leading-5 text-[#8f9caa]">{data.latestReport.summary}</p>
            ) : null}
          </Panel>
        ) : null}

        <Panel className="p-5">
          <SectionTitle title="Quick actions" />
          <div className="mt-4 flex flex-col gap-2">
            <Link href={`/files?project=${data.project.id}`} className="secondary-action justify-center">
              <FolderTree className="size-3.5" aria-hidden="true" />
              Browse repository files
            </Link>
            <Link href="/bot-manager" className="secondary-action justify-center">
              <Play className="size-3.5" aria-hidden="true" />
              Submit a command
            </Link>
            {data.project.productionUrl ? (
              <a
                href={data.project.productionUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="secondary-action justify-center"
              >
                <ExternalLink className="size-3.5" aria-hidden="true" />
                Open production URL
              </a>
            ) : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Repository({ data }: { data: ProjectDetail }) {
  return (
    <Panel className="p-5">
      <SectionTitle title="Repository binding" description="Resolved from the verified GitHub App installation." />
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <Stat label="Repository" value={data.project.githubRepository ?? "Not linked"} />
        <Stat label="Default branch" value={data.project.defaultBranch} />
        <Stat label="Connection account" value={data.project.connectionAccount ?? "—"} />
        <Stat label="Last verified" value={formatDateTime(data.project.connectionVerifiedAt)} />
      </dl>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href={`/files?project=${data.project.id}`} className="primary-action">
          Browse files
          <FolderTree className="size-4" aria-hidden="true" />
        </Link>
        {data.project.githubRepository ? (
          <a
            href={`https://github.com/${data.project.githubRepository}`}
            target="_blank"
            rel="noreferrer noopener"
            className="secondary-action"
          >
            Open GitHub
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </Panel>
  );
}

function Backlog({ data }: { data: ProjectDetail }) {
  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-[#212b37] p-4">
        <SectionTitle
          title={`Backlog (${data.backlog.open} open of ${data.backlog.total})`}
          description="Highest priority first."
        />
      </div>
      {data.backlog.items.length === 0 ? (
        <EmptyPanel
          title="No backlog items"
          description="Create one from the Backlog page, or submit a command and let the orchestrator plan the work."
          icon={ListTodo}
        />
      ) : (
        <ul className="divide-y divide-[#202a36]">
          {data.backlog.items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 p-4">
              <span className="min-w-0">
                <span className="block text-xs font-medium text-[#cfd6dd]">{item.title}</span>
                <span className="mt-1 block font-mono text-[8px] uppercase tracking-[0.1em] text-[#4f5b69]">
                  priority {item.priority} · {item.source.replace(/_/g, " ")} · {formatDateTime(item.createdAt)}
                </span>
              </span>
              <span className="flex shrink-0 gap-2">
                <StatusBadge tone={riskTone(item.risk)} dot={false}>
                  {item.risk.toUpperCase()}
                </StatusBadge>
                <StatusBadge tone="neutral">{item.status.replace(/_/g, " ")}</StatusBadge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Runs({ data }: { data: ProjectDetail }) {
  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-[#212b37] p-4">
        <SectionTitle title="Runs" description="The most recent worker runs for this project." />
      </div>
      {data.runs.length === 0 ? (
        <EmptyPanel
          title="No runs recorded"
          description="A run appears once a command is planned for this project."
          icon={Play}
        />
      ) : (
        <ul className="divide-y divide-[#202a36]">
          {data.runs.map((run) => (
            <li key={run.id}>
              <Link href={`/runs/${run.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-[#111821]">
                <span className="min-w-0">
                  <span className="block text-xs text-[#cfd6dd]">
                    {run.agent?.name ?? "Agent"}
                    {run.provider ? ` · ${run.provider}` : ""}
                  </span>
                  <span className="mt-1 block font-mono text-[8px] uppercase tracking-[0.1em] text-[#4f5b69]">
                    {run.id.slice(0, 8)} · {formatDateTime(run.createdAt)}
                    {run.failureKind ? ` · ${run.failureKind.replace(/_/g, " ")}` : ""}
                  </span>
                </span>
                <StatusBadge tone={runStatusTone(run.status)}>{run.status.replace(/_/g, " ")}</StatusBadge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function PullRequests({ data }: { data: ProjectDetail }) {
  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-[#212b37] p-4">
        <SectionTitle
          title="Pull requests"
          description="Draft pull requests SoftwareFactory opened. Merging is always a human action."
        />
      </div>
      {data.pullRequests.length === 0 ? (
        <EmptyPanel
          title="No pull requests recorded"
          description="A pull request appears here once a run produces a reviewable change."
          icon={GitPullRequestArrow}
        />
      ) : (
        <ul className="divide-y divide-[#202a36]">
          {data.pullRequests.map((pullRequest) => (
            <li key={pullRequest.id}>
              <a
                href={pullRequest.url}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center justify-between gap-3 p-4 hover:bg-[#111821]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs text-[#cfd6dd]">
                    #{pullRequest.number} {pullRequest.title}
                  </span>
                  <span className="mt-1 block font-mono text-[8px] text-[#4f5b69]">
                    {pullRequest.headBranch} → {pullRequest.baseBranch}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <StatusBadge tone={pullRequest.status === "draft" ? "warning" : "info"} dot={false}>
                    {pullRequest.status}
                  </StatusBadge>
                  <ExternalLink className="size-3.5 text-[#5f6c7c]" aria-hidden="true" />
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Deployments({ data }: { data: ProjectDetail }) {
  return (
    <Panel className="p-5">
      <SectionTitle title="Deployments" description="Deployment visibility requires a connected provider." />
      <div className="mt-4 flex items-start gap-3 rounded-lg border border-[#293442] bg-[#0a0f16] p-4">
        <CloudCog className="mt-0.5 size-4 shrink-0 text-[#5f6b7a]" aria-hidden="true" />
        <div>
          <StatusBadge tone="neutral">Not Connected</StatusBadge>
          <p className="mt-2 text-[11px] leading-5 text-[#7e8a99]">{data.deployments.detail}</p>
          <p className="mt-2 text-[10px] leading-4 text-[#66717f]">
            SoftwareFactory has no in-product deploy or rollback executor. Adding a provider credential enables
            visibility only.
          </p>
        </div>
      </div>
    </Panel>
  );
}

function ActivityTab({ data }: { data: ProjectDetail }) {
  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-[#212b37] p-4">
        <SectionTitle title="Activity" description="Immutable audit evidence for this project." />
      </div>
      {data.activity.length === 0 ? (
        <EmptyPanel title="No activity recorded" description="Material transitions append evidence here." icon={Activity} />
      ) : (
        <ul className="divide-y divide-[#202a36]">
          {data.activity.map((event) => (
            <li key={event.id} className="flex items-start justify-between gap-3 p-4">
              <span className="min-w-0">
                <span className="block text-[11px] leading-5 text-[#a3aebd]">{event.description}</span>
                <span className="mt-1 block font-mono text-[8px] uppercase tracking-[0.1em] text-[#4f5b69]">
                  {event.type}
                </span>
              </span>
              <time dateTime={event.occurredAt} className="shrink-0 font-mono text-[9px] text-[#566271]">
                {formatDateTime(event.occurredAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Settings({ data, onSaved }: { data: ProjectDetail; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const tags = String(form.get("tags") ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    const payload: Record<string, unknown> = {
      name: String(form.get("name") ?? ""),
      description: String(form.get("description") ?? ""),
      status: String(form.get("status") ?? ""),
      tags,
    };
    for (const [field, key] of [
      ["productionUrl", "productionUrl"],
      ["vercelProjectId", "vercelProjectId"],
      ["vercelTeamSlug", "vercelTeamSlug"],
      ["supabaseProjectRef", "supabaseProjectRef"],
    ] as const) {
      const raw = String(form.get(field) ?? "").trim();
      if (raw) payload[key] = raw;
    }

    setSaving(true);
    const { ok, body } = await postJson("/api/projects/" + data.project.id, payload, "PATCH");
    setSaving(false);
    setMessage(ok ? "Project saved." : (body.error?.message ?? "The project could not be saved."));
    if (ok) onSaved();
  }

  return (
    <div className="space-y-4">
      <Panel className="p-5 sm:p-6">
        <SectionTitle title="Project settings" description="Portfolio metadata for this project." />
        {!data.canManage ? (
          <p className="mt-4 rounded-lg border border-[#423824] bg-[#221c11] p-3 text-[10px] leading-5 text-[#b6a77f]">
            These settings are read-only for your role.
          </p>
        ) : null}
        <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input name="name" defaultValue={data.project.name} maxLength={160} disabled={!data.canManage} className="form-control" />
          </Field>
          <Field label="Status">
            <select name="status" defaultValue={data.project.status} disabled={!data.canManage} className="form-control">
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="archived">archived</option>
            </select>
          </Field>
          <Field label="Production URL">
            <input
              name="productionUrl"
              type="url"
              defaultValue={data.project.productionUrl ?? ""}
              placeholder="https://example.com"
              disabled={!data.canManage}
              className="form-control"
            />
          </Field>
          <Field label="Tags (comma separated)">
            <input name="tags" defaultValue={data.project.tags.join(", ")} disabled={!data.canManage} className="form-control" />
          </Field>
          <Field label="Vercel project ID">
            <input name="vercelProjectId" defaultValue={data.project.vercelProjectId ?? ""} disabled={!data.canManage} className="form-control" />
          </Field>
          <Field label="Vercel team slug">
            <input name="vercelTeamSlug" defaultValue={data.project.vercelTeamSlug ?? ""} disabled={!data.canManage} className="form-control" />
          </Field>
          <Field label="Supabase project ref">
            <input
              name="supabaseProjectRef"
              defaultValue={data.project.supabaseProjectRef ?? ""}
              placeholder="20 lowercase letters"
              disabled={!data.canManage}
              className="form-control"
            />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <textarea
              name="description"
              defaultValue={data.project.description ?? ""}
              rows={3}
              maxLength={2000}
              disabled={!data.canManage}
              className="form-control h-auto py-2"
            />
          </Field>
          {data.canManage ? (
            <div className="sm:col-span-2">
              <button type="submit" disabled={saving} className="primary-action">
                {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Save className="size-3.5" aria-hidden="true" />}
                Save project
              </button>
            </div>
          ) : null}
        </form>
        {message ? (
          <p role="status" className="mt-4 text-[10px] leading-5 text-[#9aa7b7]">
            {message}
          </p>
        ) : null}
      </Panel>

      <Panel className="p-5 sm:p-6">
        <SectionTitle
          title="Autonomy and safety"
          description="These controls are constrained by hosted database checks and cannot be enabled from the browser."
        />
        <div className="mt-5">
          <SafetyControls />
        </div>
      </Panel>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0b1017] p-3">
      <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#7c8998]">{label}</p>
      <p className="mt-1 truncate text-[11px] font-medium text-[#c4ccd5]">{value}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#25303d] bg-[#0a0f16] p-3">
      <dt className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#687586]">{label}</dt>
      <dd className="mt-2 truncate text-xs font-semibold text-[#d2d8df]">{value}</dd>
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block font-mono text-[8px] uppercase tracking-[0.12em] text-[#5c6978]">{label}</span>
      {children}
    </label>
  );
}
