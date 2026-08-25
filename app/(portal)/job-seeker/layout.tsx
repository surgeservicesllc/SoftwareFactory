import { requireJobSeekerViewer } from "@/lib/job-seeker/gate";

/**
 * The gate for every Job Seeker destination.
 *
 * The rule itself lives in `lib/job-seeker/gate.ts`, shared with `/Job-Search`
 * so the two entry points cannot drift apart. Applying it in the layout rather
 * than per page is the same reasoning as before: a gate repeated in a dozen
 * files is a gate that will eventually be forgotten in one of them.
 */
export default async function JobSeekerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireJobSeekerViewer("/job-seeker");
  return <>{children}</>;
}
