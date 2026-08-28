import { JobSearchPageContent } from "@/components/job-seeker/job-search-page";
import { requireJobSeekerViewer } from "@/lib/job-seeker/gate";

export const metadata = { title: "Job Search" };

/** The canonical, owner-named Job Search entry point. */
export default async function JobSearchPage() {
  await requireJobSeekerViewer("/JobSearch");
  return <JobSearchPageContent />;
}
