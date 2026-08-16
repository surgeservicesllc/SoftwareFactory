"use client";

import { Bot, Check, ChevronDown, Loader2, Pencil, Plus, Sparkles, X } from "lucide-react";
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

type FabricPayload = {
  canManage?: boolean;
  bots?: Array<{
    id: string; name: string; provider: string; providerLabel: string;
    readiness: string; readinessLabel: string;
  }>;
  assignments?: AssignmentView[];
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
  | { kind: "connected"; providerId: "anthropic" | "openai"; accountId: string };

export function BotManagerHome() {
  const [accounts, setAccounts] = useState<AccountView[] | null>(null);
  const [bots, setBots] = useState<BotView[]>([]);
  const [assignments, setAssignments] = useState<AssignmentView[]>([]);
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
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
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
            <div className="flex justify-between">
              <dt className="text-[var(--text-muted)]">Account</dt>
              <dd className="font-medium text-[var(--text)]">{account.displayName}</dd>
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
              onClick={() => {
                const provider = connectedAccounts[0]?.provider;
                if (provider) void provisionBot(provider);
                else setStage({ kind: "choose" });
              }}
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
            { label: "AI Accounts", value: `${connectedAccounts.length} Connected` },
            { label: "Active Bots", value: String(bots.length) },
            {
              label: "Ready",
              value: String(bots.filter((bot) => bot.readiness === "ready").length),
            },
            { label: "Assignments", value: String(assignments.length) },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
            >
              <p className="text-xs text-[var(--text-muted)]">{card.label}</p>
              <p className="mt-1 text-xl font-semibold text-[var(--text)]">{card.value}</p>
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
          <div className="mx-auto mt-6 grid max-w-2xl gap-4 sm:grid-cols-2">
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
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
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
                        <p className="flex items-center gap-1.5 truncate text-sm font-medium text-[var(--text)]">
                          {bot.name}
                          {canManage ? (
                            <button
                              type="button"
                              aria-label={`Rename ${bot.name}`}
                              onClick={() => {
                                setRenameBotName(bot.name);
                                setRenamingBotId(bot.id);
                              }}
                              className="rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text)]"
                            >
                              <Pencil className="size-3.5" aria-hidden="true" />
                            </button>
                          ) : null}
                        </p>
                      )}
                      <p className="text-xs text-[var(--text-muted)]">
                        {bot.providerLabel} · {bot.readinessLabel}
                      </p>
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
