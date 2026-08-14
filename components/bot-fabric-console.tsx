"use client";

import {
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleSlash,
  KeyRound,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Card, StatusBadge } from "@/components/ui";
import {
  BOT_PROVIDERS,
  BOT_ROLE_TEMPLATES,
  findBotProvider,
  type BotProvider,
  type BotProviderId,
} from "@/lib/bots/catalog";
import type {
  BotFabricResponse,
  SerializedAssignment,
  SerializedBot,
  SerializedBotRole,
  SerializedProject,
} from "@/lib/bots/types";
import { cn } from "@/lib/cn";
import { RISK_LEVELS, type RiskLevel } from "@/lib/risk";

type ViewState = "loading" | "signed-out" | "setup" | "ready" | "error";
type Tab = "fleet" | "bots" | "roles";

type BotDraft = {
  provider: BotProviderId;
  name: string;
  model: string;
  credentialRef: string;
  baseUrl: string;
  notes: string;
};

type RoleDraft = {
  roleId: string | null;
  name: string;
  slug: string;
  summary: string;
  instructions: string;
  riskCeiling: RiskLevel;
  capabilities: string;
};

const emptyRoleDraft: RoleDraft = {
  roleId: null,
  name: "",
  slug: "",
  summary: "",
  instructions: "",
  riskCeiling: "GREEN",
  capabilities: "",
};

function draftForProvider(provider: BotProvider): BotDraft {
  return {
    provider: provider.id,
    name: provider.label,
    model: provider.suggestedModels[0] ?? "",
    credentialRef: provider.defaultCredentialRef ?? "",
    baseUrl: "",
    notes: "",
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

async function readError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function BotFabricConsole() {
  const [state, setState] = useState<ViewState>("loading");
  const [fabric, setFabric] = useState<BotFabricResponse | null>(null);
  const [tab, setTab] = useState<Tab>("fleet");
  const [message, setMessage] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/bots", { cache: "no-store" });
      if (response.status === 401) {
        setState("signed-out");
        return;
      }
      if (response.status === 409) {
        setState("setup");
        return;
      }
      if (!response.ok) {
        setMessage(await readError(response, "The bot fabric could not be loaded."));
        setState("error");
        return;
      }
      setFabric((await response.json()) as BotFabricResponse);
      setState("ready");
    } catch {
      setMessage("The bot fabric service could not be reached.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const mutate = useCallback(
    async (
      key: string,
      url: string,
      init: RequestInit,
      successMessage: string,
    ): Promise<boolean> => {
      setBusyKey(key);
      setMessage("");
      try {
        const response = await fetch(url, {
          ...init,
          headers: init.body ? { "Content-Type": "application/json" } : undefined,
        });
        if (!response.ok) {
          setMessage(await readError(response, "That change could not be saved."));
          return false;
        }
        setMessage(successMessage);
        await load();
        return true;
      } catch {
        setMessage("That change could not be saved.");
        return false;
      } finally {
        setBusyKey(null);
      }
    },
    [load],
  );

  if (state === "loading") {
    return (
      <Card className="grid min-h-64 place-items-center">
        <Loader2 className="size-6 animate-spin text-[var(--accent)]" aria-label="Loading the bot fabric" />
      </Card>
    );
  }
  if (state === "signed-out") {
    return (
      <FabricNotice
        title="Sign in to manage your bots"
        description="The bot fabric is scoped to your authenticated SoftwareFactory organization."
        href="/auth/sign-in?next=%2Fsolutions%2Fbot-manager"
        label="Sign in"
      />
    );
  }
  if (state === "setup") {
    return (
      <FabricNotice
        title="Complete organization setup"
        description="Create or select an organization before registering bots."
        href="/solutions/connections"
        label="Open connections"
      />
    );
  }
  if (state === "error" || !fabric) {
    return (
      <FabricNotice
        title="The bot fabric is unavailable"
        description={message || "The service could not be reached."}
        href="/solutions/connections"
        label="Review connections"
      />
    );
  }

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: "fleet", label: "Fleet", count: fabric.assignments.length },
    { id: "bots", label: "Bots", count: fabric.bots.length },
    { id: "roles", label: "Roles", count: fabric.roles.length },
  ];

  return (
    <div className="space-y-5">
      <ExecutorNotice detail={fabric.executor.detail} />

      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Bot fabric sections">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`bot-fabric-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls={`bot-fabric-panel-${entry.id}`}
            onClick={() => setTab(entry.id)}
            className={cn(
              "inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors",
              tab === entry.id
                ? "border-[var(--accent-border)] bg-[var(--accent)]/[0.08] text-[var(--accent-text)]"
                : "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-white",
            )}
          >
            {entry.label}
            <span className="rounded bg-[var(--surface-inset)] px-1.5 py-0.5 font-mono text-xs text-[var(--text-muted)]">
              {entry.count}
            </span>
          </button>
        ))}
      </div>

      {message ? (
        <p
          className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] px-4 py-3 text-xs text-[var(--warning)]"
          aria-live="polite"
        >
          {message}
        </p>
      ) : null}

      {!fabric.canManage ? (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 text-xs text-[var(--text-muted)]">
          You have read access to this fabric. Registering, assigning, and retiring bots requires
          organization owner or administrator access.
        </p>
      ) : null}

      <div
        role="tabpanel"
        id={`bot-fabric-panel-${tab}`}
        aria-labelledby={`bot-fabric-tab-${tab}`}
      >
        {tab === "fleet" ? (
          <FleetBoard fabric={fabric} busyKey={busyKey} mutate={mutate} onOpenTab={setTab} />
        ) : null}
        {tab === "bots" ? <BotDirectory fabric={fabric} busyKey={busyKey} mutate={mutate} /> : null}
        {tab === "roles" ? <RoleWorkshop fabric={fabric} busyKey={busyKey} mutate={mutate} /> : null}
      </div>
    </div>
  );
}

