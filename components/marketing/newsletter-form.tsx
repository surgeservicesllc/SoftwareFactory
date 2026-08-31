"use client";

import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { useId, useState } from "react";

type State = { kind: "idle" | "pending" | "done" | "error"; message: string };

/**
 * Newsletter subscribe.
 *
 * The endpoint answers identically for a new and an already-known address, so
 * this form is not an account-enumeration oracle. It therefore always reports
 * success in the same words.
 */
export function NewsletterForm({ source = "resources" }: { source?: string }) {
  const inputId = useId();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle", message: "" });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ kind: "pending", message: "" });

    try {
      const response = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), source }),
      });
      const body = (await response.json()) as { error?: { message?: string } };

      if (!response.ok) {
        setState({
          kind: "error",
          message: body.error?.message ?? "That subscription could not be completed.",
        });
        return;
      }

      setEmail("");
      setState({ kind: "done", message: "You're subscribed. Look out for the next issue." });
    } catch {
      setState({ kind: "error", message: "That subscription could not be completed." });
    }
  }

  return (
    <form onSubmit={submit} className="mt-5">
      <label htmlFor={inputId} className="sr-only">
        Email address
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={inputId}
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Enter your email address"
          autoComplete="email"
          maxLength={254}
          // `flex-1` is `flex: 1 1 0%` along the container's main axis. This
          // container is a column below `sm`, so on a phone that axis was the
          // height: `flex-1` overrode `h-11` and collapsed the field to the
          // 18px of its own text. It only means "share the row" from `sm` up,
          // which is the only place the container is a row.
          className="h-11 min-w-0 rounded-xl border border-line-strong bg-surface-inset px-4 text-sm text-foreground placeholder:text-faint focus:border-[var(--site-accent)] focus:outline-none sm:flex-1"
        />
        <button
          type="submit"
          disabled={state.kind === "pending" || email.trim().length === 0}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#7c5cff] to-[#4d8dff] px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.kind === "pending" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          Subscribe
        </button>
      </div>

      <p className="mt-3 flex items-center gap-2 text-xs text-faint" aria-live="polite">
        {state.kind === "done" ? (
          <>
            <CheckCircle2 className="size-4 shrink-0 text-[#34d399]" aria-hidden="true" />
            {state.message}
          </>
        ) : state.kind === "error" ? (
          <span className="text-[#ff9ba1]">{state.message}</span>
        ) : (
          <>
            <ShieldCheck className="size-4 shrink-0 text-[#34d399]" aria-hidden="true" />
            No spam. Unsubscribe anytime.
          </>
        )}
      </p>
    </form>
  );
}
