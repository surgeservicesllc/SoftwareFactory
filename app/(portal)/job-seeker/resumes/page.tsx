import { JobSeekerDocumentsPanel } from "@/components/job-seeker/documents-panel";

export const metadata = { title: "Resume Library" };

/**
 * Every tailored resume this search has produced, newest first, with its
 * version — the table keeps each one rather than overwriting, so this is the
 * record of what was actually sent.
 */
export default function ResumeLibraryPage() {
  return (
    <JobSeekerDocumentsPanel
      documentKind="resume"
      title="Resume Library"
      description="Every resume generated for an application, kept by version."
      emptyHint="Resumes are written when an application is prepared from a recorded job. Record a job and prepare an application, and each version will appear here."
    />
  );
}