type MutateFn = (
  key: string,
  url: string,
  init: RequestInit,
  successMessage: string,
) => Promise<boolean>;

function ExecutorNotice({ detail }: { detail: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-surface)] px-4 py-3">
      <CircleSlash className="mt-0.5 size-4 shrink-0 text-[var(--danger)]" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[var(--danger)]">Worker Not Connected</p>
        <p className="mt-1 text-sm leading-5 text-[var(--danger)]">{detail}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ fleet */

function FleetBoard({
  fabric,
  busyKey,
  mutate,
  onOpenTab,
}: {
  fabric: BotFabricResponse;
  busyKey: string | null;
  mutate: MutateFn;
  onOpenTab: (tab: Tab) => void;
}) {
  const assignmentByBotId = useMemo(
    () => new Map(fabric.assignments.map((assignment) => [assignment.botId, assignment])),
    [fabric.assignments],
  );
  const bench = fabric.bots.filter((bot) => !assignmentByBotId.has(bot.id));

  if (!fabric.bots.length) {
    return (
      <EmptyPrompt
        icon={Bot}
        title="No bots registered yet"
        description="Register Claude, Codex, Gemini, Grok, or any OpenAI-compatible endpoint. It takes one screen."
        actionLabel="Add your first bot"
        onAction={() => onOpenTab("bots")}
      />
    );
  }
  if (!fabric.roles.length) {
    return (
      <EmptyPrompt
        icon={Wrench}
        title="Define a role before assigning"
        description="A role is the job description a bot carries into a project. Adopt a starter role in one click, or write your own."
        actionLabel="Open roles"
        onAction={() => onOpenTab("roles")}
      />
    );
  }
  if (!fabric.projects.length) {
    return (
      <EmptyPrompt
        icon={ArrowRight}
        title="Connect a project first"
        description="Bots are posted to projects. Link a repository-backed project, then assign your fleet."
        actionHref="/solutions/projects"
        actionLabel="Open projects"
      />
    );
  }

  return (
    <div className="space-y-5">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Bench</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
              Unposted bots. Pick a project and role, then assign.
            </p>
          </div>
          <StatusBadge tone="neutral">{bench.length} available</StatusBadge>
        </div>
        {bench.length ? (
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {bench.map((bot) => (
              <BenchCard
                key={bot.id}
                bot={bot}
                fabric={fabric}
                busyKey={busyKey}
                mutate={mutate}
              />
            ))}
          </div>
        ) : (
          <p className="mt-5 rounded-lg border border-dashed border-[var(--border)] px-4 py-6 text-center text-xs text-[var(--text-faint)]">
            Every registered bot currently holds a posting.
          </p>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {fabric.projects.map((project) => (
          <ProjectColumn
            key={project.id}
            project={project}
            fabric={fabric}
            busyKey={busyKey}
            mutate={mutate}
          />
        ))}
      </div>
    </div>
  );
}

function BenchCard({
  bot,
  fabric,
  busyKey,
  mutate,
}: {
  bot: SerializedBot;
  fabric: BotFabricResponse;
  busyKey: string | null;
  mutate: MutateFn;
}) {
  const [projectId, setProjectId] = useState(fabric.projects[0]?.id ?? "");
  const [roleId, setRoleId] = useState(fabric.roles[0]?.id ?? "");
  const key = `assign:${bot.id}`;

  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--surface-inset)] p-4">
      <BotIdentity bot={bot} />
      <div className="mt-4 grid gap-2">
        <Field label="Project" htmlFor={`bench-project-${bot.id}`}>
          <select
            id={`bench-project-${bot.id}`}
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className="input"
          >
            {fabric.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Role" htmlFor={`bench-role-${bot.id}`}>
          <select
            id={`bench-role-${bot.id}`}
            value={roleId}
            onChange={(event) => setRoleId(event.target.value)}
            className="input"
          >
            {fabric.roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          disabled={!fabric.canManage || busyKey === key || !projectId || !roleId}
          onClick={() =>
            void mutate(
              key,
              "/api/bot-assignments",
              { method: "POST", body: JSON.stringify({ botId: bot.id, projectId, roleId }) },
              `${bot.name} is posted. Assignment is routing intent; no worker runs it.`,
            )
          }
          className="btn btn-primary mt-1 justify-center"
        >
          {busyKey === key ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="size-4" aria-hidden="true" />
          )}
          Assign {bot.name}
        </button>
      </div>
    </article>
  );
}

