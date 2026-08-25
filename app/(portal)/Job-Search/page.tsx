import { JobSearchPanel } from "@/components/job-seeker/search-panel";
import { requireJobSeekerViewer } from "@/lib/job-seeker/gate";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Job Search" };

/**
 * `/Job-Search`, the named entry point to the board search.
 *
 * One panel, not a second copy of one: this renders the same
 * `JobSearchPanel` as `/job-seeker/search`, against the same four board
 * adapters in `lib/job-seeker/board-search`. Two surfaces that each owned
 * their own search would eventually answer differently, and the one that
 * disagreed would be whichever had been edited last.
 *
 * The gate is called here because this page sits outside the `job-seeker`
 * segment and so inherits nothing from that section's layout. It is the same
 * function that layout runs, not a copy of it — this page shows a person's
 * own career data, and an entry point that skipped the gate would expose it.
 *
 * The capitalised segment is deliberate and load-bearing: Next.js routes are
 * case-sensitive, so this file is what answers `/Job-Search` and nothing
 * answers `/job-search`.
 */
export default async function JobSearchPage() {
  await requireJobSeekerViewer("/Job-Search");
  return (
    <>
      <PageHeader
        title="Job Search"
        description="Search live job boards and save what is worth keeping into your job list."
      />
      <JobSearchPanel />
    </>
  );
}
