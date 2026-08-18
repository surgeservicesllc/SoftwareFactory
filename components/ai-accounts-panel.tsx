"use client";

import {
  Check,
  KeyRound,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
  Unplug,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AiAccountConnect } from "@/components/ai-account-connect";
import {
  AccountUsage,
  type AccountUsageView,
} from "@/components/bot-manager/account-usage";
import { cn } from "@/lib/cn";

/**
 * The AI Accounts panel: every provider sign-in as its own row, with the
 * lifecycle the database actually records — connected, needs sign-in again,
 * not signed in yet, disconnected — and the two owner actions, Reconnect
 * (the same auto-completing broker flow Connect uses) and Disconnect (which
 * removes the sealed credential, and says so before doing it).
 *
 * Renders nothing while the organization has no accounts: the front door's
 * Connect buttons are the way in, and an empty management panel would only
 * add noise above them.
 */

type AccountView = {
  id: string;
  provider: string;
  providerLabel: string;
  authMethod: string;
  displayName: string;
  providerIdentity: string | null;
  status: string;
  lastVerifiedAt: string | null;
  lastError: string | null;
  createdAt: string | null;
};

const STATUS_LABELS: Readonly<Record<string, { label: string; tone: string }>> = Object.freeze({
  connected: { label: "Connected", tone: "text-emerald-500 border-emerald-500/40" },
  needs_reauth: { label: "Needs sign-in again", tone: "text-amber-500 border-amber-500/40" },
  pending: { label: "Not signed in yet", tone: "text-[var(--text-muted)] border-[var(--border)]" },
  disconnected: { label: "Disconnected", tone: "text-[var(--text-muted)] border-[var(--border)]" },
  revoked: { label: "Revoked", tone: "text-[var(--text-muted)] border-[var(--border)]" },
});