function ProjectColumn({
  project,
  fabric,
  busyKey,
  mutate,
}: {
  project: SerializedProject;
  fabric: BotFabricResponse;
  busyKey: string | null;
  mutate: MutateFn;
}) {
  const postings = fabric.assignments.filter((assignment) => assignment.projectId === project.id);

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-white">{project.name}</h2>
          <p className="mt-1 truncate font-mono text-xs text-[var(--text-faint)]">
            {project.githubRepository ?? "No repository linked"}
          </p>
        </div>
        <StatusBadge tone={postings.length ? "safe" : "neutral"}>
          {postings.length} posted
        </StatusBadge>
      </div>

      <div className="mt-4 space-y-3">
        {postings.length ? (
          postings.map((assignment) => {
            const bot = fabric.bots.find((entry) => entry.id === assignment.botId);
            if (!bot) return null;
            return (
              <PostingCard
                key={assignment.id}
                assignment={assignment}
                bot={bot}
                fabric={fabric}
                busyKey={busyKey}
                mutate={mutate}
              />
            );
          })
        ) : (
          <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-5 text-center text-sm text-[var(--text-faint)]">
            No bots posted to this project yet.
          </p>
        )}
      </div>
    </Card>
  );
}

function PostingCard({
  assignment,
  bot,
  fabric,
  busyKey,
  mutate,
}: {
  assignment: SerializedAssignment;
  bot: SerializedBot;
  fabric: BotFabricResponse;
  busyKey: string | null;
  mutate: MutateFn;
}) {
  const moveKey = `move:${assignment.id}`;
  const statusKey = `status:${assignment.id}`;
  const disabled = !fabric.canManage || busyKey === moveKey || busyKey === statusKey;

  function reassign(projectId: string, roleId: string, successMessage: string) {
    void mutate(
      moveKey,
      "/api/bot-assignments",
      { method: "POST", body: JSON.stringify({ botId: bot.id, projectId, roleId }) },
      successMessage,
    );
  }

  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--surface-inset)] p-4">
      <div className="flex items-start justify-between gap-3">
        <BotIdentity bot={bot} />
        <StatusBadge tone={assignment.status === "active" ? "safe" : "warning"}>
          {assignment.status === "active" ? "Active" : "Paused"}
        </StatusBadge>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Field label="Move to project" htmlFor={`move-${assignment.id}`}>
          <select
            id={`move-${assignment.id}`}
            value={assignment.projectId}
            disabled={disabled}
            onChange={(event) =>
              reassign(
                event.target.value,
                assignment.roleId,
                `${bot.name} moved to a new project.`,
              )
            }
            className="input"
          >
            {fabric.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Role" htmlFor={`role-${assignment.id}`}>
          <select
            id={`role-${assignment.id}`}
            value={assignment.roleId}
            disabled={disabled}
            onChange={(event) =>
              reassign(
                assignment.projectId,
                event.target.value,
                `${bot.name} is now working as a different role.`,
              )
            }
            className="input"
          >
            {fabric.roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            void mutate(
              statusKey,
              `/api/bot-assignments/${assignment.id}`,
              {
                method: "PATCH",
                body: JSON.stringify({
                  status: assignment.status === "active" ? "paused" : "active",
                }),
              },
              assignment.status === "active"
                ? `${bot.name} is paused on this project.`
                : `${bot.name} is active on this project.`,
            )
          }
          className="btn btn-secondary btn-sm"
        >
          {assignment.status === "active" ? (
            <Pause className="size-3.5" aria-hidden="true" />
          ) : (
            <Play className="size-3.5" aria-hidden="true" />
          )}
          {assignment.status === "active" ? "Pause" : "Resume"}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            void mutate(
              statusKey,
              `/api/bot-assignments/${assignment.id}`,
              { method: "PATCH", body: JSON.stringify({ status: "released" }) },
              `${bot.name} returned to the bench.`,
            )
          }
          className="btn btn-secondary btn-sm"
        >
          <ArrowRight className="size-3.5" aria-hidden="true" />
          Return to bench
        </button>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------- bots */

