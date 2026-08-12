import { Suspense } from "react";

import { GitHubFileManager } from "@/components/github-file-manager";
import { PageHeader, Panel } from "@/components/ui";

export default function FilesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Repository / Live files"
        title="Files"
        description="Browse the authorized GitHub repository, edit a text file, and create a reviewable draft pull request without writing to the default branch."
      />
      <Suspense fallback={<Panel className="min-h-[520px] animate-pulse"><span className="sr-only">Loading live GitHub files</span></Panel>}><GitHubFileManager /></Suspense>
    </>
  );
}
