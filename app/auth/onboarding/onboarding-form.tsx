"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function OnboardingForm() {
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
        setError(result.error?.message ?? "Organization onboarding failed.");
        return;
      }

      router.push("/projects");
      router.refresh();
    } catch {
      setError("Supabase onboarding is temporarily unavailable.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl py-8 sm:py-16">
      <div className="panel rounded-xl p-5 sm:p-7">
        <p className="eyebrow">Authenticated onboarding</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white">
          Create your organization
        </h1>
        <p className="mt-2 text-xs leading-5 text-[#7f8b9a]">
          This establishes the first tenant boundary and makes you its owner. The server verifies your Supabase session; RLS scopes every subsequent read and write.
        </p>

        {error ? (
          <p role="alert" className="mt-5 rounded-lg border border-[#533036] bg-[#26171a] px-3.5 py-3 text-xs text-[#f0a1a8]">
            {error}
          </p>
        ) : null}

        <form className="mt-6 space-y-4" onSubmit={submit}>
          <label className="block">
            <span className="mb-2 block text-[11px] font-semibold text-[#aeb7c2]">Organization name</span>
            <input
              autoComplete="organization"
              className="h-11 w-full rounded-lg border border-[#2b3644] bg-[#0a0f16] px-3 text-sm text-[#dce2e8] focus:border-[#647f29] focus:outline-none"
              maxLength={120}
              name="organizationName"
              placeholder="Acme Engineering"
              required
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-[11px] font-semibold text-[#aeb7c2]">Organization slug <span className="font-normal text-[#687586]">(optional)</span></span>
            <input
              autoCapitalize="none"
              autoCorrect="off"
              className="h-11 w-full rounded-lg border border-[#2b3644] bg-[#0a0f16] px-3 font-mono text-sm text-[#dce2e8] focus:border-[#647f29] focus:outline-none"
              maxLength={63}
              name="organizationSlug"
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              placeholder="acme-engineering"
            />
            <span className="mt-2 block text-[10px] leading-4 text-[#687586]">
              Leave blank for a deterministic private default. Slugs contain lowercase letters, numbers, and single hyphens.
            </span>
          </label>

          <button
            className="min-h-11 w-full rounded-lg bg-[#c6f135] px-4 text-xs font-bold text-[#0b1003] disabled:cursor-wait disabled:opacity-60"
            disabled={pending}
            type="submit"
          >
            {pending ? "Creating tenant…" : "Create organization"}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-[#7f8b9a]">
          Not signed in?{" "}
          <Link className="font-semibold text-[#dffb7b] underline underline-offset-4" href="/auth/sign-in?next=/auth/onboarding">
            Sign in first
          </Link>
        </p>
      </div>
    </div>
  );
}
