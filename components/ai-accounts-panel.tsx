"use client";

import { Check, KeyRound, Loader2, Pencil, Trash2, Unplug } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AiAccountConnect } from "@/components/ai-account-connect";
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
  displayName: string;
  providerIdentity: string | null;
  status: string;
  lastVerifiedAt: string | null;
  lastError: string | null;
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
}: {
  canManage: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [reconnecting, setReconnecting] = useState<AccountView | null>(null);
  // Disconnect and Remove ask in place: first click arms, second click acts.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // Rename edits in place: the title becomes an input until saved or blurred.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/ai-accounts", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { accounts?: AccountView[] };
      setAccounts(body.accounts ?? []);
    } catch {
      // The panel is additive; a failed read leaves it hidden rather than red.
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);

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

      <ul className="mt-3 space-y-2">
        {accounts.map((account) => {
          const status = STATUS_LABELS[account.status]
            ?? { label: account.status, tone: "text-[var(--text-muted)] border-[var(--border)]" };
          return (
            <li
              key={account.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                {editingId === account.id ? (
                  <form
                    className="flex items-center gap-2"
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
                      className="w-56 max-w-full rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] px-2 py-1 text-sm text-[var(--text)]"
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
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium text-[var(--text)]">
                    {account.displayName}
                    {canManage ? (
                      <button
                        type="button"
                        aria-label={`Rename ${account.displayName}`}
                        onClick={() => {
                          setEditName(account.displayName);
                          setEditingId(account.id);
                        }}
                        className="rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text)]"
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
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold",
                  status.tone,
                )}
              >
                {status.label}
              </span>
              {canManage ? (
                <div className="flex shrink-0 gap-2">
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
