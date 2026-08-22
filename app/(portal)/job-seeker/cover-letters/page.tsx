import { JobSeekerDocumentsPanel } from "@/components/job-seeker/documents-panel";

export const metadata = { title: "Cover Letters" };

export default function CoverLettersPage() {
  return (
    <JobSeekerDocumentsPanel
      documentKind="cover_letter"
      title="Cover Letters"
      description="Every cover letter generated for an application, kept by version."
      emptyHint="Cover letters are written when an application is prepared from a recorded job. Prepare one and each version will appear here."
    />
  );
}
