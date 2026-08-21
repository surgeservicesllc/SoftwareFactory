"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function OnboardingForm({
  returnTo = "/solutions/projects",
}: {
  /** Where to land after the workspace exists. Validated by the page. */
  returnTo?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    const form = new FormData(event.currentTarget);
    const organizationSlug = String(form.get("organizationSlug") ?? "").trim();

    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationName: String(form.get("organizationName") ?? ""),
          organizationSlug: organizationSlug || undefined,
        }),
      });
      const result = (await response.json()) as {
        error?: { code?: string; message?: string };
      };

      if (!response.ok) {
        if (response.status === 401) {
          router.push("/auth/sign-in?next=/auth/onboarding");
          return;
        }
        setError(result.error?.message ?? "Your workspace could not be created.");
        return;
      }

      router.push(returnTo);
      router.refresh();
    } catch {
      setError("Setup is temporarily unavailable. Try again shortly.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-md py-8 sm:py-16">
      <div className="card p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
          Name your workspace
        </h1>
        <p className="mt-2 text-muted">
          This groups your projects and connections, and keeps them separate from everyone else&apos;s.
          You become its owner.
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-5 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-surface)] px-4 py-3 text-sm text-[var(--danger)]"
          >
            {error}
          </p>
        ) : null}

        <form className="mt-6 space-y-4" onSubmit={submit}>
          <div>
            <label htmlFor="organization-name" className="field-label">Workspace name</label>
            <input
              id="organization-name"
              autoComplete="organization"
              className="input"
              maxLength={120}
              name="organizationName"
              placeholder="Acme Engineering"
              required
            />
          </div>

          <div>
            <label htmlFor="organization-slug" className="field-label">
              Short name <span className="font-normal text-faint">(optional)</span>
            </label>
            <input
              id="organization-slug"
              autoCapitalize="none"
              autoCorrect="off"
              className="input"
              maxLength={63}
              name="organizationSlug"
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              placeholder="acme-engineering"
            />
            <span className="field-hint">
              Leave blank and we will pick one. Lowercase letters, numbers, and hyphens only.
            </span>
          </div>

          <button className="btn btn-primary w-full" disabled={pending} type="submit">
            {pending ? "Creating…" : "Create workspace"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Not signed in?{" "}
          <Link
            className="font-medium text-accent-text underline underline-offset-4"
            href="/auth/sign-in?next=/auth/onboarding"
          >
            Sign in first
          </Link>
        </p>
      </div>
    </div>
  );
}
