"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { JobSeekerAnalyticsPanel } from "@/components/job-seeker/analytics-panel";
import { JobSeekerFollowUpPanel } from "@/components/job-seeker/follow-up-panel";
import { JobSeekerApplicationsPanel } from "@/components/job-seeker/applications-panel";
import { JobSeekerJobsPanel } from "@/components/job-seeker/jobs-panel";
import { JobSeekerPreferencesForm, type PreferencesView } from "@/components/job-seeker/preferences-form";
import { JobSeekerProfileForm, type ProfileView } from "@/components/job-seeker/profile-form";
import { ResumeUploadButton } from "@/components/job-seeker/resume-upload-button";
import { Card, PageHeader } from "@/components/ui";
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

type SectionKey = "profile" | "preferences" | "discovery" | "applications" | "follow-up" | "analytics";

const SECTIONS: ReadonlyArray<{ key: SectionKey; label: string }> = [
  { key: "profile", label: "Career Profile" },
  { key: "preferences", label: "Job Preferences" },
  { key: "discovery", label: "Job Discovery" },
  { key: "applications", label: "Applications" },
  { key: "follow-up", label: "Follow-Up" },
  { key: "analytics", label: "Analytics" },
];

type State = "loading" | "ready" | "error" | "onboarding";

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
        // A person with no workspace yet gets a 409 from every job-seeker
        // endpoint. That is a next step, not a failure — name it.
        const failed = !profileResponse.ok ? profileResponse : preferencesResponse;
        if (failed.status === 409) {
          const body = (await failed.json().catch(() => null)) as
            | { error?: { code?: string } }
            | null;
          if (body?.error?.code === "organization_onboarding_required") {
            setState("onboarding");
            return;
          }
        }
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
        action={
          /*
           * In the header rather than inside the Career Profile form, where the
           * old control sat below the fold on one tab. Filling a profile from a
           * resume is the fastest route to a usable profile, and it should be
           * the most visible thing on the page rather than the hardest to find.
           */
          state === "ready" ? <ResumeUploadButton onApplied={load} /> : undefined
        }
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
      ) : state === "onboarding" ? (
        <Card>
          <p className="text-sm text-[var(--text-muted)]">
            Job Seeker stores your career profile inside a workspace, and you
            do not have one yet. Create yours and you will land right back
            here.
          </p>
          <Link
            className="btn btn-primary mt-4 inline-flex"
            href="/auth/onboarding?next=%2Fjob-seeker"
          >
            Create your workspace
          </Link>
        </Card>
      ) : section === "profile" ? (
        <JobSeekerProfileForm
          // Remounted when the stored profile changes, because the form
          // seeds its fields from `initial` on first render only. Without
          // this, applying a resume would update Supabase and leave the
          // editor showing the old values — which the person could then
          // save straight back over what they just applied.
          key={profile?.updatedAt ?? "new"}
          initial={profile}
          onSaved={setProfile}
        />
      ) : section === "preferences" ? (
        <JobSeekerPreferencesForm initial={preferences} onSaved={setPreferences} />
      ) : section === "discovery" ? (
        <JobSeekerJobsPanel />
      ) : section === "applications" ? (
        <JobSeekerApplicationsPanel />
      ) : section === "follow-up" ? (
        <JobSeekerFollowUpPanel />
      ) : (
        <JobSeekerAnalyticsPanel />
      )}
    </>
  );
}
