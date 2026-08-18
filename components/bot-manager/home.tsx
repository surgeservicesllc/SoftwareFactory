"use client";

import { Bot, Check, ChevronDown, Loader2, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AiAccountConnect } from "@/components/ai-account-connect";
import { AiAccountsPanel } from "@/components/ai-accounts-panel";
import { findBotProvider } from "@/lib/bots/catalog";
import { cn } from "@/lib/cn";

/**
 * The Bot Manager home, rebuilt around one product promise: connect Claude
 * or Codex as easily as signing into any modern SaaS application, then
 * create as many specialized bots as needed.
 *
 * The person should understand Claude, Codex, account, bot, task, status —
 * and nothing else. Terminals, workers, brokers, tokens, and variables exist
 * in this codebase, but never on this screen; the page's Developer
 * Diagnostics section (rendered by the page, not here) is where that lives.
 */

type AccountView = {
  id: string;
  provider: string;
  providerLabel: string;
  displayName: string;
  status: string;
  lastError: string | null;
};

type BotView = {
  id: string;
  name: string;
  provider: string;
  providerLabel: string;
  readinessLabel: string;
  readiness: string;
};

type AssignmentView = { id: string };

type RoleView = { id: string; name: string };
type ProjectView = { id: string; name: string };

type FabricPayload = {
  canManage?: boolean;
  bots?: Array<{
    id: string; name: string; provider: string; providerLabel: string;
    readiness: string; readinessLabel: string;
  }>;
  assignments?: AssignmentView[];
  /*
   * Both already arrive in the fabric snapshot and were being discarded here.
   * Assigning a bot needs a project to assign it to and a role to assign it
   * as, and fetching either again from this component would be asking the
   * server for something it had already sent.
   */
  roles?: RoleView[];
  projects?: ProjectView[];
};

const CONNECTABLE = [
  {
    providerId: "anthropic" as const,
    name: "Claude",
    runtime: "Claude Code",
    description: "Use your supported Claude account.",
  },
  {
    providerId: "openai" as const,
    name: "Codex",
    runtime: "OpenAI Codex",
    description: "Use your supported ChatGPT/OpenAI account.",
  },
];

type ConnectStage =
  | { kind: "closed" }
  | { kind: "choose" }
  | { kind: "confirm"; providerId: "anthropic" | "openai" }
  | { kind: "connecting"; providerId: "anthropic" | "openai" }
  | { kind: "connected"; providerId: "anthropic" | "openai"; accountId: string }
  /** Which account should back the new bot — asked, not assumed. */
  | { kind: "create-bot" }
  /** Put one bot on one project, from the roster rather than the project page. */
  | { kind: "assign"; bot: BotView };

