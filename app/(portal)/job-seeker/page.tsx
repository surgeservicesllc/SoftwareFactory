import { JobSeekerOverview } from "@/components/job-seeker/overview";

export const metadata = {
  title: "Job Seeker Overview",
};

/**
 * Where `/job-seeker` lands: the search at a glance.
 *
 * It used to land on Career Profile, which is a form — the first thing a
 * returning person saw was data entry rather than where their search stands.
 * The gate lives in the layout now, so this is only the destination.
 */
export default function JobSeekerPage() {
  return <JobSeekerOverview />;
}
