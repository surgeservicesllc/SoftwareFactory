"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Globe, Mail, MapPin, Pencil, Phone, User } from "lucide-react";

/**
 * The person the search belongs to, in the sidebar.
 *
 * The owner's design puts a career-profile card under the Job Seeker
 * navigation, and it is not decoration: the whole section is scoped to one
 * person, so saying which one is part of saying what you are looking at. Every
 * field is read from the stored profile — an absent one is left out rather
 * than filled with a placeholder that would read as recorded fact.
 *
 * It renders nothing at all until the profile answers, so the sidebar never
 * flashes a shape that then turns out to be empty.
 */

type ProfileView = {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  location: string | null;
  employmentHistory?: Array<{ title?: string | null }>;
};

export function JobSeekerSidebarProfile() {
  const [profile, setProfile] = useState<ProfileView | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/job-seeker/profile", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { profile?: ProfileView | null };
      if (body.profile) setProfile(body.profile);
    } catch {
      /* The sidebar is not the place to report a failed read; the page is. */
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // No profile yet is a real state: offer the way to create one rather than
  // an empty card that says nothing.
  if (!profile) {
    return (
      <div className="mt-6 rounded-lg border border-line px-3 py-3">
        <p className="label mb-1">Career profile</p>
        <p className="text-sm text-muted">Not set up yet.</p>
        <Link href="/job-seeker/profile" className="btn btn-secondary btn-sm mt-2 w-full">
          <Pencil className="size-3.5" aria-hidden="true" />
          Create profile
        </Link>
      </div>
    );
  }

  const headline = profile.employmentHistory?.[0]?.title ?? null;
  const details: Array<{ icon: typeof Mail; value: string }> = [
    profile.email ? { icon: Mail, value: profile.email } : null,
    profile.phone ? { icon: Phone, value: profile.phone } : null,
    profile.location ? { icon: MapPin, value: profile.location } : null,
    profile.linkedinUrl ? { icon: Globe, value: profile.linkedinUrl } : null,
  ].filter((entry): entry is { icon: typeof Mail; value: string } => entry !== null);

  return (
    <div className="mt-6 rounded-lg border border-line px-3 py-3">
      <div className="flex items-start gap-2.5">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--surface-inset)]"
          aria-hidden="true"
        >
          <User className="size-4 text-faint" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {profile.fullName ?? "Unnamed"}
          </p>
          {headline ? <p className="truncate text-xs text-faint">{headline}</p> : null}
        </div>
      </div>
      {details.length > 0 ? (
        <ul className="mt-2.5 space-y-1">
          {details.map((detail) => (
            <li key={detail.value} className="flex items-center gap-2">
              <detail.icon className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
              <span className="truncate text-xs text-muted" title={detail.value}>{detail.value}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <Link href="/job-seeker/profile" className="btn btn-secondary btn-sm mt-3 w-full">
        <Pencil className="size-3.5" aria-hidden="true" />
        Edit career profile
      </Link>
    </div>
  );
}
