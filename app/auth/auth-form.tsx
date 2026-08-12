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
    initialError ? "The authentication callback could not be verified." : "",
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
          "If the account exists, a one-time sign-in link has been sent.",
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
    const body = {
      displayName: mode === "sign-up" ? String(form.get("displayName") ?? "") : undefined,
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      returnTo: mode === "sign-in" ? returnTo : undefined,
    };

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
        setError(result.error?.message ?? "The request could not be completed.");
        return;
      }

      if (result.confirmationRequired) {
        setMessage("Check your email to confirm your account before signing in.");
        return;
      }

      router.push(result.next ?? "/");
      router.refresh();
    } catch {
      setError("Authentication is temporarily unavailable.");
    } finally {
      setPending(false);
    }
  }

  const signingUp = mode === "sign-up";

  return (
    <div className="mx-auto max-w-md py-8 sm:py-16">
      <div className="panel rounded-xl p-5 sm:p-7">
        <p className="eyebrow">Supabase authentication</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white">
          {signingUp ? "Create your control-plane account" : "Sign in to SoftwareFactory"}
        </h1>
        <p className="mt-2 text-xs leading-5 text-[#7f8b9a]">
          Sessions are verified server-side. Organization and project access remains tenant-scoped by Row Level Security.
        </p>

        {error ? (
          <p role="alert" className="mt-5 rounded-lg border border-[#533036] bg-[#26171a] px-3.5 py-3 text-xs text-[#f0a1a8]">
            {error}
          </p>
        ) : null}
        {message ? (
          <p role="status" className="mt-5 rounded-lg border border-[#3d4827] bg-[#1b2112] px-3.5 py-3 text-xs text-[#d7ed91]">
            {message}
          </p>
        ) : null}

        <form className="mt-6 space-y-4" onSubmit={submit}>
          {signingUp ? (
            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold text-[#aeb7c2]">Display name</span>
              <input
                autoComplete="name"
                className="h-11 w-full rounded-lg border border-[#2b3644] bg-[#0a0f16] px-3 text-sm text-[#dce2e8] focus:border-[#647f29] focus:outline-none"
                maxLength={120}
                name="displayName"
                required
              />
            </label>
          ) : null}

          <label className="block">
            <span className="mb-2 block text-[11px] font-semibold text-[#aeb7c2]">Email</span>
            <input
              autoComplete="email"
              className="h-11 w-full rounded-lg border border-[#2b3644] bg-[#0a0f16] px-3 text-sm text-[#dce2e8] focus:border-[#647f29] focus:outline-none"
              maxLength={254}
              name="email"
              ref={emailRef}
              required
              type="email"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-[11px] font-semibold text-[#aeb7c2]">Password</span>
            <input
              autoComplete={signingUp ? "new-password" : "current-password"}
              className="h-11 w-full rounded-lg border border-[#2b3644] bg-[#0a0f16] px-3 text-sm text-[#dce2e8] focus:border-[#647f29] focus:outline-none"
              maxLength={128}
              minLength={signingUp ? 12 : 8}
              name="password"
              required
              type="password"
            />
            {signingUp ? (
              <span className="mt-2 block text-[10px] leading-4 text-[#687586]">
                Use at least 12 characters with letters and numbers.
              </span>
            ) : null}
          </label>

          <button
            className="min-h-11 w-full rounded-lg bg-[#c6f135] px-4 text-xs font-bold text-[#0b1003] disabled:cursor-wait disabled:opacity-60"
            disabled={pending}
            type="submit"
          >
            {pending ? "Verifying…" : signingUp ? "Create account" : "Sign in"}
          </button>

          {!signingUp ? (
            <button
              className="min-h-11 w-full rounded-lg border border-[#34411c] bg-[#c6f135]/[0.07] px-4 text-xs font-semibold text-[#dffb7b] disabled:cursor-wait disabled:opacity-60"
              disabled={pending}
              onClick={sendMagicLink}
              type="button"
            >
              Email me a one-time sign-in link
            </button>
          ) : null}
        </form>

        <p className="mt-5 text-center text-xs text-[#7f8b9a]">
          {signingUp ? "Already have an account?" : "Need an account?"}{" "}
          <Link className="font-semibold text-[#dffb7b] underline underline-offset-4" href={signingUp ? "/auth/sign-in" : "/auth/sign-up"}>
            {signingUp ? "Sign in" : "Create one"}
          </Link>
        </p>
      </div>
    </div>
  );
}