function BotDirectory({
  fabric,
  busyKey,
  mutate,
}: {
  fabric: BotFabricResponse;
  busyKey: string | null;
  mutate: MutateFn;
}) {
  const [draft, setDraft] = useState<BotDraft | null>(null);
  const provider = draft ? findBotProvider(draft.provider) : null;
  const modelListId = "bot-model-suggestions";

  return (
    <div className="space-y-5">
      <Card className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-[var(--accent-border)] bg-[var(--accent-surface)] text-[var(--accent)]">
            <Sparkles className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-white">Connect a bot</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
              Pick a provider and everything else is pre-filled. Credentials stay in server-side
              environment variables — you reference the variable name, never paste a key.
            </p>
          </div>
        </div>

        <ul className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {BOT_PROVIDERS.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                disabled={!fabric.canManage}
                onClick={() => setDraft(draftForProvider(entry))}
                aria-pressed={draft?.provider === entry.id}
                className={cn(
                  "flex w-full min-h-20 flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  draft?.provider === entry.id
                    ? "border-[var(--accent-border)] bg-[var(--accent)]/[0.08]"
                    : "border-[var(--border)] bg-[var(--surface-inset)] hover:border-[var(--border-strong)]",
                )}
              >
                <span
                  className="grid size-7 place-items-center rounded-md border border-[var(--border)] font-mono text-xs font-bold"
                  style={{ color: entry.accent }}
                  aria-hidden="true"
                >
                  {entry.monogram}
                </span>
                <span className="text-sm font-semibold text-[var(--text)]">{entry.label}</span>
                <span className="text-xs text-[var(--text-faint)]">{entry.vendor}</span>
              </button>
            </li>
          ))}
        </ul>

        {draft && provider ? (
          <form
            className="mt-5 grid gap-4 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void mutate(
                "register",
                "/api/bots",
                {
                  method: "POST",
                  body: JSON.stringify({
                    provider: draft.provider,
                    name: draft.name.trim(),
                    model: draft.model.trim(),
                    credentialRef: draft.credentialRef.trim() || null,
                    baseUrl: draft.baseUrl.trim() || null,
                    notes: draft.notes.trim() || null,
                  }),
                },
                `${draft.name.trim()} is registered. Run a readiness check to confirm its credential resolves.`,
              ).then((ok) => {
                if (ok) setDraft(null);
              });
            }}
          >
            <p className="md:col-span-2 text-sm leading-5 text-[var(--text-muted)]">{provider.summary}</p>

            <Field label="Bot name" htmlFor="bot-name">
              <input
                id="bot-name"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                required
                maxLength={80}
                className="input"
              />
            </Field>

            <Field
              label="Model identifier"
              htmlFor="bot-model"
              hint="Suggestions listed; any model identifier your provider supports is accepted."
            >
              <input
                id="bot-model"
                value={draft.model}
                onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                required
                maxLength={120}
                list={modelListId}
                className="input"
              />
              <datalist id={modelListId}>
                {provider.suggestedModels.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </Field>

            <Field
              label="Credential variable name"
              htmlFor="bot-credential"
              hint="The server reads this environment variable. Never paste the key itself."
            >
              <input
                id="bot-credential"
                value={draft.credentialRef}
                onChange={(event) => setDraft({ ...draft, credentialRef: event.target.value })}
                maxLength={64}
                spellCheck={false}
                placeholder={provider.defaultCredentialRef ?? "Not required"}
                className="input font-mono"
              />
            </Field>

            <Field
              label={provider.requiresBaseUrl ? "HTTPS endpoint (required)" : "HTTPS endpoint (optional)"}
              htmlFor="bot-base-url"
            >
              <input
                id="bot-base-url"
                value={draft.baseUrl}
                onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                maxLength={300}
                inputMode="url"
                placeholder="https://gateway.example.com/v1"
                className="input font-mono"
              />
            </Field>

            <Field label="Notes" htmlFor="bot-notes" className="md:col-span-2">
              <input
                id="bot-notes"
                value={draft.notes}
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                maxLength={500}
                placeholder="What this bot is good at"
                className="input"
              />
            </Field>

            <div className="flex flex-col gap-3 md:col-span-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <ShieldCheck className="size-4 text-[var(--accent)]" aria-hidden="true" />
                Registration stores metadata and a secret reference only.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setDraft(null)} className="btn btn-secondary btn-sm">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyKey === "register" || !draft.name.trim() || !draft.model.trim()}
                  className="btn btn-primary justify-center"
                >
                  {busyKey === "register" ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="size-4" aria-hidden="true" />
                  )}
                  Register bot
                </button>
              </div>
            </div>
          </form>
        ) : null}
      </Card>

      {fabric.bots.map((bot) => (
        <BotRow key={bot.id} bot={bot} fabric={fabric} busyKey={busyKey} mutate={mutate} />
      ))}
    </div>
  );
}

