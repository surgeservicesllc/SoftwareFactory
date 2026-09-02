import { JobSeekerApplicationKitPanel } from "@/components/job-seeker/application-kit-panel";

export const metadata = { title: "Application Kit" };

/**
 * Everything an applicant tracking system asks for after the resume,
 * copy-ready from the recorded profile, plus the screening answers the
 * person keeps so nobody types "are you authorized to work" twelve times.
 */
export default function ApplicationKitPage() {
  return <JobSeekerApplicationKitPanel />;
}
