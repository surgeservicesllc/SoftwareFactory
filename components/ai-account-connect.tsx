"use client";

import { Check, ExternalLink, KeyRound, Loader2, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The auto-completing sign-in: every state shown here is read from the broker
 * session row, never assumed. The person clicks Connect, a factory worker
 * runs the provider's real login, this component surfaces the login URL,
 * takes the confirmation code, and flips to Connected when the database says
 * so — there is no "I have signed in — check now" button, because nothing
 * needs the person to claim anything.
 *
 * Honesty over choreography: if no worker claims the session, this says so
 * and offers the manual path rather than spinning forever; if the sign-in
 * fails, the reason (already sanitized server-side) is shown with a way to
 * start again.
 */

type SessionView = {
  id: string;
  accountId: string;
  status: string;
  loginUrl: string | null;
  failureReason: string | null;
  heartbeatAt: string | null;
  expiresAt: string;
};

export type AiAccountConnectProps = {
  providerId: "anthropic" | "openai";
  providerLabel: string;
  /** Reconnect this specific account instead of creating or reusing one. */
  accountId?: string;
  /** Called when the account reaches connected, with its account id. */
  onConnected: (accountId: string) => Promise<void> | void;
  /** The person chose the manual command path instead. */
  onFallback: () => void;
  /** The person cancelled out of the sign-in entirely. */
  onClose: () => void;
};

const POLL_MS = 3_000;
/** After this long with no worker claim, say so and offer the manual path. */
const WORKER_STALL_MS = 75_000;

type Phase =
  | "starting"
  | "waiting_worker"
  | "initializing"
  | "awaiting_user"
  | "submitting_code"
  | "finishing"
  | "connected"
  | "failed";

export function AiAccountConnect({
  providerId,
  providerLabel,
  accountId,
  onConnected,
  onFallback,
  onClose,
}: AiAccountConnectProps) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [session, setSession] = useState<SessionView | null>(null);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [workerWoken, setWorkerWoken] = useState(false);
  const [stalled, setStalled] = useState(false);
  // Set when start() runs; 0 only before the first attempt.
  const startedAtRef = useRef(0);
  const pollRef = useRef<number | null>(null);
  const doneRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  const readSession = useCallback(async (sessionId: string) => {
    try {
      const response = await fetch(`/api/ai-accounts/sessions/${sessionId}`, { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { session?: SessionView };
      const view = body.session;
      if (!view || doneRef.current) return;
      setSession(view);

      switch (view.status) {
        case "pending":
          setPhase("waiting_worker");
          setStalled(Date.now() - startedAtRef.current > WORKER_STALL_MS);
          break;
        case "initializing":
          setPhase("initializing");
          setStalled(false);
          break;
        case "awaiting_user":
          setPhase((current) => (current === "submitting_code" ? current : "awaiting_user"));
          break;
        case "authenticated":
        case "verifying":
          setPhase("finishing");
          break;
        case "connected":
          doneRef.current = true;
          stopPolling();
          setPhase("connected");
          await onConnected(view.accountId);
          break;
        case "failed":
        case "expired":
        case "revoked":
          doneRef.current = true;
          stopPolling();
          setNotice(
            view.status === "failed"
              ? view.failureReason ?? "The sign-in failed."
              : view.status === "expired"
                ? "The sign-in ran out of time before it finished."
                : "The sign-in was cancelled.",
          );
          setPhase("failed");
          break;
        default:
          break;
      }
    } catch {
      // A dropped poll is not a failed sign-in; the next tick answers.
    }
  }, [onConnected, stopPolling]);

  const start = useCallback(async () => {
    doneRef.current = false;
    startedAtRef.current = Date.now();
    setPhase("starting");
    setNotice("");
    setCode("");
    setStalled(false);
    try {
      const response = await fetch("/api/ai-accounts/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          accountId ? { provider: providerId, accountId } : { provider: providerId },
        ),
      });
      const body = (await response.json()) as {
        sessionId?: string;
        accountId?: string;
        workerWoken?: boolean;
        error?: { message?: string };
      };
      if (!response.ok || !body.sessionId) {
        setNotice(body.error?.message ?? "The sign-in could not be started.");
        setPhase("failed");
        return;
      }
      setWorkerWoken(Boolean(body.workerWoken));
      setPhase("waiting_worker");
      const sessionId = body.sessionId;
      stopPolling();
      pollRef.current = window.setInterval(() => void readSession(sessionId), POLL_MS);
      void readSession(sessionId);
    } catch {
      setNotice("The sign-in could not be started.");
      setPhase("failed");
    }
  }, [accountId, providerId, readSession, stopPolling]);

  useEffect(() => {
    // Deferred a tick so the effect body itself sets no state — the kick-off
    // is async work, not render logic. Deliberately once: this component
    // mounts to run one sign-in.
    const kickoff = window.setTimeout(() => void start(), 0);
    return () => window.clearTimeout(kickoff);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = useCallback(async () => {
    stopPolling();
    doneRef.current = true;
    const sessionId = session?.id;
    if (sessionId) {
      await fetch(`/api/ai-accounts/sessions/${sessionId}/cancel`, { method: "POST" })
        .catch(() => undefined);
    }
    onClose();
  }, [onClose, session, stopPolling]);

  const submitCode = useCallback(async () => {
    const sessionId = session?.id;
    const trimmed = code.trim();
    if (!sessionId || !trimmed) return;
    setPhase("submitting_code");
    try {
      const response = await fetch(`/api/ai-accounts/sessions/${sessionId}/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setNotice(body.error?.message ?? "The code was not accepted.");
        setPhase("awaiting_user");
        return;
      }
      setCode("");
      setPhase("finishing");
    } catch {
      setNotice("The code could not be sent. Try again.");
      setPhase("awaiting_user");
    }
  }, [code, session]);

  if (phase === "connected") {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left">
        <p className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
          <Check className="size-4 text-emerald-500" aria-hidden="true" />
          {providerLabel} is connected
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          The account is signed in and its credential is sealed in the vault.
        </p>
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left">
        <p className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
          <XCircle className="size-4 text-red-500" aria-hidden="true" />
          The {providerLabel} sign-in did not finish
        </p>
        {notice ? <p className="mt-1 text-xs text-[var(--text-muted)]">{notice}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => void start()} className="btn btn-primary btn-sm">
            Start again
          </button>
          <button type="button" onClick={onFallback} className="btn btn-secondary btn-sm">
            Use the manual command instead
          </button>
          <button type="button" onClick={() => void cancel()} className="btn btn-secondary btn-sm">
            Close
          </button>
        </div>
      </div>
    );
  }

  if (phase === "awaiting_user" || phase === "submitting_code") {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left">
        <p className="text-sm font-semibold text-[var(--text)]">
          Sign in to {providerLabel}
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Your sign-in page is ready. Finish signing in with {providerLabel}, then paste the
          confirmation code it shows you.
        </p>
        {session?.loginUrl ? (
          <a
            href={session.loginUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="btn btn-primary btn-sm mt-3 inline-flex items-center gap-1.5"
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
            Continue to {providerLabel} sign-in
          </a>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`relay-code-${providerId}`}>
            Confirmation code from {providerLabel}
          </label>
          <input
            id={`relay-code-${providerId}`}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Paste the confirmation code here"
            autoComplete="off"
            spellCheck={false}
            className="w-64 max-w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-1.5 text-sm text-[var(--text)]"
          />
          <button
            type="button"
            onClick={() => void submitCode()}
            disabled={phase === "submitting_code" || code.trim().length === 0}
            className="btn btn-primary btn-sm"
          >
            {phase === "submitting_code" ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <KeyRound className="size-3.5" aria-hidden="true" />
            )}
            Finish connecting
          </button>
        </div>
        {notice ? <p className="mt-2 text-xs text-amber-600">{notice}</p> : null}
        <button type="button" onClick={() => void cancel()} className="btn btn-secondary btn-sm mt-3">
          Cancel
        </button>
      </div>
    );
  }

  const waitingCopy = phase === "starting"
    ? `Starting the ${providerLabel} sign-in…`
    : phase === "initializing"
      ? `A factory worker is starting ${providerLabel}'s real sign-in…`
      : phase === "finishing"
        ? "Finishing the sign-in — checking the account actually works…"
        : workerWoken
          ? "Waiting for a factory worker to pick this up…"
          : "Waiting for a factory worker — it wakes on a schedule, so this can take a few minutes…";

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left">
      <p className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        {waitingCopy}
      </p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        Nothing to copy and no terminal — this page updates by itself at each step.
      </p>
      {stalled && phase === "waiting_worker" ? (
        <p className="mt-2 text-xs text-amber-600">
          No worker has picked this up yet. It may not be enabled — you can keep waiting, or
          use the manual command below.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {stalled && phase === "waiting_worker" ? (
          <button type="button" onClick={onFallback} className="btn btn-secondary btn-sm">
            Use the manual command instead
          </button>
        ) : null}
        <button type="button" onClick={() => void cancel()} className="btn btn-secondary btn-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}
