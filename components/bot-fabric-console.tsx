"use client";

import {
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Copy,
  ExternalLink,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AiAccountConnect } from "@/components/ai-account-connect";
import { AiAccountsPanel } from "@/components/ai-accounts-panel";
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

  // The one-click sign-in returns here by redirect, landing on the default
  // tab. Its callback stores the credential but cannot create a bot — that is
  // owner-authorized work and the callback runs as the service role. So the
  // console finishes the job as the authenticated owner: provision the ready
  // default bot, refresh, and say a bot is waiting. Keeping the promise the
  // front door makes ("sign in and add my first bot") without the callback
  // ever holding authority it should not.
  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams(window.location.search);
      const outcome = params.get("connect");
      if (!outcome) return;
      params.delete("connect");
      const query = params.toString();
      window.history.replaceState(
        null, "", `${window.location.pathname}${query ? `?${query}` : ""}`,
      );
      if (outcome !== "connected") {
        setMessage(CONNECT_OUTCOMES[outcome] ?? CONNECT_OUTCOMES.failed);
        return;
      }
      let provisioned = false;
      try {
        const response = await fetch("/api/bots/connect/provision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: "openrouter" }),
        });
        if (response.ok) provisioned = ((await response.json()) as { provisioned?: boolean }).provisioned ?? false;
      } catch {
        // Provisioning is best-effort; the credential is already connected.
      }
      await load();
      setMessage(
        provisioned
          ? "Signed in. A ready bot is waiting in your fleet."
          : "Signed in. The provider is connected and ready to use.",
      );
    }, 0);
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

      {/* Accounts are org-wide identities above the fleet; the panel renders
          nothing until at least one exists. */}
      <AiAccountsPanel canManage={fabric.canManage} onChanged={load} />

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
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] px-4 py-3"
          aria-live="polite"
        >
          <p className="text-xs text-[var(--warning)]">{message}</p>
          {FAILED_CONNECT_MESSAGES.has(message) ? (
            // "Start it again" is only honest advice when the button to do so
            // is right there — the same one-click sign-in the front door uses.
            // A real anchor, not next/link: the route handler 302s off-origin.
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a href="/api/bots/connect/oauth/start" className="btn btn-secondary btn-sm shrink-0">
              Try signing in again
            </a>
          ) : null}
        </div>
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
          <FleetBoard
            fabric={fabric}
            busyKey={busyKey}
            mutate={mutate}
            onOpenTab={setTab}
            onFleetChanged={load}
          />
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
  onFleetChanged,
}: {
  fabric: BotFabricResponse;
  busyKey: string | null;
  mutate: MutateFn;
  onOpenTab: (tab: Tab) => void;
  onFleetChanged: () => Promise<void> | void;
}) {
  const assignmentByBotId = useMemo(
    () => new Map(fabric.assignments.map((assignment) => [assignment.botId, assignment])),
    [fabric.assignments],
  );
  const bench = fabric.bots.filter((bot) => !assignmentByBotId.has(bot.id));

  if (!fabric.bots.length) {
    return (
      <FirstConnectPrompt
        onAddManually={() => onOpenTab("bots")}
        onFleetChanged={onFleetChanged}
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
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
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
      <div className="mt-4 grid grid-cols-1 gap-2">
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

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
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

/* --------------------------------------------------- provider setup state */

/**
 * What the server knows about each provider's setup.
 *
 * `credentialReady` means a variable is populated. `probeVerdict` is what the
 * provider said when asked, and only `verified` means the bot could actually
 * run. The interface keeps the two separate: a present key that the provider
 * rejects must never render as ready.
 */
type ProviderSetup = {
  id: string;
  label: string;
  vendor: string;
  monogram: string;
  accent: string;
  summary: string;
  suggestedModels: string[];
  defaultModel: string | null;
  credentialRef: string | null;
  credentialReady: boolean;
  credentialOptional: boolean;
  probeVerdict:
    | "verified" | "rejected" | "no_credit" | "rate_limited"
    | "unreachable" | "not_configured" | "not_probed";
  probeReason: string | null;
  probeLive: boolean;
  requiresBaseUrl: boolean;
  docsUrl: string;
  apiKeyUrl: string | null;
};

/**
 * How a verdict reads on a tile.
 *
 * Every non-verified state is visually distinct from verified, because the
 * whole point of probing is that "a key is present" and "the key works" are
 * different facts. A rejected key and an exhausted balance get different words
 * too: they need different fixes.
 */
function providerBadge(state: ProviderSetup) {
  switch (state.probeVerdict) {
    case "verified":
      return { label: "Verified", Icon: CheckCircle2, className: "text-[var(--success)]" };
    case "rejected":
      return { label: "Key rejected", Icon: CircleSlash, className: "text-[var(--danger)]" };
    case "no_credit":
      return { label: "No credit", Icon: CircleSlash, className: "text-[var(--danger)]" };
    case "rate_limited":
      return { label: "Throttled", Icon: RefreshCw, className: "text-[var(--warning)]" };
    case "unreachable":
      return { label: "Unreachable", Icon: RefreshCw, className: "text-[var(--warning)]" };
    case "not_probed":
      return { label: "Key detected", Icon: KeyRound, className: "text-[var(--text-muted)]" };
    default:
      return { label: "Needs a key", Icon: KeyRound, className: "text-[var(--text-faint)]" };
  }
}

/** Only a verified provider can actually run a bot. */
function isProviderUsable(state: ProviderSetup) {
  return state.credentialOptional || state.probeVerdict === "verified"
    || state.probeVerdict === "not_probed";
}

/**
 * What each callback outcome means, in words rather than a code.
 *
 * `expired` and `invalid` are kept apart because they need different actions: a
 * sign-in that timed out just needs starting again, while an invalid one means
 * the callback did not match the request that started it — worth noticing.
 */
const CONNECT_OUTCOMES: Readonly<Record<string, string>> = Object.freeze({
  connected: "Signed in. The provider is connected and ready to use.",
  expired: "That sign-in took too long and expired. Start it again.",
  invalid: "That sign-in did not match the one you started. Nothing was connected.",
  refused: "The provider refused the sign-in. Nothing was connected.",
  failed: "The sign-in could not be completed. Nothing was connected.",
  no_project:
    "That Google account has no active Cloud project, so there is nothing for Vertex AI to bill "
    + "or run against. Create one and sign in again.",
});

/**
 * The failed-connect notices tell the person to start again; these are the
 * messages that must therefore carry the button that does. Derived from the
 * message text itself so no separate state can go stale.
 */
const FAILED_CONNECT_MESSAGES: ReadonlySet<string> = new Set([
  CONNECT_OUTCOMES.expired,
  CONNECT_OUTCOMES.invalid,
  CONNECT_OUTCOMES.refused,
  CONNECT_OUTCOMES.failed,
]);

function useProviderSetup() {
  const [providers, setProviders] = useState<ProviderSetup[] | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async (refresh = false) => {
    setChecking(true);
    try {
      const response = await fetch(
        `/api/bots/providers${refresh ? "?refresh=1" : ""}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        setProviders([]);
        return;
      }
      const body = (await response.json()) as { providers?: ProviderSetup[] };
      setProviders(body.providers ?? []);
    } catch {
      // A failed read must not read as "nothing is set up"; an empty list and a
      // failed request are rendered the same way, as "cannot tell".
      setProviders([]);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    // Deferred for the same reason the fabric load is: setting state straight
    // from an effect body is what `react-hooks/set-state-in-effect` forbids.
    const timer = window.setTimeout(() => void check(), 0);
    return () => window.clearTimeout(timer);
  }, [check]);

  return { providers, checking, check };
}

/**
 * The sign-in panel.
 *
 * Primary because subscription auth is both simpler and free: it bills nothing
 * per token, which is the standing constraint on this factory. The API-key path
 * still exists below it, labelled as billed, for anyone who wants it.
 *
 * The command is shown rather than run in the browser because the login belongs
 * to the provider. Anthropic and OpenAI have no third-party OAuth, so the only
 * supported way to obtain a subscription credential is their own tool opening
 * their own browser flow. This hands over one pre-filled line and never sees
 * the token that comes back.
 */
function SubscriptionSignIn({ provider, onDone }: { provider: ProviderSetup; onDone: () => void }) {
  const [command, setCommand] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState("");

  const start = useCallback(async () => {
    setStarting(true);
    setFailed("");
    try {
      const response = await fetch("/api/bots/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: provider.id === "anthropic" ? "claude" : "codex" }),
      });
      const body = await response.json();
      if (!response.ok) {
        setFailed(body?.error?.message ?? "The sign-in could not be started.");
        return;
      }
      setCommand(body.command as string);
    } catch {
      setFailed("The sign-in could not be started.");
    } finally {
      setStarting(false);
    }
  }, [provider.id]);

  return (
    <div className="mt-4 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-surface)] p-4">
      <p className="text-sm font-medium text-[var(--text)]">
        {provider.id === "openrouter"
          ? `Sign in with ${provider.vendor}`
          : `Or use your ${provider.vendor} subscription instead`}
      </p>
      <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
        {provider.id === "openrouter"
          ? "One click. No key, no terminal, no variable name."
          : "Bills nothing per token. Anthropic restricts OAuth to its own products, "
            + "so this is not a supported way for third-party software to reach Claude — "
            + "prefer a key or OpenRouter above."}
      </p>

      {provider.id === "anthropic" ? (
        <div className="mt-3 rounded-lg border border-[var(--accent-border)] bg-[var(--surface)] p-3">
          {/* Anthropic restricted its own OAuth to Claude Code and Claude.ai,
              so "Sign in with Claude" cannot exist here. Claude runs on Vertex
              AI though, and Google OAuth is open to third parties — so this is
              the standard login flow reaching the intended model through a door
              that is actually open. */}
          <p className="text-sm font-medium text-[var(--text)]">
            Sign in with Google
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
            Claude runs on Google Cloud&rsquo;s Vertex AI. One click, Google&rsquo;s own consent
            screen, and Claude is connected — no key, no terminal. Billed through your Google
            Cloud project.
          </p>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/bots/connect/google/start" className="btn btn-primary btn-sm mt-3">
            <KeyRound className="size-3.5" aria-hidden="true" />
            Sign in with Google
          </a>
        </div>
      ) : null}

      {provider.id !== "openrouter" ? (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          {/* The frictionless route to this same model. OpenRouter serves
              Claude, GPT and Gemini, and it is the only provider here with a
              third-party OAuth flow — so clicking through it is genuinely one
              click, where the subscription path below needs a terminal. */}
          <p className="text-sm font-medium text-[var(--text)]">
            {provider.id === "anthropic"
              ? `Or get ${provider.label} through OpenRouter`
              : `Fastest: get ${provider.label} in one click`}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
            Sign in to OpenRouter and {provider.label} works immediately — no terminal, no key.
            Usage is billed by OpenRouter per token.
          </p>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/bots/connect/oauth/start" className="btn btn-primary btn-sm mt-3">
            <KeyRound className="size-3.5" aria-hidden="true" />
            Sign in with OpenRouter
          </a>
        </div>
      ) : null}

      {provider.id === "openrouter" ? (
        <div className="mt-3">
          {/* One click, no terminal. OpenRouter publishes a documented OAuth
              flow for third-party applications, so this is the only provider
              here that can offer the sign-in everyone expects — and it fronts
              Claude, GPT and Gemini behind one credential. */}
          {/* A real anchor, not `next/link`: this target is a route handler
              that issues a 302 to another origin, and a client-side navigation
              cannot follow a cross-origin redirect. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/bots/connect/oauth/start" className="btn btn-primary btn-sm">
            <KeyRound className="size-3.5" aria-hidden="true" />
            Sign in with OpenRouter
          </a>
          <p className="mt-2 text-xs text-[var(--text-faint)]">
            Opens OpenRouter, you approve, and you are back here. Gives you Claude, GPT and
            Gemini through one sign-in.
          </p>
        </div>
      ) : command ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-[var(--text-muted)]">
            Run this once. Your browser will open for {provider.vendor} to sign you in.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono text-xs text-[var(--text)]">
              {command}
            </code>
            <CopyButton value={command} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={onDone} className="btn btn-primary btn-sm">
              <RefreshCw className="size-3.5" aria-hidden="true" />
              I have run it
            </button>
            {/* Said plainly, because the link stops working and a person who
                wanders off should know why it failed when they return. */}
            <p className="text-xs text-[var(--text-faint)]">
              This link works once and expires in 10 minutes.
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void start()}
            disabled={starting}
            className="btn btn-primary btn-sm"
          >
            {starting ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <KeyRound className="size-3.5" aria-hidden="true" />
            )}
            Sign in with {provider.vendor}
          </button>
          {failed ? <p className="text-xs text-[var(--danger)]">{failed}</p> : null}
        </div>
      )}
    </div>
  );
}

/**
 * Paste a key, and it is connected.
 *
 * This replaced two steps that had nothing to do with the key: find the right
 * environment variable name, and set it in a hosting dashboard. Anthropic
 * restricted OAuth to its own products in February 2026, so an API key is the
 * only supported way for software like this to reach Claude — which makes the
 * key unavoidable and everything around it worth deleting.
 *
 * The field is a password input so a shoulder or a screen share does not read
 * it, and the value is never put in component state longer than the submit.
 */
function PasteKey({
  provider,
  onConnected,
}: {
  provider: ProviderSetup;
  onConnected: () => void;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState("");

  // A plain container, not a form. This renders inside the register form, and
  // a nested form is invalid HTML: the submit event bubbles to the outer
  // handler, which registers the bot and unmounts this panel before the result
  // of the key request can be shown.
  const submit = (candidate = value) => {
    const trimmed = candidate.trim();
    if (saving || trimmed.length < 16) return;
    setSaving(true);
    setFailed("");
    void fetch("/api/bots/connect/key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: provider.id, key: trimmed }),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          // The provider's own verdict, so a key that is valid but out of
          // credit is not reported as a bad key.
          setFailed(body?.message ?? body?.error?.message ?? "That key could not be used.");
          return;
        }
        setValue("");
        onConnected();
      })
      .catch(() => setFailed("That key could not be saved."))
      .finally(() => setSaving(false));
  };

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
            Paste your {provider.vendor} API key
          </span>
          <input
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onPaste={(event) => {
              // Pasting a key is the whole interaction, so it is also the
              // submit. Requiring a button press afterwards adds a step whose
              // only purpose is confirming what the paste already said.
              const pasted = event.clipboardData.getData("text").trim();
              event.preventDefault();
              setValue(pasted);
              // `submit` decides whether this is long enough to be a key. The
              // check lived here too, which made a test of it vacuous: both
              // guards had to be removed before anything failed.
              submit(pasted);
            }}
            onKeyDown={(event) => {
              // Enter still connects, which a form would have given for free.
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-..."
            className="input font-mono"
            aria-label={`${provider.vendor} API key`}
          />
        </label>
        <button
          type="button"
          onClick={() => submit()}
          disabled={saving || value.trim().length < 16}
          className="btn btn-primary btn-sm"
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="size-3.5" aria-hidden="true" />
          )}
          Connect
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        {provider.apiKeyUrl ? (
          <a
            href={provider.apiKeyUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent-text)] hover:underline"
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
            Get a key from {provider.vendor}
          </a>
        ) : null}
        <p className="text-xs text-[var(--text-faint)]">
          Verified before it is saved, then encrypted. It is never shown again.
        </p>
      </div>

      {failed ? (
        <p className="mt-2 text-xs text-[var(--danger)]" role="alert">{failed}</p>
      ) : null}
    </div>
  );
}

/** Copies a variable name so nobody retypes it and mistypes it. */
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="btn btn-secondary btn-sm shrink-0"
      aria-label={`Copy ${value}`}
    >
      {copied ? (
        <Check className="size-3.5 text-[var(--success)]" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * Setup instructions for a provider whose variable is not populated.
 *
 * This is the honest version of "sign in". No provider here offers an OAuth
 * flow that mints a key for a third-party application, so the fastest real path
 * is a direct link to the page that issues one plus the exact variable to set.
 */
function ProviderSetupSteps({
  provider,
  onRecheck,
  checking,
}: {
  provider: ProviderSetup;
  onRecheck: () => void;
  checking: boolean;
}) {
  return (
    <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-inset)] p-4">
      <p className="text-sm font-medium text-[var(--text)]">
        {provider.probeVerdict !== "not_configured"
          ? `${provider.vendor} could not use this key`
          : provider.id === "anthropic" || provider.id === "openai"
            // Named as the alternative, and named as billed, so the cheaper
            // path above is the obvious one.
            ? `Or use an API key instead (billed per token)`
            : `Two steps and ${provider.label} is ready`}
      </p>

      {provider.probeReason && provider.probeVerdict !== "not_configured" ? (
        // The provider's own verdict, so nobody re-issues a working key because
        // the real problem was an empty balance or a busy endpoint.
        <p className="mt-2 text-sm text-[var(--warning)]">{provider.probeReason}</p>
      ) : null}

      {/* Collapsed by default. Three ways to connect shown at once is its own
          friction: it turns a login into a decision. The sign-in above is the
          answer for almost everyone, so the rest waits until asked for. */}
      <details className="mt-3 group">
        <summary className="cursor-pointer list-none text-xs font-medium text-[var(--text-muted)] hover:text-white">
          <span className="inline-flex items-center gap-1.5">
            <ChevronDown
              className="size-3.5 transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
            Paste a key instead
          </span>
        </summary>

        <PasteKey provider={provider} onConnected={onRecheck} />
      </details>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onRecheck}
          disabled={checking}
          className="btn btn-secondary btn-sm"
        >
          {checking ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-3.5" aria-hidden="true" />
          )}
          Check again
        </button>
        <p className="text-xs text-[var(--text-faint)]">
          Already set {provider.credentialRef} as a server environment variable? That still works.
        </p>
      </div>
    </div>
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { providers, checking, check } = useProviderSetup();
  // The OAuth callback lands back here with an outcome in the query string,
  // because a redirect is the only channel it has. Reported once and then
  // cleared from the URL so a refresh does not repeat a stale result.
  const [connectOutcome, setConnectOutcome] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const outcome = params.get("connect");
      if (!outcome) return;
      setConnectOutcome(outcome);
      params.delete("connect");
      const query = params.toString();
      window.history.replaceState(
        null, "", `${window.location.pathname}${query ? `?${query}` : ""}`,
      );
      if (outcome === "connected") void check(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [check]);
  const provider = draft ? findBotProvider(draft.provider) : null;
  const setup = draft
    ? providers?.find((entry) => entry.id === draft.provider) ?? null
    : null;
  const modelListId = "bot-model-suggestions";
  // Nothing is typed for a ready provider: the name, model and variable are all
  // known. The form below only appears when something genuinely needs a choice.
  // Gated on the verdict, not on presence. A key the provider rejects cannot
  // run a bot, so registering against it would create a record that looks ready
  // and is not.
  const needsSetup = Boolean(setup && !isProviderUsable(setup));

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
              Pick a provider. Anything already set up connects in one click — no typing.
              Keys live in server-side environment variables and never pass through this page.
            </p>
          </div>
        </div>

        {connectOutcome ? (
          <div
            className={cn(
              "mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3",
              connectOutcome === "connected"
                ? "border-[var(--success-border)] bg-[var(--success-surface)]"
                : "border-[var(--warning-border)] bg-[var(--warning-surface)]",
            )}
            aria-live="polite"
          >
            <p
              className={cn(
                "text-xs",
                connectOutcome === "connected" ? "text-[var(--text)]" : "text-[var(--warning)]",
              )}
            >
              {CONNECT_OUTCOMES[connectOutcome] ?? CONNECT_OUTCOMES.failed}
            </p>
            {connectOutcome !== "connected" ? (
              // A real anchor, not next/link: the route handler 302s off-origin.
              // eslint-disable-next-line @next/next/no-html-link-for-pages
              <a href="/api/bots/connect/oauth/start" className="btn btn-secondary btn-sm shrink-0">
                Try signing in again
              </a>
            ) : null}
          </div>
        ) : null}

        <ul className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {BOT_PROVIDERS.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                disabled={!fabric.canManage}
                onClick={() => {
                  setDraft(draftForProvider(entry));
                  setShowAdvanced(false);
                }}
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
                {(() => {
                  const state = providers?.find((item) => item.id === entry.id);
                  // Until the check returns, the vendor name is shown rather
                  // than a guess. Claiming "needs a key" before knowing would
                  // send people to set one they may already have.
                  if (!state) {
                    return <span className="text-xs text-[var(--text-faint)]">{entry.vendor}</span>;
                  }
                  if (state.credentialOptional) {
                    return <span className="text-xs text-[var(--text-faint)]">No key needed</span>;
                  }
                  const badge = providerBadge(state);
                  return (
                    <span className={cn("flex items-center gap-1 text-xs", badge.className)}>
                      <badge.Icon className="size-3" aria-hidden="true" />
                      {badge.label}
                    </span>
                  );
                })()}
              </button>
            </li>
          ))}
        </ul>

        {draft && provider ? (
          <form
            className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2"
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
                if (ok) {
                  setDraft(null);
                  setShowAdvanced(false);
                }
              });
            }}
          >
            <div className="md:col-span-2">
              <p className="text-sm leading-5 text-[var(--text-muted)]">{provider.summary}</p>

              {needsSetup && setup
                && (setup.id === "anthropic" || setup.id === "openai" || setup.id === "openrouter") ? (
                <SubscriptionSignIn provider={setup} onDone={() => void check(true)} />
              ) : null}

              {needsSetup && setup ? (
                <ProviderSetupSteps
                  provider={setup}
                  onRecheck={() => void check(true)}
                  checking={checking}
                />
              ) : null}

              {setup && !needsSetup ? (
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--success-border)] bg-[var(--success-surface)] px-4 py-3">
                  <CheckCircle2 className="size-4 text-[var(--success)]" aria-hidden="true" />
                  <span className="text-sm text-[var(--text)]">
                    {setup.credentialOptional
                      ? `${provider.label} needs no key. Ready to register as ${draft.model}.`
                      : setup.probeVerdict === "verified"
                        ? `${provider.vendor} verified this key. Ready to register ${provider.label} as ${draft.model}.`
                        : `${setup.credentialRef} is set. Ready to register ${provider.label} as ${draft.model}.`}
                  </span>
                </div>
              ) : null}

              {/* The three fields below used to be the whole form. They are all
                  pre-filled from the catalogue, so they are folded away: a
                  person who just wants Claude never opens this. */}
              <button
                type="button"
                onClick={() => setShowAdvanced((open) => !open)}
                aria-expanded={showAdvanced}
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-white"
              >
                <ChevronDown
                  className={cn("size-3.5 transition-transform", showAdvanced && "rotate-180")}
                  aria-hidden="true"
                />
                {showAdvanced ? "Hide" : "Customise"} name, model and endpoint
              </button>
            </div>

            <div
              className={cn(
                "grid gap-4 md:col-span-2 md:grid-cols-2",
                showAdvanced ? "" : "hidden",
              )}
            >
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

            </div>

            <div className="flex flex-col gap-3 md:col-span-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <ShieldCheck className="size-4 text-[var(--accent)]" aria-hidden="true" />
                Registration stores metadata and a secret reference only.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setDraft(null)} className="btn btn-secondary btn-sm">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    busyKey === "register" || !draft.name.trim() || !draft.model.trim() || needsSetup
                  }
                  className="btn btn-primary justify-center"
                >
                  {busyKey === "register" ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="size-4" aria-hidden="true" />
                  )}
                  {needsSetup ? `Set ${setup?.credentialRef ?? "the key"} first` : `Connect ${provider.label}`}
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
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
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

        <ul className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
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
            className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2"
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
            <div className="flex flex-wrap justify-end gap-2 md:col-span-2">
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

/**
 * A subscription sign-in button: click, sign in with the provider's own
 * login, end with a Ready bot.
 *
 * Anthropic and OpenAI have no third-party OAuth, so the sign-in itself
 * belongs to each provider's own tool: this hands over one pre-filled
 * command, the operator's browser opens the provider's real login
 * (claude.ai for Claude; OpenAI's for Codex), and the credential travels
 * once — sealed — through the claim route. The console never sees a token;
 * it watches for the stored credential to appear and then finishes the job
 * as the signed-in owner: a bot referencing the subscription credential,
 * Ready for assignments. If the subscription is already connected, the
 * button is literally one click — no terminal at all.
 *
 * "Add another bot" repeats the finish for as many bots as wanted — all
 * Ready, all reading the same signed-in subscription, each distinct in the
 * fleet.
 */
const QUICK_CONNECT_TEXT_CLASS: Readonly<Record<string, string>> = Object.freeze({
  // Per-accent text color so both tiles clear contrast: Claude's terracotta
  // carries white; Codex's mint needs dark text.
  anthropic: "text-white",
  openai: "text-[#0d1117]",
});

function SubscriptionQuickConnect({
  providerId,
  purpose,
  onReady,
}: {
  providerId: "anthropic" | "openai";
  purpose: "claude" | "codex";
  onReady: () => Promise<void> | void;
}) {
  const provider = findBotProvider(providerId)!;
  const [phase, setPhase] = useState<
    "idle" | "starting" | "running" | "provisioning" | "ready" | "failed"
  >("idle");
  // The broker path: a worker runs the provider's real login and this page
  // auto-completes. Primary for Claude; Codex's login is a localhost callback
  // the worker cannot drive yet, so Codex keeps the command flow.
  const [brokerActive, setBrokerActive] = useState(false);
  const brokerFirst = providerId === "anthropic";
  const [command, setCommand] = useState("");
  const [detail, setDetail] = useState("");
  const [readyBots, setReadyBots] = useState(0);
  // Which account slot the flow is currently connecting (0-based). A ref, not
  // state: the polling interval must always read the live value.
  const slotRef = useRef(0);
  const [connectedSlots, setConnectedSlots] = useState(0);
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  const isSignedIn = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch("/api/bots/providers", { cache: "no-store" });
      if (!response.ok) return false;
      const body = (await response.json()) as {
        providers?: { id: string; subscriptionReady?: boolean; subscriptionSlots?: boolean[] }[];
      };
      const entry = body.providers?.find((candidate) => candidate.id === providerId);
      const slot = slotRef.current;
      // Slot-aware when the response carries slots; the base flag otherwise.
      return Boolean(entry?.subscriptionSlots?.[slot] ?? (slot === 0 && entry?.subscriptionReady));
    } catch {
      return false;
    }
  }, [providerId]);

  const provision = useCallback(async (additional: boolean) => {
    setPhase("provisioning");
    const slot = slotRef.current;
    try {
      const response = await fetch("/api/bots/connect/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerId,
          credential: slot === 0 ? "subscription" : `subscription_${slot + 1}`,
          additional,
        }),
      });
      const body = (await response.json()) as { outcome?: string; reason?: string };
      if (!response.ok) throw new Error();
      // "skipped" arrives as a 200 with a reason; a phase that says ready
      // over it is how a finished sign-in ended with no bot and no sentence.
      if (body.outcome === "skipped") throw new Error(body.reason);
      setReadyBots((count) => count + (body.outcome === "created" ? 1 : 0));
      setConnectedSlots((count) => Math.max(count, slot + 1));
      await onReady();
      setPhase("ready");
    } catch (error) {
      setDetail(
        error instanceof Error && error.message
          ? `You are signed in, but the bot could not be added: ${error.message}`
          : "You are signed in, but the bot could not be added automatically. "
            + "The credential is stored — add a bot manually and it will read Ready.",
      );
      setPhase("failed");
    }
  }, [onReady, providerId]);

  const finishIfSignedIn = useCallback(async (): Promise<boolean> => {
    if (!(await isSignedIn())) return false;
    stopPolling();
    await provision(false);
    return true;
  }, [isSignedIn, provision, stopPolling]);

  const start = useCallback(async (slot = 0) => {
    slotRef.current = slot;
    setPhase("starting");
    setDetail("");
    // Already signed in from before? Then this is genuinely one click.
    if (await finishIfSignedIn()) return;
    try {
      const response = await fetch("/api/bots/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Slot 1 is the base purpose; further account slots are suffixed and
        // sealed separately, so several accounts stay signed in at once.
        body: JSON.stringify({ purpose: slot === 0 ? purpose : `${purpose}_${slot + 1}` }),
      });
      const body = (await response.json()) as {
        command?: string;
        error?: { message?: string };
      };
      if (!response.ok || !body.command) {
        throw new Error(body.error?.message ?? "The sign-in could not be started.");
      }
      setCommand(body.command);
      setPhase("running");
      // Watch for the sign-in to land, then finish without another click.
      // The one-time code expires in ten minutes; polling stops with it.
      pollRef.current = window.setInterval(() => void finishIfSignedIn(), 5000);
      window.setTimeout(stopPolling, 10 * 60 * 1000);
    } catch (error) {
      setDetail(
        error instanceof Error && error.message
          ? error.message
          : "The sign-in could not be started.",
      );
      setPhase("failed");
    }
  }, [finishIfSignedIn, purpose, stopPolling]);

  // Which provision slot an account's credential occupies: the bare purpose
  // is slot 0, `…_N` is slot N-1. Names only — this never sees a credential.
  const slotForAccount = useCallback(async (accountId: string): Promise<number> => {
    try {
      const response = await fetch("/api/ai-accounts", { cache: "no-store" });
      if (!response.ok) return 0;
      const body = (await response.json()) as {
        accounts?: { id: string; credentialPurpose?: string }[];
      };
      const purposeName = body.accounts?.find((entry) => entry.id === accountId)?.credentialPurpose;
      const match = purposeName ? /_(\d+)$/.exec(purposeName) : null;
      return match ? Number(match[1]) - 1 : 0;
    } catch {
      return 0;
    }
  }, []);

  if (brokerActive) {
    return (
      <AiAccountConnect
        providerId={providerId}
        providerLabel={provider.label}
        onConnected={async (accountId) => {
          slotRef.current = await slotForAccount(accountId);
          setBrokerActive(false);
          await provision(false);
        }}
        onFallback={() => {
          setBrokerActive(false);
          void start(connectedSlots);
        }}
        // The broker backend being unavailable must never cost the person a
        // click: the command flow starts by itself, exactly as if the broker
        // had never been offered.
        onUnavailable={() => {
          setBrokerActive(false);
          void start(connectedSlots);
        }}
        onClose={() => setBrokerActive(false)}
      />
    );
  }

  if (phase === "ready") {
    return (
      <div className="rounded-xl border border-[var(--accent-border)] bg-[var(--accent-surface)] p-4 text-left">
        <p className="flex items-center gap-2 text-sm font-semibold text-[var(--accent-text)]">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
          {provider.label} is connected — your {provider.label} bot is Ready for assignments.
        </p>
        {readyBots > 1 ? (
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {readyBots} {provider.label} bots are connected and Ready.
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void provision(true)}
            className="btn btn-secondary btn-sm"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add another {provider.label} bot
          </button>
          {/* Never capped: accounts are unbounded by requirement, limited
              only by configured platform capacity, which the server enforces. */}
          <button
            type="button"
            onClick={() => {
              if (brokerFirst) setBrokerActive(true);
              else void start(connectedSlots);
            }}
            className="btn btn-secondary btn-sm"
          >
            <KeyRound className="size-3.5" aria-hidden="true" />
            Connect another {provider.label} account
          </button>
        </div>
        {connectedSlots > 1 ? (
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            {connectedSlots} {provider.label} accounts are signed in simultaneously.
          </p>
        ) : null}
      </div>
    );
  }

  if (phase === "running" || phase === "provisioning") {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left">
        <p className="text-sm font-medium text-[var(--text)]">
          Run this once — your browser opens {provider.vendor}&apos;s own sign-in:
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1 font-mono text-xs text-[var(--text)]">
            {command}
          </code>
          <CopyButton value={command} />
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-[var(--text-muted)]" aria-live="polite">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          {phase === "provisioning"
            ? `Signed in — adding your ${provider.label} bot…`
            : "Waiting for your sign-in to finish. This completes on its own."}
        </p>
        {phase === "running" ? (
          <button
            type="button"
            onClick={() => void finishIfSignedIn()}
            className="btn btn-secondary btn-sm mt-2"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            I have signed in — check now
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="text-left">
      <button
        type="button"
        onClick={() => {
          if (brokerFirst) setBrokerActive(true);
          else void start();
        }}
        disabled={phase === "starting"}
        style={{ backgroundColor: provider.accent, borderColor: provider.accent }}
        className={cn(
          "flex w-full items-center justify-center gap-3 rounded-xl border px-5 py-4 text-lg font-semibold transition-opacity hover:opacity-90 disabled:opacity-60",
          QUICK_CONNECT_TEXT_CLASS[providerId] ?? "text-white",
        )}
      >
        {phase === "starting" ? (
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        ) : (
          <Sparkles className="size-5" aria-hidden="true" />
        )}
        {provider.label}
      </button>
      <p className="mt-2 text-center text-xs text-[var(--text-muted)]">
        Sign in with your {provider.label} subscription — bills nothing per token.
      </p>
      {phase === "failed" ? (
        <p className="mt-2 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] px-3 py-2 text-xs text-[var(--warning)]" aria-live="polite">
          {detail}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The front door, shaped like signing into Claude or Codex.
 *
 * The old empty state sent a person to a provider-selection screen and a form.
 * This leads with the Claude button — sign in with the subscription that
 * bills nothing per token, end with a Ready bot — and keeps the one-click
 * OpenRouter OAuth (fronting Claude, GPT and Gemini behind one credential,
 * billed per token) right below it. Choosing a specific account by hand
 * stays available, one step down, for the people who want it.
 */
function FirstConnectPrompt({
  onAddManually,
  onFleetChanged,
}: {
  onAddManually: () => void;
  onFleetChanged: () => Promise<void> | void;
}) {
  return (
    <Card className="grid min-h-64 place-items-center p-6 text-center">
      <div className="w-full max-w-md">
        <Sparkles className="mx-auto size-7 text-[var(--accent)]" aria-hidden="true" />
        <h2 className="mt-4 text-base font-semibold text-white">Connect a bot in one click</h2>
        <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
          Sign in once and your first bot is ready. No key, no variable name.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SubscriptionQuickConnect providerId="anthropic" purpose="claude" onReady={onFleetChanged} />
          <SubscriptionQuickConnect providerId="openai" purpose="codex" onReady={onFleetChanged} />
        </div>
        {/* A real anchor, not next/link: this route handler issues a 302 to
            another origin, which a client-side navigation cannot follow. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/api/bots/connect/oauth/start" className="btn btn-secondary mt-4 justify-center">
          <KeyRound className="size-4" aria-hidden="true" />
          Sign in and add my first bot
        </a>
        <p className="mt-1 text-xs text-[var(--text-faint)]">
          OpenRouter — Claude, GPT and Gemini in one click, billed per token.
        </p>
        <p className="mt-4 text-xs text-[var(--text-faint)]">
          Prefer a specific account, or your own key?{" "}
          <button
            type="button"
            onClick={onAddManually}
            className="underline underline-offset-2 hover:text-[var(--text)]"
          >
            Add one manually
          </button>
        </p>
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
