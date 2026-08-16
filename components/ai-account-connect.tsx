"use client";

import { Check, ExternalLink, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

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
}: AiAccountConnectProps) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [session, setSession] = useState<SessionView | null>(null);
  const [code, setCode] = useState("");
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
  }, [onConnected, stopPolling]);

  const start = useCallback(async () => {
    doneRef.current = false;
    startedAtRef.current = Date.now();
    verifyingSinceRef.current = 0;
    setVerifyStalled(false);
    setPhase("starting");
    setNotice("");
    setFailureDetail("");
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
        resumed?: boolean;
        error?: { message?: string };
      };
      if (!response.ok || !body.sessionId) {
        // Could not even start: the connection backend is not available
        // here. A person who clicked one button must not meet an error for
        // it — degrade to the caller's own path when one exists.
        if (onUnavailable) {
          doneRef.current = true;
          onUnavailable();
          return;
        }
        setNotice("We couldn't finish signing you in. Your account wasn't changed.");
        setFailureDetail(body.error?.message ?? "");
        setPhase("failed");
        return;
      }
      setPhase("waiting_worker");
      const sessionId = body.sessionId;
      stopPolling();
      pollRef.current = window.setInterval(() => void readSession(sessionId), POLL_MS);
      void readSession(sessionId);
    } catch {
      if (onUnavailable) {
        doneRef.current = true;
        onUnavailable();
        return;
      }
      setNotice("We couldn't finish signing you in. Your account wasn't changed.");
      setPhase("failed");
    }
  }, [accountId, onUnavailable, providerId, readSession, stopPolling]);

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
        setNotice(body.error?.message ?? "The code was not accepted. Try pasting it again.");
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
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {notice || "Your account wasn't changed."}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => void start()} className="btn btn-primary">
            Try Again
          </button>
          <button type="button" onClick={() => void cancel()} className="btn btn-secondary">
            Close
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
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              verifyingSinceRef.current = 0;
              setVerifyStalled(false);
              void (async () => {
                const sessionId = session?.id;
                if (sessionId) {
                  await fetch(`/api/ai-accounts/sessions/${sessionId}/cancel`, { method: "POST" })
                    .catch(() => undefined);
                }
                await start();
              })();
            }}
            className="btn btn-primary"
          >
            Try Again
          </button>
          <button type="button" onClick={() => void cancel()} className="btn btn-secondary">
            Close
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
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => void start()} className="btn btn-primary">
            Try Again
          </button>
          <button type="button" onClick={() => void cancel()} className="btn btn-secondary">
            Close
          </button>
        </div>
      </div>
    );
  }

  const waitingForCode = phase === "awaiting_user" || phase === "submitting_code";

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <h3 className="text-lg font-semibold text-[var(--text)]">
        Connecting {providerLabel}
      </h3>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        {waitingForCode
          ? providerId === "openai"
            ? "Complete sign-in in the secure browser window. It will end on a page that cannot load — that is expected. Copy that page's full web address and paste it below."
            : "Complete sign-in in the secure browser window, then paste the confirmation code below."
          : "This completes on its own — no steps to run."}
      </p>

      <ProgressChecklist phase={phase} providerLabel={providerLabel} />

      {waitingForCode && session?.loginUrl ? (
        <a
          href={session.loginUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="btn btn-primary mt-4 inline-flex items-center gap-1.5"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          Open {providerLabel} Sign-In
        </a>
      ) : null}

      {waitingForCode ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`relay-code-${providerId}`}>
            Confirmation code from {providerLabel}
          </label>
          <input
            id={`relay-code-${providerId}`}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder={providerId === "openai"
              ? "Paste the final page's web address here"
              : "Paste the confirmation code here"}
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

      {notice && waitingForCode ? (
        <p className="mt-2 text-xs text-amber-600" aria-live="polite">{notice}</p>
      ) : null}

      <div className="mt-4">
        <button type="button" onClick={() => void cancel()} className="btn btn-secondary btn-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}
