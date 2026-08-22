import { JobSeekerDocumentsPanel } from "@/components/job-seeker/documents-panel";

export const metadata = { title: "Notes & Documents" };

/**
 * Everything generated, unfiltered — resumes, cover letters and application
 * answers in one place, for the times you know you wrote something but not
 * which kind it was.
 */
export default function NotesAndDocumentsPage() {
  return (
    <JobSeekerDocumentsPanel
      documentKind={null}
      title="Notes & Documents"
      description="Every document this search has produced, of every kind."
      emptyHint="Resumes, cover letters and application answers all land here as they are written. Nothing has been generated yet."
    />
  );
}
