import { JobSearchPageContent } from "@/components/job-seeker/job-search-page";

export const metadata = { title: "Job Search" };

/**
 * Search lives under `/job-seeker`, so the section layout's gate applies: a
 * signed-out visitor is redirected before this renders, and a signed-in one
 * without a workspace goes through onboarding first. There is deliberately no
 * second check here — a gate repeated per page is a gate that will eventually
 * be forgotten on one of them, which is the reasoning that put it in the
 * layout to begin with.
 */
export default function JobSearchPage() {
  return <JobSearchPageContent />;
}
