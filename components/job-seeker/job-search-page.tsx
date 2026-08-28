import { JobSearchPanel } from "@/components/job-seeker/search-panel";
import { PageHeader } from "@/components/ui";

/**
 * The one rendered Job Search surface, shared by the canonical route and its
 * compatibility entries. Keeping the panel and its heading together prevents
 * two public URLs from drifting into two different search products.
 */
export function JobSearchPageContent() {
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
