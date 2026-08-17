import { GitBranch, Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { ProjectsConsole } from "@/components/projects-console";
import { Card, PageHeader } from "@/components/ui";

export const metadata = {
  title: "All Projects",
};

export default function ProjectsPage() {
  return (
    <>
      <PageHeader
        title="All Projects"
        description="Organize and manage all your software projects in one place."
        action={
          <>
            <Link href="/solutions/connections" className="btn btn-secondary btn-sm">
              <GitBranch className="size-4" aria-hidden="true" />
              Import Repository
            </Link>
            <Link href="/solutions/projects#add-project" className="btn btn-primary btn-sm">
              <Plus className="size-4" aria-hidden="true" />
              New Project
            </Link>
          </>
        }
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