function BotRow({
  bot,
  fabric,
  busyKey,
  mutate,
}: {
  bot: SerializedBot;
  fabric: BotFabricResponse;
  busyKey: string | null;
  mutate: MutateFn;
}) {
  const checkKey = `check:${bot.id}`;
  const retireKey = `retire:${bot.id}`;
  const [confirmingRetire, setConfirmingRetire] = useState(false);
  const drifted = bot.currentReadiness !== bot.readiness;

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <BotIdentity bot={bot} />
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <Metric label="Credential reference" value={bot.credentialRef ?? "None"} mono />
            <Metric
              label="Secret present on server"
              value={bot.credentialPresent ? "Yes" : "No"}
              tone={bot.credentialPresent ? "safe" : "warning"}
            />
            <Metric
              label="Last checked"
              value={bot.lastCheckedAt ? new Date(bot.lastCheckedAt).toLocaleString() : "Never"}
            />
          </dl>
          {bot.readinessDetail ? (
            <p className="mt-3 text-sm leading-5 text-[var(--text-muted)]">{bot.readinessDetail}</p>
          ) : null}
          {drifted ? (
            <p className="mt-2 text-sm leading-5 text-[var(--warning)]">
              Configuration changed since the last check: {bot.currentReadinessDetail}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            disabled={!fabric.canManage || busyKey === checkKey}
            onClick={() =>
              void mutate(
                checkKey,
                `/api/bots/${bot.id}/check`,
                { method: "POST" },
                `Readiness recorded for ${bot.name}. This checks configuration only; no provider request is made.`,
              )
            }
            className="btn btn-secondary btn-sm"
          >
            {busyKey === checkKey ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-3.5" aria-hidden="true" />
            )}
            Check readiness
          </button>
          {confirmingRetire ? (
            <>
              <button
                type="button"
                disabled={busyKey === retireKey}
                onClick={() =>
                  void mutate(
                    retireKey,
                    `/api/bots/${bot.id}`,
                    { method: "DELETE" },
                    `${bot.name} was retired and released from every project.`,
                  ).then(() => setConfirmingRetire(false))
                }
                className="btn btn-secondary btn-sm border-[var(--danger-border)] text-[var(--danger)]"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                Confirm retire
              </button>
              <button
                type="button"
                onClick={() => setConfirmingRetire(false)}
                className="btn btn-secondary btn-sm"
              >
                Keep
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={!fabric.canManage}
              onClick={() => setConfirmingRetire(true)}
              className="btn btn-secondary btn-sm"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              Retire
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ roles */

function RoleWorkshop({
  fabric,
  busyKey,
  mutate,
}: {
  fabric: BotFabricResponse;
  busyKey: string | null;
  mutate: MutateFn;
}) {
  const [draft, setDraft] = useState<RoleDraft | null>(null);
  const adoptedSlugs = new Set(fabric.roles.map((role) => role.slug));

  function saveDraft(current: RoleDraft, successMessage: string) {
    void mutate(
      "role-save",
      "/api/bot-roles",
      {
        method: "POST",
        body: JSON.stringify({
          roleId: current.roleId,
          name: current.name.trim(),
          slug: current.slug.trim() || slugify(current.name),
          summary: current.summary.trim(),
          instructions: current.instructions.trim(),
          riskCeiling: current.riskCeiling,
          capabilities: current.capabilities
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)
            .slice(0, 12),
        }),
      },
      successMessage,
    ).then((ok) => {
      if (ok) setDraft(null);
    });
  }

  return (
    <div className="space-y-5">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Starter roles</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
              Adopt one in a click, then edit it however you like. Roles you author are the source of
              truth.
            </p>
          </div>
          <button
            type="button"
            disabled={!fabric.canManage}
            onClick={() => setDraft({ ...emptyRoleDraft })}
            className="btn btn-primary"
          >
            <Plus className="size-4" aria-hidden="true" />
            New role
          </button>
        </div>

        <ul className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {BOT_ROLE_TEMPLATES.map((template) => {
            const adopted = adoptedSlugs.has(template.slug);
            return (
              <li
                key={template.slug}
                className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface-inset)] p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[var(--text)]">{template.name}</h3>
                  <StatusBadge tone={template.riskCeiling === "RED" ? "danger" : "neutral"} dot={false}>
                    {template.riskCeiling}
                  </StatusBadge>
                </div>
                <p className="mt-2 flex-1 text-sm leading-5 text-[var(--text-muted)]">{template.summary}</p>
                <button
                  type="button"
                  disabled={!fabric.canManage || adopted || busyKey === "role-save"}
                  onClick={() =>
                    saveDraft(
                      {
                        roleId: null,
                        name: template.name,
                        slug: template.slug,
                        summary: template.summary,
                        instructions: template.instructions,
                        riskCeiling: template.riskCeiling,
                        capabilities: template.capabilities.join(", "),
                      },
                      `${template.name} added to your roles.`,
                    )
                  }
                  className="btn btn-secondary btn-sm mt-3 justify-center"
                >
                  {adopted ? (
                    <CheckCircle2 className="size-3.5 text-[var(--accent)]" aria-hidden="true" />
                  ) : (
                    <Plus className="size-3.5" aria-hidden="true" />
                  )}
                  {adopted ? "Already added" : "Use this role"}
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      {draft ? (
        <Card className="p-5 sm:p-6">
          <h2 className="text-sm font-semibold text-white">
            {draft.roleId ? "Edit role" : "Create a role"}
          </h2>
          <form
            className="mt-5 grid gap-4 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              saveDraft(draft, `${draft.name.trim()} saved.`);
            }}
          >
            <Field label="Role name" htmlFor="role-name">
              <input
                id="role-name"
                value={draft.name}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    name: event.target.value,
                    slug: draft.roleId ? draft.slug : slugify(event.target.value),
                  })
                }
                required
                maxLength={80}
                className="input"
              />
            </Field>
            <Field label="Slug" htmlFor="role-slug">
              <input
                id="role-slug"
                value={draft.slug}
                onChange={(event) => setDraft({ ...draft, slug: slugify(event.target.value) })}
                required
                maxLength={63}
                className="input font-mono"
              />
            </Field>
            <Field label="Summary" htmlFor="role-summary" className="md:col-span-2">
              <input
                id="role-summary"
                value={draft.summary}
                onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
                required
                maxLength={240}
                className="input"
              />
            </Field>
            <Field
              label="Instructions"
              htmlFor="role-instructions"
              className="md:col-span-2"
              hint="What this bot should do, and what it must not do."
            >
              <textarea
                id="role-instructions"
                value={draft.instructions}
                onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
                required
                maxLength={8000}
                rows={6}
                className="input h-auto py-2.5"
              />
            </Field>
            <Field label="Risk ceiling" htmlFor="role-risk">
              <select
                id="role-risk"
                value={draft.riskCeiling}
                onChange={(event) =>
                  setDraft({ ...draft, riskCeiling: event.target.value as RiskLevel })
                }
                className="input"
              >
                {RISK_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Capabilities"
              htmlFor="role-capabilities"
              hint="Comma separated, up to twelve labels."
            >
              <input
                id="role-capabilities"
                value={draft.capabilities}
                onChange={(event) => setDraft({ ...draft, capabilities: event.target.value })}
                maxLength={400}
                className="input"
              />
            </Field>
            <div className="flex justify-end gap-2 md:col-span-2">
              <button type="button" onClick={() => setDraft(null)} className="btn btn-secondary btn-sm">
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyKey === "role-save" || !draft.name.trim()}
                className="btn btn-primary justify-center"
              >
                {busyKey === "role-save" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Wrench className="size-4" aria-hidden="true" />
                )}
                Save role
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      {fabric.roles.length ? (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-white">Your roles</h2>
          <ul className="mt-4 space-y-3">
            {fabric.roles.map((role) => (
              <RoleRow
                key={role.id}
                role={role}
                fabric={fabric}
                busyKey={busyKey}
                mutate={mutate}
                onEdit={() =>
                  setDraft({
                    roleId: role.id,
                    name: role.name,
                    slug: role.slug,
                    summary: role.summary,
                    instructions: role.instructions,
                    riskCeiling: role.riskCeiling,
                    capabilities: role.capabilities.join(", "),
                  })
                }
              />
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function RoleRow({
  role,
  fabric,
  busyKey,
  mutate,
  onEdit,
}: {
  role: SerializedBotRole;
  fabric: BotFabricResponse;
  busyKey: string | null;
  mutate: MutateFn;
  onEdit: () => void;
}) {
  const removeKey = `role-remove:${role.id}`;
  const inUse = fabric.assignments.some((assignment) => assignment.roleId === role.id);

  return (
    <li className="rounded-xl border border-[var(--border)] bg-[var(--surface-inset)] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--text)]">{role.name}</h3>
            <span className="font-mono text-xs text-[var(--text-faint)]">{role.slug}</span>
            <StatusBadge tone={role.riskCeiling === "RED" ? "danger" : "neutral"} dot={false}>
              {role.riskCeiling} ceiling
            </StatusBadge>
          </div>
          <p className="mt-2 text-sm leading-5 text-[var(--text-muted)]">{role.summary}</p>
          {role.capabilities.length ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {role.capabilities.map((capability) => (
                <li
                  key={capability}
                  className="rounded border border-[var(--border)] bg-[var(--surface-raised)] px-1.5 py-0.5 font-mono text-xs text-[var(--text-muted)]"
                >
                  {capability}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={!fabric.canManage}
            onClick={onEdit}
            className="btn btn-secondary btn-sm"
          >
            <Wrench className="size-3.5" aria-hidden="true" />
            Edit
          </button>
          <button
            type="button"
            disabled={!fabric.canManage || inUse || busyKey === removeKey}
            title={inUse ? "Release the bots holding this role first." : undefined}
            onClick={() =>
              void mutate(
                removeKey,
                `/api/bot-roles/${role.id}`,
                { method: "DELETE" },
                `${role.name} removed.`,
              )
            }
            className="btn btn-secondary btn-sm"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}

/* ---------------------------------------------------------------- shared */

function BotIdentity({ bot }: { bot: SerializedBot }) {
  const provider = findBotProvider(bot.provider);

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="grid size-6 shrink-0 place-items-center rounded border border-[var(--border)] font-mono text-xs font-bold"
          style={{ color: provider?.accent ?? "var(--text-muted)" }}
          aria-hidden="true"
        >
          {provider?.monogram ?? "??"}
        </span>
        <h3 className="truncate text-sm font-semibold text-white">{bot.name}</h3>
        <StatusBadge tone={bot.readinessTone}>{bot.readinessLabel}</StatusBadge>
      </div>
      <p className="mt-1.5 truncate font-mono text-xs text-[var(--text-faint)]">
        {bot.providerLabel} · {bot.model}
      </p>
      {bot.credentialRef ? (
        <p className="mt-1 flex items-center gap-1.5 font-mono text-xs text-[var(--text-faint)]">
          <KeyRound className="size-3" aria-hidden="true" />
          {bot.credentialRef}
          {bot.credentialPresent ? " · set" : " · not set"}
        </p>
      ) : null}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
  className = "",
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-2 block text-sm font-semibold text-[var(--text-muted)]">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1.5 text-xs leading-4 text-[var(--text-faint)]">{hint}</p> : null}
    </div>
  );
}

function Metric({
  label,
  value,
  mono,
  tone = "neutral",
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "neutral" | "safe" | "warning";
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
      <dt className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--text-faint)]">{label}</dt>
      <dd
        className={cn(
          "mt-2 truncate text-xs font-semibold",
          mono && "font-mono",
          tone === "safe" ? "text-[var(--accent)]" : tone === "warning" ? "text-[var(--warning)]" : "text-[var(--text)]",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function EmptyPrompt({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  actionHref,
}: {
  icon: typeof Bot;
  title: string;
  description: string;
  actionLabel: string;
  onAction?: () => void;
  actionHref?: string;
}) {
  return (
    <Card className="grid min-h-64 place-items-center p-6 text-center">
      <div className="max-w-md">
        <Icon className="mx-auto size-7 text-[var(--accent)]" aria-hidden="true" />
        <h2 className="mt-4 text-base font-semibold text-white">{title}</h2>
        <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">{description}</p>
        {actionHref ? (
          <Link href={actionHref} className="btn btn-primary mt-4 justify-center">
            {actionLabel}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        ) : (
          <button type="button" onClick={onAction} className="btn btn-primary mt-4 justify-center">
            {actionLabel}
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </Card>
  );
}

function FabricNotice({
  title,
  description,
  href,
  label,
}: {
  title: string;
  description: string;
  href: string;
  label: string;
}) {
  return (
    <Card className="grid min-h-64 place-items-center p-6 text-center">
      <div className="max-w-md">
        <Bot className="mx-auto size-7 text-[var(--accent)]" aria-hidden="true" />
        <h2 className="mt-4 text-base font-semibold text-white">{title}</h2>
        <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">{description}</p>
        <Link href={href} className="btn btn-primary mt-4 justify-center">
          {label}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </Card>
  );
}
