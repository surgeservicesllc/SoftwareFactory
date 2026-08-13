"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

type AuthFormProps = {
  checkEmail?: boolean;
  initialError?: boolean;
  mode: "sign-in" | "sign-up";
  returnTo?: string;
};

type ErrorBody = { error?: { message?: string } };

export function AuthForm({
  checkEmail = false,
  initialError = false,
  mode,
  returnTo,
}: AuthFormProps) {
  const router = useRouter();
  const [error, setError] = useState(
    initialError ? "That sign-in link could not be verified. Try again." : "",
  );
  const [message, setMessage] = useState(
    checkEmail ? "Check your email to confirm your account, then sign in." : "",
  );
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  async function sendMagicLink() {
    const email = emailRef.current?.value.trim() ?? "";
    if (!email) {
      setError("Enter your email address first.");
      return;
    }

    setError("");
    setMessage("");
    setPending(true);

    try {
      const response = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, returnTo }),
      });
      const result = (await response.json()) as ErrorBody & { message?: string };
      if (!response.ok) {
        setError(result.error?.message ?? "A sign-in link could not be sent.");
        return;
      }

      setMessage(
        result.message ??
          "If that account exists, a one-time sign-in link is on its way.",
      );
    } catch {
      setError("A sign-in link could not be sent.");
    } finally {
      setPending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setPending(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const body = mode === "sign-up"
      ? { displayName: String(form.get("displayName") ?? ""), email, password }
      : { email, password, returnTo };

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as ErrorBody & {
        confirmationRequired?: boolean;
        next?: string;
      };

      if (!response.ok) {
        setError(result.error?.message ?? "That did not work. Check your details and try again.");
        return;
      }

      if (result.confirmationRequired) {
        setMessage("Check your email to confirm your account before signing in.");
        return;
      }

      router.push(result.next ?? "/");
      router.refresh();
    } catch {
      setError("Sign-in is temporarily unavailable. Try again shortly.");
    } finally {
      setPending(false);
    }
  }

  const signingUp = mode === "sign-up";

  return (
    <div className="mx-auto max-w-md py-8 sm:py-16">
      <div className="card p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
          {signingUp ? "Create your account" : "Sign in"}
        </h1>
        <p className="mt-2 text-muted">
          {signingUp
            ? "You will be the owner of your workspace."
            : "Welcome back to SoftwareFactory."}
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-5 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-surface)] px-4 py-3 text-sm text-[var(--danger)]"
          >
            {error}
          </p>
        ) : null}
        {message ? (
          <p
            role="status"
            className="mt-5 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-surface)] px-4 py-3 text-sm text-[var(--accent-text)]"
          >
            {message}
          </p>
        ) : null}

        <form className="mt-6 space-y-4" onSubmit={submit}>
          {signingUp ? (
            <div>
              <label htmlFor="auth-name" className="field-label">Your name</label>
              <input
                id="auth-name"
                autoComplete="name"
                className="input"
                maxLength={120}
                name="displayName"
                required
              />
            </div>
          ) : null}

          <div>
            <label htmlFor="auth-email" className="field-label">Email</label>
            <input
              id="auth-email"
              autoComplete="email"
              className="input"
              maxLength={254}
              name="email"
              ref={emailRef}
              required
              type="email"
            />
          </div>

          <div>
            <label htmlFor="auth-password" className="field-label">Password</label>
            <input
              id="auth-password"
              autoComplete={signingUp ? "new-password" : "current-password"}
              className="input"
              maxLength={128}
              minLength={signingUp ? 12 : 8}
              name="password"
              required
              type="password"
            />
            {signingUp ? (
              <span className="field-hint">At least 12 characters.</span>
            ) : null}
          </div>

          <button className="btn btn-primary w-full" disabled={pending} type="submit">
            {pending ? "Just a moment…" : signingUp ? "Create account" : "Sign in"}
          </button>

          {!signingUp ? (
            <button
              className="btn btn-secondary w-full"
              disabled={pending}
              onClick={sendMagicLink}
              type="button"
            >
              Email me a sign-in link instead
            </button>
          ) : null}
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          {signingUp ? "Already have an account?" : "Need an account?"}{" "}
          <Link
            className="font-medium text-accent-text underline underline-offset-4"
            href={signingUp ? "/auth/sign-in" : "/auth/sign-up"}
          >
            {signingUp ? "Sign in" : "Create one"}
          </Link>
        </p>
      </div>
    </div>
  );
}
