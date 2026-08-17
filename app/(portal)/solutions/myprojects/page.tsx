import { GitBranch, Plus } from "lucide-react";
import Link from "next/link";

import { MyProjectsConsole } from "@/components/my-projects-console";
import { PageHeader } from "@/components/ui";

export const metadata = {
  title: "My Projects",
};

/**
 * The owner's 2026-08-17 design: the portfolio as collapsible rows, with the
 * page-level actions the design shows. Both actions land on the real
 * controls that already exist — the add-project form and repository
 * authorization — the same places the navigation's quick actions go.
 */
export default function MyProjectsPage() {
  return (
    <>
      <PageHeader
        title="My Projects"
        description="Every project in your workspace. Open one to see its live GitHub detail."
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
      <MyProjectsConsole />
    </>
  );
}
