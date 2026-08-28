import { JobSearchPageContent } from "@/components/job-seeker/job-search-page";
import { requireJobSeekerViewer } from "@/lib/job-seeker/gate";

export const metadata = { title: "Job Search" };

/**
 * `/Job-Search`, retained as a compatibility entry to the board search.
 *
 * One panel, not a second copy of one: this renders the same
 * page content as `/JobSearch` and `/job-seeker/search`, against the same four board
 * adapters in `lib/job-seeker/board-search`. Two surfaces that each owned
 * their own search would eventually answer differently, and the one that
 * disagreed would be whichever had been edited last.
 *
 * The gate is called here because this page sits outside the `job-seeker`
 * segment and so inherits nothing from that section's layout. It is the same
 * function that layout runs, not a copy of it — this page shows a person's
 * own career data, and an entry point that skipped the gate would expose it.
 *
 * The canonical owner-named path is `/JobSearch`. This older hyphenated route
 * stays live so bookmarks and sign-in return paths do not break.
 */
export default async function JobSearchPage() {
  await requireJobSeekerViewer("/Job-Search");
  return <JobSearchPageContent />;
}
