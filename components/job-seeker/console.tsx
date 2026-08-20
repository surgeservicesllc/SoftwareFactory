"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { JobSeekerApplicationsPanel } from "@/components/job-seeker/applications-panel";
import { JobSeekerJobsPanel } from "@/components/job-seeker/jobs-panel";
import { JobSeekerPreferencesForm, type PreferencesView } from "@/components/job-seeker/preferences-form";
import { JobSeekerProfileForm, type ProfileView } from "@/components/job-seeker/profile-form";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * The Job Seeker command center. The page above this component is hard-gated
 * server-side, so this renders for signed-in people only; every read and
 * write below still goes through RLS that scopes rows to the person.
 *
 * Increment 1 carries the source of truth: the career profile and the job
 * preferences, full CRUD. The later lanes — discovery, applications,
 * analytics — render their honest current state and name the next step,
 * never a mockup of one.
 */

type SectionKey = "profile" | "preferences" | "discovery" | "applications" | "analytics";

const SECTIONS: ReadonlyArray<{ key: SectionKey; label: string }> = [
  { key: "profile", label: "Career Profile" },
  { key: "preferences", label: "Job Preferences" },
  { key: "discovery", label: "Job Discovery" },
  { key: "applications", label: "Applications" },
  { key: "analytics", label: "Analytics" },
];

type State = "loading" | "ready" | "error";

export function JobSeekerConsole() {
  const searchParams = useSearchParams();
  const requested = searchParams.get("section");
  const section: SectionKey = SECTIONS.some((entry) => entry.key === requested)
    ? (requested as SectionKey)
    : "profile";

  const [state, setState] = useState<State>("loading");
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [preferences, setPreferences] = useState<PreferencesView | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const [profileResponse, preferencesResponse] = await Promise.all([
        fetch("/api/job-seeker/profile", { cache: "no-store" }),
        fetch("/api/job-seeker/preferences", { cache: "no-store" }),
      ]);
      if (!profileResponse.ok || !preferencesResponse.ok) {
        setState("error");
        setMessage("Your job-seeker data could not be loaded. Reload to try again.");
        return;
      }
      const profileBody = (await profileResponse.json()) as { profile?: ProfileView | null };
      const preferencesBody = (await preferencesResponse.json()) as { preferences?: PreferencesView | null };
      setProfile(profileBody.profile ?? null);
      setPreferences(preferencesBody.preferences ?? null);
      setState("ready");
    } catch {
      setState("error");
      setMessage("Your job-seeker data could not be loaded. Reload to try again.");
    }
  }, []);

  useEffect(() => {
    // Deferred a tick, matching the other consoles: the lint rule (and React)
    // want no state set synchronously inside the effect body itself.
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);

  return (
    <>
      <PageHeader
        title="Job Seeker"
        description="Your AI-powered job search command center: one verified career profile, clear preferences, and a pipeline you approve at every gate."
      />

      <nav aria-label="Job Seeker sections" className="mb-6 flex flex-wrap gap-1.5">
        {SECTIONS.map((entry) => (
          <Link
            key={entry.key}
            href={entry.key === "profile" ? "/job-seeker" : `/job-seeker?section=${entry.key}`}
            aria-current={section === entry.key ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm",
              section === entry.key
                ? "border-[var(--accent)] bg-[var(--accent-soft)] font-medium text-[var(--text)]"
                : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]",
            )}
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      {state === "loading" ? (
        <Card className="min-h-48 animate-pulse">
          <span className="sr-only">Loading your job-seeker data</span>
        </Card>
      ) : state === "error" ? (
        <Card>
          <p role="alert" className="text-sm text-[var(--danger)]">{message}</p>
        </Card>
      ) : section === "profile" ? (
        <JobSeekerProfileForm initial={profile} onSaved={setProfile} />
      ) : section === "preferences" ? (
        <JobSeekerPreferencesForm initial={preferences} onSaved={setPreferences} />
      ) : section === "discovery" ? (
        <JobSeekerJobsPanel />
      ) : section === "applications" ? (
        <JobSeekerApplicationsPanel />
      ) : (
        <EmptyState
          title="No analytics yet"
          description="Once jobs are discovered and applications move, this view reports jobs found, qualified, applications, response rate, interviews, offers, and average match score — computed from your recorded pipeline, never estimated."
          actionLabel="Start with your career profile"
          actionHref="/job-seeker"
        />
      )}
    </>
  );
}