export function AiAccountsPanel({
  canManage,
  onChanged,
  /**
   * Turn the chosen accounts into bots.
   *
   * The panel owns the selection because that is where the rows are; it does
   * not own provisioning, which is owner-authorized work the Bot Manager
   * already performs through `/api/bots/connect/provision`. Passing the
   * accounts up keeps one authorization path rather than a second copy here.
   */
  onCreateBots,
  /**
   * The selection, raised.
   *
   * The panel still owns the control and the highlight; a caller that can act
   * on the choice — the AI Factory, which knows the project — needs to see it,
   * and two components each keeping their own copy of "what is selected" is
   * how the button and the list come to disagree.
   */
  selectedIds,
  onSelectedChange,
}: {
  canManage: boolean;
  onChanged: () => Promise<void> | void;
  onCreateBots?: (accounts: readonly { id: string; provider: string }[]) => Promise<void> | void;
  selectedIds?: readonly string[];
  onSelectedChange?: (ids: readonly string[]) => void;
}) {
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [usageByAccount, setUsageByAccount] = useState<Record<string, AccountUsageView>>({});
  const [reconnecting, setReconnecting] = useState<AccountView | null>(null);
  // Disconnect and Remove ask in place: first click arms, second click acts.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // Rename edits in place: the title becomes an input until saved or blurred.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  // One or many. A set rather than a single id, because the whole point of
  // the control is acting on several accounts at once.
  const [ownSelectedIds, setOwnSelectedIds] = useState<readonly string[]>([]);
  const [creatingBots, setCreatingBots] = useState(false);
  const selected = selectedIds ?? ownSelectedIds;
  const setSelected = (next: readonly string[]) => {
    if (onSelectedChange) onSelectedChange(next);
    else setOwnSelectedIds(next);
  };
  // Refresh is evidence, not optimism: the map holds each account's request
  // time, and the marker clears only when the worker's re-verification moves
  // `lastVerifiedAt` past it (or a quiet three minutes expires the wait).
  // The ref mirrors the state so the async load path can prune against the
  // freshest markers without a setState-in-effect cascade.
  const [refreshing, setRefreshingState] = useState<Record<string, number>>({});
  const refreshingRef = useRef<Record<string, number>>({});
  const updateRefreshing = useCallback((next: Record<string, number>) => {
    refreshingRef.current = next;
    setRefreshingState(next);
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/ai-accounts", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { accounts?: AccountView[] };
      const nextAccounts = body.accounts ?? [];
      setAccounts(nextAccounts);
      // Fresh evidence clears a refresh marker; a quiet three minutes expires
      // it with an honest notice instead of an eternal spinner.
      const entries = Object.entries(refreshingRef.current);
      if (entries.length > 0) {
        const next: Record<string, number> = {};
        let timedOut = false;
        for (const [id, requestedAt] of entries) {
          const account = nextAccounts.find((entry) => entry.id === id);
          const verifiedAt = account?.lastVerifiedAt ? Date.parse(account.lastVerifiedAt) : 0;
          if (verifiedAt > requestedAt) continue;
          if (Date.now() - requestedAt > 180_000) {
            timedOut = true;
            continue;
          }
          next[id] = requestedAt;
        }
        if (Object.keys(next).length !== entries.length) {
          updateRefreshing(next);
          if (timedOut) {
            setNotice("The refresh has not completed yet — the worker sweep continues in the background.");
          }
        }
      }
    } catch {
      // The panel is additive; a failed read leaves it hidden rather than red.
    }
    // Usage is separate evidence with its own lifecycle: a failed usage read
    // leaves the accounts intact and each row saying "no usage recorded yet",
    // never an error page.
    try {
      const usageResponse = await fetch("/api/ai-accounts/usage", { cache: "no-store" });
      if (!usageResponse.ok) return;
      const usageBody = (await usageResponse.json()) as { usage?: AccountUsageView[] };
      setUsageByAccount(Object.fromEntries(
        (usageBody.usage ?? []).map((entry) => [entry.accountId, entry]),
      ));
    } catch {
      // Same rule: absence of usage evidence is not an outage.
    }
  }, [updateRefreshing]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    // The worker records fresh usage on its own cadence; the panel re-reads it
    // so the page stays current without anyone clicking. Paused while the tab
    // is hidden — polling a background tab is spend without an audience.
    const refresh = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(refresh);
    };
  }, [load]);

  const requestRefresh = useCallback(async (account: AccountView) => {
    setBusyId(account.id);
    setNotice("");
    try {
      const response = await fetch("/api/ai-accounts/refresh", { method: "POST" });
      const body = (await response.json()) as {
        workerWoken?: boolean;
        error?: { message?: string };
      };
      if (!response.ok) {
        setNotice(body.error?.message ?? "The refresh could not be requested.");
        return;
      }
      updateRefreshing({ ...refreshingRef.current, [account.id]: Date.now() });
      if (body.workerWoken === false) {
        setNotice("Refresh queued — the scheduled sweep will re-verify shortly.");
      }
    } catch {
      setNotice("The refresh could not be requested.");
    } finally {
      setBusyId(null);
    }
  }, [updateRefreshing]);

  // Poll faster only while a refresh is outstanding, so the new verification
  // shows up within seconds of the worker recording it.
  useEffect(() => {
    if (Object.keys(refreshing).length === 0) return;
    const interval = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(interval);
  }, [refreshing, load]);

  const rename = useCallback(async (account: AccountView) => {
    const name = editName.trim();
    if (name.length === 0 || name === account.displayName) {
      setEditingId(null);
      return;
    }
    setBusyId(account.id);
    setNotice("");
    try {
      const response = await fetch(`/api/ai-accounts/${account.id}/rename`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setNotice(body.error?.message ?? "The account could not be renamed.");
        return;
      }
      setEditingId(null);
      await load();
      await onChanged();
    } catch {
      setNotice("The account could not be renamed.");
    } finally {
      setBusyId(null);
    }
  }, [editName, load, onChanged]);

  const remove = useCallback(async (account: AccountView) => {
    setBusyId(account.id);
    setNotice("");
    try {
      const response = await fetch(`/api/ai-accounts/${account.id}/remove`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json()) as {
          error?: { message?: string; detail?: string };
        };
        const detail = body.error?.detail ? ` (${body.error.detail})` : "";
        setNotice((body.error?.message ?? "The account could not be removed.") + detail);
        return;
      }
      await load();
      await onChanged();
    } catch {
      setNotice("The account could not be removed.");
    } finally {
      setBusyId(null);
      setRemovingId(null);
    }
  }, [load, onChanged]);

  const disconnect = useCallback(async (account: AccountView) => {
    setBusyId(account.id);
    setNotice("");
    try {
      const response = await fetch(`/api/ai-accounts/${account.id}/disconnect`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setNotice(body.error?.message ?? "The account could not be disconnected.");
        return;
      }
      await load();
      await onChanged();
    } catch {
      setNotice("The account could not be disconnected.");
    } finally {
      setBusyId(null);
      setConfirmingId(null);
    }
  }, [load, onChanged]);

  const selectedAccounts = accounts.filter((account) => selected.includes(account.id));
  const connectableSelection = selectedAccounts.filter(
    (account) => account.status === "connected",
  );
  const selectableCount = connectableSelection.length;

  function toggleSelected(accountId: string) {
    setSelected(
      selected.includes(accountId)
        ? selected.filter((id) => id !== accountId)
        : [...selected, accountId],
    );
  }

  async function createBotsFromSelection() {
    if (!onCreateBots || connectableSelection.length === 0) return;
    setCreatingBots(true);
    setNotice("");
    try {
      await onCreateBots(connectableSelection.map((account) => ({
        id: account.id,
        provider: account.provider,
      })));
      setSelected([]);
    } finally {
      setCreatingBots(false);
    }
  }

  if (accounts.length === 0) return null;

  return (
    <section aria-label="AI accounts" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--text)]">
          AI accounts
          <span className="ml-2 rounded bg-[var(--surface-inset)] px-1.5 py-0.5 font-mono text-xs text-[var(--text-muted)]">
            {accounts.length}
          </span>
        </h2>
      </div>

      {reconnecting ? (
        <div className="mt-3">
          <AiAccountConnect
            providerId={reconnecting.provider as "anthropic" | "openai"}
            providerLabel={reconnecting.providerLabel}
            accountId={reconnecting.id}
            onConnected={async () => {
              setReconnecting(null);
              await load();
              await onChanged();
            }}
            onFallback={() => setReconnecting(null)}
            onClose={() => setReconnecting(null)}
          />
        </div>
      ) : null}

      {selected.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-surface)] px-3 py-2">
          <p className="min-w-0 flex-1 text-sm text-[var(--text)]">
            {/*
              Both numbers, always. Creating bots only from the accounts that
              can back one is right; doing it without saying which were left
              out would make the button's count a mystery.
            */}
            {selected.length} selected
            {selectableCount === selected.length
              ? ""
              : ` · ${selectableCount} can create a bot, the rest need signing in again`}
          </p>
          {onCreateBots && canManage ? (
            <button
              type="button"
              disabled={creatingBots || selectableCount === 0}
              onClick={() => void createBotsFromSelection()}
              className="btn btn-primary btn-sm"
            >
              {creatingBots ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="size-3.5" aria-hidden="true" />
              )}
              {/*
                Never "Create 0 bots". A disabled button whose label counts
                nothing reads as broken rather than as unavailable; naming the
                reason is what makes it the second.
              */}
              {selectableCount === 0
                ? "None can create a bot"
                : selectableCount === 1 ? "Create 1 bot" : `Create ${selectableCount} bots`}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setSelected([])}
            className="btn btn-secondary btn-sm"
          >
            Clear selection
          </button>
        </div>
      ) : null}

      <ul className="mt-3 space-y-2">
        {accounts.map((account) => {
          const status = STATUS_LABELS[account.status]
            ?? { label: account.status, tone: "text-[var(--text-muted)] border-[var(--border)]" };
          return (
            <li
              key={account.id}
              /*
               * A column, not one wrapping row.
               *
               * The design puts the name and the SELECT control on the first
               * line, the account's own facts under it, and the state badge at
               * the head of the action row where it explains the buttons
               * beside it. As a single wrapping flex row the badge landed
               * wherever the name's length left it, which on a narrow panel
               * was between the name and the buttons it describes.
               */
              className={cn(
                "rounded-lg border px-3 py-2 transition-colors",
                selected.includes(account.id)
                  ? "border-[var(--accent-border)] bg-[var(--accent-surface)]"
                  : "border-[var(--border)] bg-[var(--surface-raised)]",
              )}
            >
              <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                {editingId === account.id ? (
                  <form
                    // Wraps, and the field shares the row rather than claiming
                    // a fixed 224px. At 320px the input plus Save plus Cancel
                    // did not fit, and a non-wrapping row put Cancel off the
                    // edge — so the way out of a rename was unreachable.
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void rename(account);
                    }}
                  >
                    <label className="sr-only" htmlFor={`rename-${account.id}`}>
                      New name for {account.displayName}
                    </label>
                    <input
                      id={`rename-${account.id}`}
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      maxLength={80}
                      autoFocus
                      className="min-w-0 flex-1 basis-40 rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] px-2 py-1 text-sm text-[var(--text)]"
                    />
                    <button
                      type="submit"
                      disabled={busyId === account.id}
                      className="btn btn-primary btn-sm"
                    >
                      {busyId === account.id ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Check className="size-3.5" aria-hidden="true" />
                      )}
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="btn btn-secondary btn-sm"
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  // `truncate` belongs on the name, not on the row. On the row
                  // it sets `white-space: nowrap` and `overflow: hidden` for the
                  // whole flex container, so a long account name pushed the
                  // rename button past the edge and the container clipped it —
                  // the control was on the page and unreachable. The name
                  // truncates now; the button holds its size.
                  <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--text)]">
                    <span className="min-w-0 truncate">{account.displayName}</span>
                    {canManage ? (
                      <button
                        type="button"
                        aria-label={`Rename ${account.displayName}`}
                        onClick={() => {
                          setEditName(account.displayName);
                          setEditingId(account.id);
                        }}
                        className="shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text)]"
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                      </button>
                    ) : null}
                  </p>
                )}
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {account.providerIdentity
                    ? `Signed in as ${account.providerIdentity} — `
                    : ""}
                  {account.lastVerifiedAt
                    ? `Last verified ${new Date(account.lastVerifiedAt).toLocaleString()}`
                    : "Never verified"}
                  {account.lastError ? ` — ${account.lastError}` : ""}
                </p>
                <p className="mt-0.5 text-xs text-[var(--text-faint)]">
                  {account.providerLabel}
                  {" · "}
                  {account.authMethod === "api_key" ? "API key" : "Subscription"}
                  {account.createdAt
                    ? ` · Added ${new Date(account.createdAt).toLocaleDateString()}`
                    : ""}
                </p>
                {account.status === "connected" || account.status === "needs_reauth" ? (
                  <AccountUsage usage={usageByAccount[account.id]} />
                ) : null}
              </div>
              {canManage ? (
                <button
                  type="button"
                  aria-pressed={selected.includes(account.id)}
                  /*
                   * The name lives in `aria-label`, not in an `sr-only` span.
                   * A hidden text node carrying the account's name makes the
                   * name appear twice in the accessible tree — and, more
                   * practically, twice to anything matching on text.
                   */
                  aria-label={`Select ${account.displayName}`}
                  onClick={() => toggleSelected(account.id)}
                  className={cn(
                    "shrink-0 rounded-lg border px-4 py-2 text-sm font-bold uppercase tracking-wide transition-colors",
                    selected.includes(account.id)
                      ? "border-[var(--accent-border)] bg-[var(--accent)] text-[var(--accent-ink)]"
                      : "border-[var(--border)] text-[var(--text)] hover:border-[var(--accent-border)]",
                  )}
                >
                  {selected.includes(account.id) ? (
                    <span className="flex items-center gap-1.5">
                      <Check className="size-3.5" aria-hidden="true" />
                      Selected
                    </span>
                  ) : (
                    "Select"
                  )}
                </button>
              ) : null}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold",
                  status.tone,
                )}
              >
                {status.label}
              </span>
              {canManage ? (
                // Wraps rather than refusing to shrink. An account in a bad
                // state offers Refresh, Reconnect, Disconnect and Remove at
                // once, and `shrink-0` on a non-wrapping row ran that set off
                // the right edge of the panel on a phone — the last button was
                // simply unreachable, which is how a stuck account stays stuck.
                <div className="flex flex-wrap items-center gap-2">
                  {account.status === "connected" || account.status === "needs_reauth" ? (
                    <button
                      type="button"
                      onClick={() => void requestRefresh(account)}
                      disabled={busyId === account.id || refreshing[account.id] !== undefined}
                      className="btn btn-secondary btn-sm"
                    >
                      {refreshing[account.id] !== undefined ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <RefreshCw className="size-3.5" aria-hidden="true" />
                      )}
                      {refreshing[account.id] !== undefined ? "Refreshing" : "Refresh"}
                    </button>
                  ) : null}
                  {account.status !== "connected" && account.status !== "revoked" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingId(null);
                        setReconnecting(account);
                      }}
                      className="btn btn-secondary btn-sm"
                    >
                      <KeyRound className="size-3.5" aria-hidden="true" />
                      Reconnect
                    </button>
                  ) : null}
                  {account.status !== "disconnected" && account.status !== "revoked" ? (
                    confirmingId === account.id ? (
                      <button
                        type="button"
                        onClick={() => void disconnect(account)}
                        disabled={busyId === account.id}
                        className="btn btn-danger btn-sm"
                      >
                        {busyId === account.id ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Unplug className="size-3.5" aria-hidden="true" />
                        )}
                        Remove its credential — confirm
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setRemovingId(null);
                          setConfirmingId(account.id);
                        }}
                        className="btn btn-secondary btn-sm"
                      >
                        <Unplug className="size-3.5" aria-hidden="true" />
                        Disconnect
                      </button>
                    )
                  ) : null}
                  {removingId === account.id ? (
                    <button
                      type="button"
                      onClick={() => void remove(account)}
                      disabled={busyId === account.id}
                      className="btn btn-danger btn-sm"
                    >
                      {busyId === account.id ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      )}
                      Delete this account — confirm
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingId(null);
                        setRemovingId(account.id);
                      }}
                      className="btn btn-secondary btn-sm"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      Remove
                    </button>
                  )}
                </div>
              ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {notice ? (
        <p className="mt-2 text-xs text-amber-600" aria-live="polite">{notice}</p>
      ) : null}
    </section>
  );
}
