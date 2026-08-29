import Link from "next/link";

import { JobDiscoveryConsole } from "@/components/job-seeker/discovery-console";
import { PageHeader } from "@/components/ui";

export const metadata = {
  title: "Job Discovery",
  description: "Recorded postings scored against your profile and preferences.",
};

/**
 * Job Discovery.
 *
 * The header's two controls are links to the pages that actually do the work
 * rather than buttons on this one: configuring what a search looks for is
 * Preferences, and running a new search against a board is Search. Duplicating
 * either here would put a second definition of "search" in the product, and
 * the two would drift.
 *
 * The design also shows Saved Searches and Alerts tabs. They are deliberately
 * absent until they can hold something: the tables landed with this change but
 * nothing writes them yet, and a tab that opens onto a permanently empty list
 * is the scaffolding this repository refuses to ship. `todo.md` carries them
 * as the next item, with the schema already in place.
 */
export default function JobDiscoveryPage() {
  return (
    <>
      <PageHeader
        title="Job Discovery"
        description="Postings this workspace has recorded, scored against your profile and preferences."
        action={
          <>
            <Link href="/job-seeker/preferences" className="btn btn-secondary btn-sm">
              Configure search
            </Link>
            <Link href="/job-seeker/search" className="btn btn-primary btn-sm">
              Run new search
            </Link>
          </>
        }
      />
      <JobDiscoveryConsole />
    </>
  );
}
