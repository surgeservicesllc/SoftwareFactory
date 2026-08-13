import { Suspense } from "react";

import { GitHubFileManager } from "@/components/github-file-manager";
import { Card, PageHeader } from "@/components/ui";

export default function FilesPage() {
  return (
    <>
      <PageHeader
        title="Files"
        description="Read your repository, edit a file, and send the change as a draft pull request for review."
      />
      <Suspense
        fallback={
          <Card className="min-h-[420px] animate-pulse">
            <span className="sr-only">Loading files</span>
          </Card>
        }
      >
        <GitHubFileManager />
      </Suspense>
    </>
  );
}
