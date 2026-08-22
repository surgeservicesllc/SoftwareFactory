"use client";

import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { parseDeviceLogin } from "@/lib/ai-accounts/device-login";
import { cn } from "@/lib/cn";

/**
 * The auto-completing sign-in: every state shown here is read from the broker
 * session row, never assumed. The person clicks Connect, a factory worker
 * runs the provider's real login, this component surfaces the sign-in step,
 * takes the confirmation code, and flips to Connected when the database says
 * so — there is no "I have signed in — check now" button, because nothing
 * needs the person to claim anything.
 *
 * The rendering follows the BotBuildv2 rule: the person should understand
 * Claude, account, status — never workers, brokers, or CLIs. Progress is a
 * five-step checklist; errors are calm and actionable; anything technical
 * lives behind "View technical details".
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
  /** The person chose the manual command path instead (diagnostics-grade). */
  onFallback: () => void;
  /**
   * The broker could not even start a session — its backend is not available
   * here. When set, the caller degrades to its own path immediately; when
   * absent, a calm failed state renders. A sign-in that failed MIDWAY always
   * renders, because that is a real event.
   */
  onUnavailable?: () => void;
  /** The person cancelled out of the sign-in entirely. */
  onClose: () => void;
  /**
   * Embedded owners register this guard so their own X, Escape, and backdrop
   * cannot unmount a broker session without first cancelling it server-side.
   */
  onBeforeCloseChange?: (guard: (() => Promise<boolean>) | null) => void;
};

const POLL_MS = 3_000;
/** After this long with no worker claim, say so and offer a way out. */
const WORKER_STALL_MS = 75_000;
/** Verification is seconds of work; minutes of it means something died. */
const VERIFY_STALL_MS = 150_000;

type Phase =
  | "starting"
  | "waiting_worker"
  | "initializing"
  | "awaiting_user"
  | "submitting_code"
  | "finishing"
  | "connected"
  | "failed";

/** The §10 checklist: which of the five steps are done/current at a phase. */
function checklistPosition(phase: Phase): number {
  switch (phase) {
    case "starting": return 0;
    case "waiting_worker": return 0;
    case "initializing": return 1;
    case "awaiting_user": return 2;
    case "submitting_code": return 2;
    case "finishing": return 3;
    case "connected": return 4;
    default: return 0;
  }
}

