import { JobSeekerConsole } from "@/components/job-seeker/console";

export const metadata = { title: "Job Seeker Settings" };

/**
 * Settings for a job search *is* its preferences — the targets, locations,
 * arrangements and threshold that decide what gets matched. Rather than
 * inventing a second settings surface beside the one that already governs
 * behaviour, this is that surface.
 */
export default function JobSeekerSettingsPage() {
  return <JobSeekerConsole section="preferences" />;
}