export function BotManagerHome() {
  const [accounts, setAccounts] = useState<AccountView[] | null>(null);
  const [bots, setBots] = useState<BotView[]>([]);
  const [assignments, setAssignments] = useState<AssignmentView[]>([]);
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [stage, setStage] = useState<ConnectStage>({ kind: "closed" });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [creatingBot, setCreatingBot] = useState(false);
  const [botNotice, setBotNotice] = useState("");
  // Renaming a bot edits in place; a Ready bot stays Ready through it.
  const [renamingBotId, setRenamingBotId] = useState<string | null>(null);
  const [renameBotName, setRenameBotName] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  // Retiring asks in place first: the row states what is released and what
  // is kept before anything happens.
  const [removingBotId, setRemovingBotId] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [assignBusy, setAssignBusy] = useState(false);
  // The success screen offers the rename before any next action, through the
  // same endpoint the accounts panel uses.
  const [successEditing, setSuccessEditing] = useState(false);
  const [successName, setSuccessName] = useState("");
  const [successRenameBusy, setSuccessRenameBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [accountsResponse, fabricResponse] = await Promise.all([
        fetch("/api/ai-accounts", { cache: "no-store" }),
        fetch("/api/bots", { cache: "no-store" }),
      ]);
      if (accountsResponse.ok) {
        const body = (await accountsResponse.json()) as {
          accounts?: AccountView[]; canManage?: boolean;
        };
        setAccounts(body.accounts ?? []);
        setCanManage(Boolean(body.canManage));
        setSignedOut(false);
      } else {
        setAccounts([]);
        // A signed-out visitor gets the gate, never a disabled empty state
        // pretending they could click; any other failure is named rather
        // than dressed up as an empty organization.
        setSignedOut(accountsResponse.status === 401);
        setUnavailable(accountsResponse.status !== 401);
      }
      if (fabricResponse.ok) {
        const body = (await fabricResponse.json()) as FabricPayload;
        setBots((body.bots ?? []).map((bot) => ({
          id: bot.id,
          name: bot.name,
          provider: bot.provider,
          providerLabel: bot.providerLabel,
          readiness: bot.readiness,
          readinessLabel: bot.readinessLabel,
        })));
        setAssignments(body.assignments ?? []);
        setRoles(body.roles ?? []);
        setProjects(body.projects ?? []);
      }
    } catch {
      setAccounts((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);

  const connectedAccounts = useMemo(
    () => (accounts ?? []).filter((account) => account.status === "connected"),
    [accounts],
  );

  const renameConnectedAccount = useCallback(async (accountId: string, currentName: string) => {
    const name = successName.trim();
    if (name.length === 0 || name === currentName) {
      setSuccessEditing(false);
      return;
    }
    setSuccessRenameBusy(true);
    setBotNotice("");
    try {
      const response = await fetch(`/api/ai-accounts/${accountId}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setBotNotice(body.error?.message ?? "The account could not be renamed.");
        return;
      }
      setSuccessEditing(false);
      await load();
    } catch {
      setBotNotice("The account could not be renamed.");
    } finally {
      setSuccessRenameBusy(false);
    }
  }, [successName, load]);

  const renameBot = useCallback(async (bot: BotView) => {
    const name = renameBotName.trim();
    if (name.length === 0 || name === bot.name) {
      setRenamingBotId(null);
      return;
    }
    setRenameBusy(true);
    setBotNotice("");
    try {
      const response = await fetch(`/api/bots/${bot.id}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setBotNotice(body.error?.message ?? "The bot could not be renamed.");
        return;
      }
      setRenamingBotId(null);
      await load();
    } catch {
      setBotNotice("The bot could not be renamed.");
    } finally {
      setRenameBusy(false);
    }
  }, [renameBotName, load]);

  const removeBot = useCallback(async (bot: BotView) => {
    setRemoveBusy(true);
    setBotNotice("");
    try {
      const response = await fetch(`/api/bots/${bot.id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
        setBotNotice(body.error?.message ?? "The bot could not be removed.");
        return;
      }
      setRemovingBotId(null);
      await load();
    } catch {
      setBotNotice("The bot could not be removed.");
    } finally {
      setRemoveBusy(false);
    }
  }, [load]);

  const assignBotToProject = useCallback(async (
    bot: BotView,
    projectId: string,
    roleId: string,
  ) => {
    setAssignBusy(true);
    setBotNotice("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/bots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bots: [{ botId: bot.id, roleId }] }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      /*
       * The server's own words, not a generic failure. It refuses a bot whose
       * credential has gone missing, a bot already posted to this project, and
       * a caller who is not a manager — three different problems a person can
       * act on differently, and "it did not work" tells them apart from none
       * of them.
       */
      if (!response.ok) throw new Error(body.error?.message ?? "The bot could not be assigned.");
      await load();
      setStage({ kind: "closed" });
      setBotNotice(`${bot.name} is now on ${
        projects.find((project) => project.id === projectId)?.name ?? "the project"
      }.`);
    } catch (error) {
      setBotNotice(error instanceof Error ? error.message : "The bot could not be assigned.");
    } finally {
      setAssignBusy(false);
    }
  }, [load, projects]);

  const provisionBot = useCallback(async (providerId: string) => {
    setCreatingBot(true);
    setBotNotice("");
    try {
      const response = await fetch("/api/bots/connect/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, credential: "subscription", additional: bots.some((bot) => bot.provider === providerId) }),
      });
      if (!response.ok) throw new Error();
      await load();
      setStage({ kind: "closed" });
    } catch {
      setBotNotice("The bot could not be created. Try again from the accounts list.");
    } finally {
      setCreatingBot(false);
    }
  }, [bots, load]);

  // ------------------------------------------------------------------ modal

  function modal(content: React.ReactNode, label: string) {
    return (
      <div
        className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
          {content}
        </div>
      </div>
    );
  }

  const closeButton = (
    <button
      type="button"
      onClick={() => setStage({ kind: "closed" })}
      className="btn btn-secondary btn-sm absolute right-4 top-4"
      aria-label="Close"
    >
      <X className="size-4" aria-hidden="true" />
    </button>
  );

  let dialog: React.ReactNode = null;
  if (stage.kind === "choose") {
    dialog = modal(
      <div className="relative">
        {closeButton}
        <h2 className="text-xl font-semibold text-[var(--text)]">Add AI Account</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Choose the AI provider you want your bots to use.
        </p>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CONNECTABLE.map((entry) => (
            <button
              key={entry.providerId}
              type="button"
              onClick={() => setStage({ kind: "confirm", providerId: entry.providerId })}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 text-left transition-colors hover:border-[var(--accent-border)]"
            >
              <p className="text-base font-semibold text-[var(--text)]">{entry.name}</p>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">{entry.runtime}</p>
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                Connect your {entry.providerId === "anthropic" ? "Claude" : "ChatGPT"} account
              </p>
            </button>
          ))}
        </div>
        <a href="#developer-diagnostics" onClick={() => setStage({ kind: "closed" })} className="mt-4 inline-block text-xs text-[var(--text-muted)] underline">
          Use an API provider instead
        </a>
      </div>,
      "Add AI Account",
    );
  } else if (stage.kind === "create-bot") {
    /*
     * Which account backs the bot is a question, not a guess.
     *
     * Create Bot used to call `provisionBot(connectedAccounts[0].provider)`
     * and, when no account was connected, silently open the *add an account*
     * chooser instead. With four accounts on screen — all of them needing to
     * sign in again — pressing "Create Bot" therefore offered to add a fifth
     * and explained nothing. Both halves of that are fixed here: the accounts
     * are listed so one can be chosen, and an account that cannot back a bot
     * says why rather than being quietly skipped.
     */
    const connectable = (accounts ?? []).filter((account) => account.status === "connected");
    dialog = modal(
      <div className="relative">
        {closeButton}
        <h2 className="text-xl font-semibold text-[var(--text)]">Create Bot</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          A bot runs on one of your connected AI accounts. Choose which one.
        </p>

        {connectable.length === 0 ? (
          <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
            <p className="text-sm text-[var(--text)]">
              {(accounts ?? []).length === 0
                ? "No AI account is connected yet."
                : `None of your ${(accounts ?? []).length} accounts currently holds a working credential, so none of them can back a bot.`}
            </p>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              {(accounts ?? []).length === 0
                ? "Add one first — it takes a sign-in with the account you already pay for."
                : "Use Reconnect on an account below to sign in again, then create the bot."}
            </p>
            <button
              type="button"
              onClick={() => setStage((accounts ?? []).length === 0
                ? { kind: "choose" }
                : { kind: "closed" })}
              className="btn btn-primary btn-sm mt-3"
            >
              {(accounts ?? []).length === 0 ? "Add AI Account" : "Back to accounts"}
            </button>
          </div>
        ) : (
          <ul className="mt-5 grid grid-cols-1 gap-2">
            {connectable.map((account) => (
              <li key={account.id}>
                <button
                  type="button"
                  disabled={creatingBot}
                  onClick={() => void provisionBot(account.provider)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-left transition-colors hover:border-[var(--accent-border)] disabled:opacity-60"
                >
                  <p className="truncate text-sm font-semibold text-[var(--text)]">
                    {account.displayName}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {account.providerLabel} · Connected
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}

        {(accounts ?? []).some((account) => account.status !== "connected") ? (
          <p className="mt-4 text-xs text-[var(--text-muted)]">
            Accounts that need signing in again are not listed here. Reconnect one below and it
            becomes available.
          </p>
        ) : null}
        {botNotice ? (
          <p className="mt-3 text-sm text-[var(--danger)]" aria-live="polite">{botNotice}</p>
        ) : null}
      </div>,
      "Create Bot",
    );
  } else if (stage.kind === "assign") {
    /*
     * The roster's own route onto a project.
     *
     * Assignment existed only on the project page's wizard, so someone looking
     * at their bots had no way to act on one — the answer to "add this bot to
     * a project" was "go somewhere else and start from the project instead".
     * This posts through the same endpoint the wizard uses, which resolves
     * readiness server-side and applies the least-privilege defaults; opening
     * the wizard is still the way to depart from them.
     */
    const bot = stage.bot;
    dialog = modal(
      <form
        className="relative"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const projectId = String(data.get("projectId") ?? "");
          const roleId = String(data.get("roleId") ?? "");
          if (projectId && roleId) void assignBotToProject(bot, projectId, roleId);
        }}
      >
        {closeButton}
        <h2 className="text-xl font-semibold text-[var(--text)]">Add {bot.name} to a project</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          The bot is posted with the safest configuration: read-only repository access, no pull
          requests, and human approval required. Open the project&rsquo;s Assign Bots wizard to
          widen any of that.
        </p>

        {projects.length === 0 || roles.length === 0 ? (
          <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
            <p className="text-sm text-[var(--text)]">
              {projects.length === 0
                ? "This workspace has no projects yet, and a bot is assigned to a project."
                : "This workspace has no bot roles defined, and every assignment carries one."}
            </p>
            <a
              href={projects.length === 0 ? "/solutions/projects#add-project" : "/solutions/agents"}
              className="btn btn-primary btn-sm mt-3"
            >
              {projects.length === 0 ? "Create a project" : "Open roles"}
            </a>
          </div>
        ) : (
          <>
            <div className="mt-4">
              <label htmlFor="assign-project" className="field-label">Project</label>
              <select id="assign-project" name="projectId" className="input w-full" required>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </div>
            <div className="mt-3">
              <label htmlFor="assign-role" className="field-label">Role</label>
              <select id="assign-role" name="roleId" className="input w-full" required>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="submit" disabled={assignBusy} className="btn btn-primary btn-sm">
                {assignBusy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="size-4" aria-hidden="true" />
                )}
                Add to project
              </button>
              <button
                type="button"
                onClick={() => setStage({ kind: "closed" })}
                className="btn btn-secondary btn-sm"
              >
                Cancel
              </button>
            </div>
          </>
        )}
        {botNotice ? (
          <p className="mt-3 text-sm text-[var(--danger)]" aria-live="polite">{botNotice}</p>
        ) : null}
      </form>,
      `Add ${bot.name} to a project`,
    );
  } else if (stage.kind === "confirm") {
    const entry = CONNECTABLE.find((candidate) => candidate.providerId === stage.providerId)!;
    const vendor = stage.providerId === "anthropic" ? "Anthropic" : "OpenAI";
    dialog = modal(
      <div className="relative text-center">
        {closeButton}
        <span
          className="mx-auto grid size-12 place-items-center rounded-xl text-lg font-bold text-white"
          style={{ backgroundColor: findBotProvider(stage.providerId)?.accent }}
          aria-hidden="true"
        >
          {entry.name[0]}
        </span>
        <h2 className="mt-4 text-xl font-semibold text-[var(--text)]">Connect {entry.name}</h2>
        <p className="mt-2 text-sm font-medium text-[var(--text)]">
          Sign in using your existing {entry.name} account.
        </p>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          You will authenticate directly with {vendor}. Software Factory never receives
          your {entry.name} password.
        </p>
        <div className="mt-5 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => setStage({ kind: "connecting", providerId: stage.providerId })}
            className="btn btn-primary w-full max-w-xs"
          >
            Continue to {vendor === "Anthropic" ? "Claude" : "OpenAI"}
          </button>
          <button
            type="button"
            onClick={() => setStage({ kind: "closed" })}
            className="btn btn-secondary w-full max-w-xs"
          >
            Cancel
          </button>
        </div>
      </div>,
      `Connect ${entry.name}`,
    );
  } else if (stage.kind === "connecting") {
    const entry = CONNECTABLE.find((candidate) => candidate.providerId === stage.providerId)!;
    dialog = modal(
      <AiAccountConnect
        providerId={stage.providerId}
        providerLabel={entry.name}
        onConnected={async (accountId) => {
          await load();
          setSuccessEditing(false);
          setStage({ kind: "connected", providerId: stage.providerId, accountId });
        }}
        onFallback={() => setStage({ kind: "closed" })}
        onClose={() => setStage({ kind: "closed" })}
      />,
      `Connecting ${entry.name}`,
    );
  } else if (stage.kind === "connected") {
    const entry = CONNECTABLE.find((candidate) => candidate.providerId === stage.providerId)!;
    const account = (accounts ?? []).find((candidate) => candidate.id === stage.accountId);
    dialog = modal(
      <div className="relative text-center">
        {closeButton}
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-500/10">
          <Check className="size-7 text-emerald-500" aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-xl font-semibold text-[var(--text)]">{entry.name} connected</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Your {entry.name} account is ready to use.
        </p>
        {account ? (
          <dl className="mx-auto mt-4 max-w-xs space-y-1 text-left text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-[var(--text-muted)]">Account</dt>
              <dd className="font-medium text-[var(--text)]">
                {successEditing ? (
                  <form
                    className="flex items-center gap-1.5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void renameConnectedAccount(account.id, account.displayName);
                    }}
                  >
                    <label className="sr-only" htmlFor="success-rename">
                      New name for {account.displayName}
                    </label>
                    <input
                      id="success-rename"
                      value={successName}
                      onChange={(event) => setSuccessName(event.target.value)}
                      maxLength={80}
                      autoFocus
                      className="w-36 rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] px-2 py-1 text-sm text-[var(--text)]"
                    />
                    <button
                      type="submit"
                      disabled={successRenameBusy}
                      aria-label="Save name"
                      className="btn btn-primary btn-sm"
                    >
                      {successRenameBusy ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Check className="size-3.5" aria-hidden="true" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSuccessEditing(false)}
                      aria-label="Cancel rename"
                      className="btn btn-secondary btn-sm"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </form>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    {account.displayName}
                    <button
                      type="button"
                      aria-label={`Rename ${account.displayName}`}
                      onClick={() => {
                        setSuccessName(account.displayName);
                        setSuccessEditing(true);
                      }}
                      className="rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text)]"
                    >
                      <Pencil className="size-3.5" aria-hidden="true" />
                    </button>
                  </span>
                )}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--text-muted)]">Provider</dt>
              <dd className="font-medium text-[var(--text)]">{entry.runtime}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--text-muted)]">Status</dt>
              <dd className="font-medium text-emerald-500">Ready</dd>
            </div>
          </dl>
        ) : null}
        <div className="mt-5 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => void provisionBot(stage.providerId)}
            disabled={creatingBot}
            className="btn btn-primary w-full max-w-xs"
          >
            Create My First Bot
          </button>
          <button
            type="button"
            onClick={() => setStage({ kind: "closed" })}
            className="btn btn-secondary w-full max-w-xs"
          >
            Done
          </button>
        </div>
        {botNotice ? <p className="mt-2 text-xs text-amber-600">{botNotice}</p> : null}
      </div>,
      `${entry.name} connected`,
    );
  }

  // ----------------------------------------------------------------- render

  const loading = accounts === null;
  const empty = !loading && (accounts?.length ?? 0) === 0 && bots.length === 0;

  if (signedOut || unavailable) {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center">
        <h2 className="text-xl font-semibold text-[var(--text)]">
          {signedOut ? "Sign in to manage your bots" : "The bot fabric is unavailable"}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--text-muted)]">
          {signedOut
            ? "Your AI accounts and bots are waiting behind your sign-in."
            : "The service could not be reached. Nothing was changed."}
        </p>
        {signedOut ? (
          <a
            href="/auth/sign-in?next=%2Fsolutions%2Fbot-manager"
            className="btn btn-primary mt-4 inline-block"
          >
            Sign in
          </a>
        ) : (
          <button type="button" onClick={() => void load()} className="btn btn-primary mt-4">
            Try Again
          </button>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {dialog}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {canManage ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStage({ kind: "choose" })}
              className="btn btn-primary btn-sm"
            >
              <Plus className="size-4" aria-hidden="true" />
              Add AI Account
            </button>
            <button
              type="button"
              onClick={() => setStage({ kind: "create-bot" })}
              className="btn btn-secondary btn-sm"
            >
              <Plus className="size-4" aria-hidden="true" />
              Create Bot
            </button>
          </div>
        ) : null}
      </div>

      {!empty && !loading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {
              label: "AI Accounts",
              /*
               * "0 Connected" directly above a list headed "AI accounts 4"
               * reads as a contradiction, and the reader has to work out which
               * number is wrong. Neither is: four accounts exist and none of
               * them currently holds a working credential. Saying both numbers
               * is the only phrasing that is true and legible at once.
               */
              /*
               * The count large, the word beneath it — not one phrase left to
               * wrap. "0 of 4 Connected" at tile size broke across three lines
               * on a phone and stretched the card to twice the height of the
               * three beside it.
               */
              value: (accounts ?? []).length === connectedAccounts.length
                ? String(connectedAccounts.length)
                : `${connectedAccounts.length} of ${(accounts ?? []).length}`,
              detail: "Connected",
            },
            { label: "Active Bots", value: String(bots.length), detail: null },
            {
              label: "Ready",
              value: String(bots.filter((bot) => bot.readiness === "ready").length),
              detail: null,
            },
            { label: "Assignments", value: String(assignments.length), detail: null },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
            >
              <p className="text-xs text-[var(--text-muted)]">{card.label}</p>
              <p className="mt-1 text-xl font-semibold text-[var(--text)]">{card.value}</p>
              {card.detail ? (
                <p className="text-xs text-[var(--text-muted)]">{card.detail}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {empty ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[var(--accent)]/10">
            <Sparkles className="size-7 text-[var(--accent-text)]" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-2xl font-semibold text-[var(--text)]">Build your AI team</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--text-muted)]">
            Connect Claude or Codex using the account you already use.
            {" "}
            <span className="font-medium text-[var(--text)]">
              No API keys required for supported account-login connections.
            </span>
          </p>
          <div className="mx-auto mt-6 grid grid-cols-1 max-w-2xl gap-4 sm:grid-cols-2">
            {CONNECTABLE.map((entry) => (
              <div
                key={entry.providerId}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5 text-left"
              >
                <span
                  className="grid size-10 place-items-center rounded-xl text-base font-bold text-white"
                  style={{ backgroundColor: findBotProvider(entry.providerId)?.accent }}
                  aria-hidden="true"
                >
                  {entry.name[0]}
                </span>
                <h3 className="mt-3 text-lg font-semibold text-[var(--text)]">{entry.name}</h3>
                <p className="text-xs text-[var(--text-muted)]">{entry.runtime}</p>
                <p className="mt-2 text-sm text-[var(--text-muted)]">{entry.description}</p>
                <button
                  type="button"
                  onClick={() => setStage({ kind: "confirm", providerId: entry.providerId })}
                  disabled={!canManage}
                  className="btn btn-primary mt-4 w-full"
                >
                  Connect {entry.name} →
                </button>
                <p className="mt-2 text-center text-xs text-[var(--text-muted)]">Not connected</p>
              </div>
            ))}
          </div>
          <div className="mt-6">
            <button
              type="button"
              onClick={() => setAdvancedOpen((open) => !open)}
              className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] underline"
              aria-expanded={advancedOpen}
            >
              Advanced options
              <ChevronDown
                className={cn("size-4 transition-transform", advancedOpen && "rotate-180")}
                aria-hidden="true"
              />
            </button>
            {advancedOpen ? (
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                Anthropic API, OpenAI API, and OpenRouter connections live in
                {" "}
                <a href="#developer-diagnostics" className="underline">Developer Diagnostics</a>
                {" "}
                below.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {!empty && !loading ? (
        <>
          <AiAccountsPanel canManage={canManage} onChanged={load} />

          {bots.length > 0 ? (
            <section aria-label="Your AI team" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h2 className="text-sm font-semibold text-[var(--text)]">Your AI Team</h2>
              <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {bots.map((bot) => (
                  <li
                    key={bot.id}
                    className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5"
                  >
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        bot.readiness === "ready" ? "bg-emerald-500" : "bg-[var(--border)]",
                      )}
                      aria-hidden="true"
                    />
                    <Bot className="size-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      {renamingBotId === bot.id ? (
                        <form
                          className="flex items-center gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void renameBot(bot);
                          }}
                        >
                          <label className="sr-only" htmlFor={`rename-bot-${bot.id}`}>
                            New name for {bot.name}
                          </label>
                          <input
                            id={`rename-bot-${bot.id}`}
                            value={renameBotName}
                            onChange={(event) => setRenameBotName(event.target.value)}
                            maxLength={80}
                            autoFocus
                            className="w-44 max-w-full rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] px-2 py-1 text-sm text-[var(--text)]"
                          />
                          <button type="submit" disabled={renameBusy} className="btn btn-primary btn-sm">
                            {renameBusy ? (
                              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <Check className="size-3.5" aria-hidden="true" />
                            )}
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingBotId(null)}
                            className="btn btn-secondary btn-sm"
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-[var(--text)]">
                          {/*
                            `truncate` on the name, never on the row. On the row
                            it sets `white-space: nowrap` and `overflow: hidden`
                            for the whole flex container, so a long bot name
                            pushed the rename and remove buttons past the edge
                            and the container clipped them — on the page and
                            unreachable. The accounts panel carries the same
                            fix; this copy had it the wrong way round, and no
                            test could see it while the harness rendered the
                            roster read-only.
                          */}
                          <span className="min-w-0 truncate">{bot.name}</span>
                          {canManage ? (
                            <>
                              <button
                                type="button"
                                aria-label={`Rename ${bot.name}`}
                                onClick={() => {
                                  setRenameBotName(bot.name);
                                  setRenamingBotId(bot.id);
                                }}
                                className="shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text)]"
                              >
                                <Pencil className="size-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                aria-label={`Remove ${bot.name}`}
                                onClick={() => setRemovingBotId(bot.id)}
                                className="shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--danger)]"
                              >
                                <Trash2 className="size-3.5" aria-hidden="true" />
                              </button>
                            </>
                          ) : null}
                        </p>
                      )}
                      <p className="text-xs text-[var(--text-muted)]">
                        {bot.providerLabel} · {bot.readinessLabel}
                      </p>
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() => {
                            setBotNotice("");
                            setStage({ kind: "assign", bot });
                          }}
                          className="btn btn-secondary btn-sm mt-2"
                        >
                          <Plus className="size-3.5" aria-hidden="true" />
                          Add to project
                        </button>
                      ) : null}
                      {removingBotId === bot.id ? (
                        <div className="mt-2 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-surface)] p-2.5">
                          <p className="text-xs text-[var(--text)]">
                            Remove {bot.name}? Its project assignments are released; every run and
                            audit record it produced is kept.
                          </p>
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => void removeBot(bot)}
                              disabled={removeBusy}
                              className="btn btn-primary btn-sm"
                            >
                              {removeBusy ? (
                                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                              ) : (
                                <Trash2 className="size-3.5" aria-hidden="true" />
                              )}
                              Remove bot
                            </button>
                            <button
                              type="button"
                              onClick={() => setRemovingBotId(null)}
                              className="btn btn-secondary btn-sm"
                            >
                              Keep it
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
