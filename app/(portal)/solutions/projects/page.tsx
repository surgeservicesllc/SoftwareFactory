import { Suspense } from "react";

import { ProjectsConsole } from "@/components/projects-console";
import { Card, PageHeader } from "@/components/ui";

export const metadata = {
  title: "Projects",
};

export default function ProjectsPage() {
  return (
    <>
      <PageHeader
        title="Projects"
        description="Each project is one GitHub repository. Open one to see its branches, commits, and pull requests."
      />
      {/* The console reads its Archived filter from the URL, which requires a
          Suspense boundary — same shape as the Files page. */}
      <Suspense
        fallback={
          <Card className="min-h-64 animate-pulse">
            <span className="sr-only">Loading projects</span>
          </Card>
        }
      >
        <ProjectsConsole />
      </Suspense>
    </>
  );
}
