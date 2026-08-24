import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Briefcase,
  CalendarCheck,
  FileText,
  LayoutDashboard,
  Mail,
  NotebookPen,
  Search,
  Settings,
  TrendingUp,
  Users,
} from "lucide-react";

/**
 * The Job Seeker's own left navigation.
 *
 * Job Seeker is a different product from the control plane, not a page of it:
 * a person here is managing a job search, not a factory, and the console's
 * destinations — Projects, Bots, Runs, Secrets — are noise against that task.
 * So the shell swaps its whole navigation while the path is under
 * `/job-seeker`, the way the owner's design shows it.
 *
 * Overview is first and is where `/job-seeker` lands. Its five children are
 * the sections that already exist as panels, so the group is a real table of
 * contents rather than a heading invented to fill the design.
 */

export type JobSeekerNavItem = {
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
};

export type JobSeekerNavEntry = JobSeekerNavItem & {
  readonly subpages?: readonly JobSeekerNavItem[];
};

/** Every path the Job Seeker navigation owns, for the shell's swap test. */
export const JOB_SEEKER_ROOT = "/job-seeker";

export const JOB_SEEKER_NAVIGATION: readonly JobSeekerNavEntry[] = [
  {
    label: "Overview",
    href: "/job-seeker",
    icon: LayoutDashboard,
    subpages: [
      { label: "Career Profile", href: "/job-seeker/profile", icon: Users },
      { label: "Job Preferences", href: "/job-seeker/preferences", icon: Settings },
      { label: "Job Discovery", href: "/job-seeker/discovery", icon: Search },
      { label: "Applications", href: "/job-seeker/applications", icon: FileText },
      { label: "Follow-Up", href: "/job-seeker/follow-up", icon: CalendarCheck },
    ],
  },
  { label: "Job Search", href: "/job-seeker/discovery", icon: Search },
  { label: "Applications", href: "/job-seeker/applications", icon: FileText },
  { label: "Resume Library", href: "/job-seeker/resumes", icon: FileText },
  { label: "Cover Letters", href: "/job-seeker/cover-letters", icon: Mail },
  { label: "Contacts & Outreach", href: "/job-seeker/contacts", icon: Users },
  { label: "Interview Tracker", href: "/job-seeker/interviews", icon: CalendarCheck },
  { label: "Notes & Documents", href: "/job-seeker/documents", icon: NotebookPen },
  // Skills sits beside Analytics because it answers the other half of the
  // same question: analytics says how the search is going, skills says what
  // to change about it.
  { label: "Skills & Improve", href: "/job-seeker/skills", icon: TrendingUp },
  { label: "Analytics", href: "/job-seeker/analytics", icon: BarChart3 },
  { label: "Settings", href: "/job-seeker/settings", icon: Settings },
] as const;

/** Unused today, kept so the icon import list documents the product's shape. */
export const JOB_SEEKER_ICON: LucideIcon = Briefcase;

/**
 * Whether the shell should show the Job Seeker navigation instead of the
 * console's. True for the root and everything beneath it, false for the
 * lookalike `/job-seekers` so a future route cannot silently inherit it.
 */
export function isJobSeekerPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === JOB_SEEKER_ROOT || pathname.startsWith(`${JOB_SEEKER_ROOT}/`);
}