function ProgressChecklist({ phase, providerLabel }: { phase: Phase; providerLabel: string }) {
  const steps = [
    "Preparing connection",
    `${providerLabel} opened`,
    "Waiting for sign-in",
    "Verifying account",
    "Ready",
  ];
  const position = checklistPosition(phase);
  return (
    <ol className="mt-4 space-y-2" aria-label="Connection progress">
      {steps.map((step, index) => {
        const done = index < position || phase === "connected";
        const current = index === position && phase !== "connected";
        return (
          <li key={step} className="flex items-center gap-2.5 text-sm">
            {done ? (
              <Check className="size-4 shrink-0 text-emerald-500" aria-hidden="true" />
            ) : current ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-[var(--accent-text)]" aria-hidden="true" />
            ) : (
              <span className="grid size-4 shrink-0 place-items-center" aria-hidden="true">
                <span className="size-2 rounded-full border border-[var(--border)]" />
              </span>
            )}
            <span className={cn(
              done ? "text-[var(--text)]" : current ? "font-medium text-[var(--text)]" : "text-[var(--text-muted)]",
            )}>
              {step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function AiAccountConnect({
  providerId,
  providerLabel,
  accountId,
  onConnected,
  onFallback,
  onUnavailable,
  onClose,
  onBeforeCloseChange,
}: AiAccountConnectProps) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [session, setSession] = useState<SessionView | null>(null);
  const [code, setCode] = useState("");
  const [codeCopied, setCodeCopied] = useState(false);
  const [notice, setNotice] = useState("");
  const [failureDetail, setFailureDetail] = useState("");
  const [stalled, setStalled] = useState(false);
  const [verifyStalled, setVerifyStalled] = useState(false);
  // Set when start() runs; 0 only before the first attempt.
  const startedAtRef = useRef(0);
  // Set when verification begins; a verification that outlives its window
  // is reported rather than spun on.
  const verifyingSinceRef = useRef(0);
  const pollRef = useRef<number | null>(null);
  const copyResetRef = useRef<number | null>(null);
  const doneRef = useRef(false);
  const mountedRef = useRef(false);
  const activeSessionIdRef = useRef<string | null>(null);
  // Starts, retries, and closes are one lifecycle. Serializing them prevents a
  // close from cancelling yesterday's id while a retry creates tomorrow's.
  const lifecycleTailRef = useRef<Promise<void>>(Promise.resolve());
  const generationRef = useRef(0);
  const closeRequestedRef = useRef(false);
  const restartPromiseRef = useRef<Promise<boolean> | null>(null);
  const closePromiseRef = useRef<Promise<boolean> | null>(null);
  const cancelActionPromiseRef = useRef<Promise<void> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const clearCopyReset = useCallback(() => {
    if (copyResetRef.current !== null) {
      window.clearTimeout(copyResetRef.current);
      copyResetRef.current = null;
    }
  }, []);

  const runLifecycle = useCallback((operation: () => Promise<boolean>): Promise<boolean> => {
    const result = lifecycleTailRef.current.then(operation, operation);
    lifecycleTailRef.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }, []);

  const isCurrentSession = useCallback((sessionId: string, generation: number) => (
    mountedRef.current
    && !closeRequestedRef.current
    && !doneRef.current
    && generationRef.current === generation
    && activeSessionIdRef.current === sessionId
  ), []);

  const readSession = useCallback(async (sessionId: string, generation: number) => {
    if (!isCurrentSession(sessionId, generation)) return;
    try {
      const response = await fetch(`/api/ai-accounts/sessions/${sessionId}`, { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { session?: SessionView };
      const view = body.session;
      // A response from an old poll can arrive after retry/close. It is never
      // allowed to change the visible session or invoke the connected hook.
      if (!view || view.id !== sessionId || !isCurrentSession(sessionId, generation)) return;
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
          if (verifyingSinceRef.current === 0) verifyingSinceRef.current = Date.now();
          setVerifyStalled(Date.now() - verifyingSinceRef.current > VERIFY_STALL_MS);
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
          // Calm and actionable; the stored reason is technical detail.
          setNotice(
            view.status === "expired"
              ? "The sign-in ran out of time."
              : "We couldn't finish signing you in. Your account wasn't changed.",
          );
          setFailureDetail(view.failureReason ?? "");
          setPhase("failed");
          break;
        default:
          break;
      }
    } catch {
      // A dropped poll is not a failed sign-in; the next tick answers.
    }
  }, [isCurrentSession, onConnected, stopPolling]);

  const startNow = useCallback(async (): Promise<boolean> => {
      if (!mountedRef.current || closeRequestedRef.current) return true;

      const generation = generationRef.current + 1;
      generationRef.current = generation;
      doneRef.current = false;
      activeSessionIdRef.current = null;
      startedAtRef.current = Date.now();
      verifyingSinceRef.current = 0;
      clearCopyReset();
      setVerifyStalled(false);
      setPhase("starting");
      setSession(null);
      setNotice("");
      setFailureDetail("");
      setCode("");
      setCodeCopied(false);
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
          resumed?: boolean;
          error?: { message?: string };
        };
        if (!response.ok || !body.sessionId) {
          if (
            !mountedRef.current
            || closeRequestedRef.current
            || generationRef.current !== generation
          ) return true;
          // Could not even start: the connection backend is not available
          // here. A person who clicked one button must not meet an error for
          // it — degrade to the caller's own path when one exists.
          if (onUnavailable) {
            doneRef.current = true;
            onUnavailable();
            return true;
          }
          setNotice("We couldn't finish signing you in. Your account wasn't changed.");
          setFailureDetail(body.error?.message ?? "");
          setPhase("failed");
          return false;
        }
        const sessionId = body.sessionId;
        // Even if the component closed while POST was in flight, retain the
        // returned id for the already-queued cleanup to cancel exactly.
        activeSessionIdRef.current = sessionId;
        if (
          !mountedRef.current
          || closeRequestedRef.current
          || generationRef.current !== generation
        ) return true;
        setPhase("waiting_worker");
        stopPolling();
        pollRef.current = window.setInterval(
          () => void readSession(sessionId, generation),
          POLL_MS,
        );
        void readSession(sessionId, generation);
        return true;
      } catch {
        if (
          !mountedRef.current
          || closeRequestedRef.current
          || generationRef.current !== generation
        ) return true;
        if (onUnavailable) {
          doneRef.current = true;
          onUnavailable();
          return true;
        }
        setNotice("We couldn't finish signing you in. Your account wasn't changed.");
        setPhase("failed");
        return false;
      }
  }, [accountId, clearCopyReset, onUnavailable, providerId, readSession, stopPolling]);

  const cancelCurrentSession = useCallback(async (silent = false): Promise<boolean> => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return true;

    try {
      const response = await fetch(`/api/ai-accounts/sessions/${sessionId}/cancel`, {
        method: "POST",
        keepalive: true,
      });
      if (response.ok) {
        if (activeSessionIdRef.current === sessionId) activeSessionIdRef.current = null;
        return true;
      }
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!silent && mountedRef.current) {
        setNotice(
          `The sign-in is still active because it could not be cancelled.${
            body.error?.message ? ` ${body.error.message}` : " Try again."
          }`,
        );
      }
      return false;
    } catch {
      if (!silent && mountedRef.current) {
        setNotice("The sign-in is still active because it could not be cancelled. Try again.");
      }
      return false;
    }
  }, []);

  const resumeActivePolling = useCallback(() => {
    const sessionId = activeSessionIdRef.current;
    if (
      !sessionId
      || !mountedRef.current
      || closeRequestedRef.current
      || doneRef.current
    ) return;

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    stopPolling();
    pollRef.current = window.setInterval(
      () => void readSession(sessionId, generation),
      POLL_MS,
    );
    void readSession(sessionId, generation);
  }, [readSession, stopPolling]);

  const prepareToClose = useCallback((): Promise<boolean> => {
    // Synchronous intent closes the retry gate even before this operation
    // reaches the head of the lifecycle queue.
    closeRequestedRef.current = true;
    if (closePromiseRef.current) return closePromiseRef.current;

    const operation = runLifecycle(async () => {
      if (!(await cancelCurrentSession())) {
        closeRequestedRef.current = false;
        resumeActivePolling();
        return false;
      }
      stopPolling();
      clearCopyReset();
      doneRef.current = true;
      generationRef.current += 1;
      activeSessionIdRef.current = null;
      return true;
    });
    closePromiseRef.current = operation;
    void operation.then(
      () => {
        if (closePromiseRef.current === operation) closePromiseRef.current = null;
      },
      () => {
        closeRequestedRef.current = false;
        if (closePromiseRef.current === operation) closePromiseRef.current = null;
      },
    );
    return operation;
  }, [cancelCurrentSession, clearCopyReset, resumeActivePolling, runLifecycle, stopPolling]);

  useEffect(() => {
    mountedRef.current = true;
    closeRequestedRef.current = false;
    // Deferred a tick so the effect body itself sets no state — the kick-off
    // is async work, not render logic. Deliberately once: this component
    // mounts to run one sign-in.
    const kickoff = window.setTimeout(() => void runLifecycle(startNow), 0);
    return () => {
      window.clearTimeout(kickoff);
      mountedRef.current = false;
      closeRequestedRef.current = true;
      doneRef.current = true;
      generationRef.current += 1;
      stopPolling();
      clearCopyReset();
      // A parent navigation can bypass its optional guard. Queue a silent,
      // keepalive cancellation; if POST /connect is in flight, this runs after
      // it stores the exact returned id.
      void runLifecycle(() => cancelCurrentSession(true));
    };
    // This is intentionally one broker lifecycle per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onBeforeCloseChange?.(prepareToClose);
    return () => onBeforeCloseChange?.(null);
  }, [onBeforeCloseChange, prepareToClose]);

  const cancel = useCallback((): Promise<void> => {
    if (cancelActionPromiseRef.current) return cancelActionPromiseRef.current;
    const operation = (async () => {
      if (!(await prepareToClose())) return;
      onClose();
    })();
    cancelActionPromiseRef.current = operation;
    void operation.then(
      () => {
        if (cancelActionPromiseRef.current === operation) cancelActionPromiseRef.current = null;
      },
      () => {
        if (cancelActionPromiseRef.current === operation) cancelActionPromiseRef.current = null;
      },
    );
    return operation;
  }, [onClose, prepareToClose]);

  /** A retry is a new broker session, never a resumed stalled one. */
  const restart = useCallback((): Promise<boolean> => {
    if (restartPromiseRef.current) return restartPromiseRef.current;

    const operation = runLifecycle(async () => {
      if (!mountedRef.current || closeRequestedRef.current) return true;
      stopPolling();
      clearCopyReset();
      setCodeCopied(false);
      doneRef.current = true;
      generationRef.current += 1;
      if (!(await cancelCurrentSession())) {
        doneRef.current = false;
        resumeActivePolling();
        return false;
      }
      if (!mountedRef.current || closeRequestedRef.current) return true;
      setSession(null);
      return startNow();
    });
    restartPromiseRef.current = operation;
    void operation.then(
      () => {
        if (restartPromiseRef.current === operation) restartPromiseRef.current = null;
      },
      () => {
        if (restartPromiseRef.current === operation) restartPromiseRef.current = null;
      },
    );
    return operation;
  }, [cancelCurrentSession, clearCopyReset, resumeActivePolling, runLifecycle, startNow, stopPolling]);

  const submitCode = useCallback(async () => {
    const sessionId = session?.id;
    const generation = generationRef.current;
    const trimmed = code.trim();
    if (!sessionId || !trimmed || !isCurrentSession(sessionId, generation)) return;
    setPhase("submitting_code");
    try {
      const response = await fetch(`/api/ai-accounts/sessions/${sessionId}/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      if (!isCurrentSession(sessionId, generation)) return;
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        if (!isCurrentSession(sessionId, generation)) return;
        setNotice(body.error?.message ?? "The code was not accepted. Try pasting it again.");
        setPhase("awaiting_user");
        return;
      }
      setCode("");
      setPhase("finishing");
    } catch {
      if (!isCurrentSession(sessionId, generation)) return;
      setNotice("The code could not be sent. Try again.");
      setPhase("awaiting_user");
    }
  }, [code, isCurrentSession, session]);

  const copyDeviceCode = useCallback((deviceCode: string, sessionId: string) => {
    const generation = generationRef.current;
    if (!isCurrentSession(sessionId, generation) || !navigator.clipboard) return;
    void navigator.clipboard.writeText(deviceCode).then(
      () => {
        if (!isCurrentSession(sessionId, generation)) return;
        clearCopyReset();
        setCodeCopied(true);
        copyResetRef.current = window.setTimeout(() => {
          copyResetRef.current = null;
          if (isCurrentSession(sessionId, generation)) setCodeCopied(false);
        }, 2_000);
      },
      () => undefined,
    );
  }, [clearCopyReset, isCurrentSession]);

  if (phase === "connected") {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-500/10">
          <Check className="size-6 text-emerald-500" aria-hidden="true" />
        </span>
        <h3 className="mt-3 text-lg font-semibold text-[var(--text)]">
          {providerLabel} connected
        </h3>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Your {providerLabel} account is ready to use.
        </p>
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
        <h3 className="text-lg font-semibold text-[var(--text)]">
          We couldn&apos;t finish signing you in
        </h3>
        <p className="mt-1 text-sm text-[var(--text-muted)]" role="alert">
          {notice || "Your account wasn't changed."}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => void restart()} className="btn btn-primary">
            Try Again
          </button>
          <button type="button" onClick={() => void cancel()} className="btn btn-secondary">
            Cancel
          </button>
        </div>
        {failureDetail ? (
          <details className="mt-4 text-left">
            <summary className="cursor-pointer text-xs text-[var(--text-muted)]">
              View technical details
            </summary>
            <p className="mt-2 rounded-lg bg-[var(--surface-inset)] p-3 text-xs text-[var(--text-muted)]">
              {failureDetail}
            </p>
            <button
              type="button"
              onClick={onFallback}
              className="btn btn-secondary btn-sm mt-2"
            >
              Use the developer connection instead
            </button>
          </details>
        ) : null}
      </div>
    );
  }

  // A verification that outlives its window means the service driving it
  // died mid-flight. Spinning would be a lie; say so, and offer the honest
  // restart — a fresh session, since this one cannot finish.
  if (verifyStalled && phase === "finishing") {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
        <h3 className="text-lg font-semibold text-[var(--text)]">
          Verification didn&apos;t finish
        </h3>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Your {providerLabel} sign-in went through, but the final check stopped
          responding. Nothing was changed — trying again starts a fresh sign-in.
        </p>
        {notice ? (
          <p className="mt-2 text-sm text-amber-600" role="alert">{notice}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => void restart()}
            className="btn btn-primary"
          >
            Try Again
          </button>
          <button type="button" onClick={() => void cancel()} className="btn btn-secondary">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // A worker that never picks the session up must not read as progress. After
  // the stall window the spinner stops pretending: what happened, that
  // nothing broke, and the two honest moves.
  if (stalled && phase === "waiting_worker") {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
        <h3 className="text-lg font-semibold text-[var(--text)]">
          {providerLabel} sign-in isn&apos;t responding yet
        </h3>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          The secure service that runs {providerLabel} sign-ins hasn&apos;t picked this up.
          Nothing was changed — you can try again, or come back in a few minutes.
        </p>
        {notice ? (
          <p className="mt-2 text-sm text-amber-600" role="alert">{notice}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => void restart()} className="btn btn-primary">
            Try Again
          </button>
          <button type="button" onClick={() => void cancel()} className="btn btn-secondary">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const waitingForCode = phase === "awaiting_user" || phase === "submitting_code";
  // A device-code login carries its one-time code in the login URL's
  // fragment; when present, the person types that code on the provider's own
  // page and nothing is ever pasted back here.
  const deviceLogin = session?.loginUrl ? parseDeviceLogin(session.loginUrl) : null;
  const deviceCode = deviceLogin?.userCode ?? null;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <h3 className="text-lg font-semibold text-[var(--text)]">
        Connecting {providerLabel}
      </h3>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        {waitingForCode
          ? deviceCode
            ? `Open the ${providerLabel} sign-in page, enter the code shown below, and approve. This finishes on its own.`
            : "Complete sign-in in the secure browser window, then paste the confirmation code below."
          : "This completes on its own — no steps to run."}
      </p>

      <ProgressChecklist phase={phase} providerLabel={providerLabel} />

      {waitingForCode && session?.loginUrl ? (
        <a
          href={deviceLogin?.url ?? session.loginUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="btn btn-primary mt-4 inline-flex items-center gap-1.5"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          Open {providerLabel} Sign-In
        </a>
      ) : null}

      {waitingForCode && deviceCode ? (
        <div className="mt-3">
          <p className="text-xs text-[var(--text-muted)]">Enter this one-time code:</p>
          <div className="mt-1 flex items-center gap-2">
            <p
              className="inline-block rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-2 font-mono text-xl font-semibold tracking-widest text-[var(--text)]"
              aria-label={`One-time code ${deviceCode}`}
            >
              {deviceCode}
            </p>
            <button
              type="button"
              onClick={() => session && copyDeviceCode(deviceCode, session.id)}
              className="btn btn-secondary btn-sm"
            >
              {codeCopied ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : (
                <Copy className="size-3.5" aria-hidden="true" />
              )}
              {codeCopied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 max-w-sm text-xs text-[var(--text-muted)]">
            First time? {providerLabel} may ask you to enable device code
            authorization — turn it on under ChatGPT Settings → Security,
            then Cancel here and connect again.
          </p>
        </div>
      ) : null}

      {waitingForCode && !deviceCode ? (
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
            className="w-72 max-w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--text)]"
          />
          <button
            type="button"
            onClick={() => void submitCode()}
            disabled={phase === "submitting_code" || code.trim().length === 0}
            className="btn btn-primary"
          >
            {phase === "submitting_code" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            Finish connecting
          </button>
        </div>
      ) : null}

      {notice ? (
        <p className="mt-2 text-xs text-amber-600" role="alert">{notice}</p>
      ) : null}

      <div className="mt-4">
        <button type="button" onClick={() => void cancel()} className="btn btn-secondary btn-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}
