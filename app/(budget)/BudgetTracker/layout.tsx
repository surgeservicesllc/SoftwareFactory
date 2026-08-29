import { requirePortalViewer } from "@/lib/portal/viewer-gate";

/**
 * The gate for every Budget Tracker destination.
 *
 * Applied in the layout rather than per page, which is the same reasoning the
 * Job Seeker section uses: a gate repeated in five files is a gate that will
 * eventually be forgotten in one of them, and here the thing behind it is a
 * household's accounts, income and debts.
 *
 * The rule itself lives in `lib/portal/viewer-gate`, shared with Job Seeker,
 * so neither section can drift from the other on who may see these pages.
 * Row-level security still decides who may read a *row*, and that is the half
 * that does not depend on this file being right.
 */
export default async function BudgetTrackerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requirePortalViewer("/BudgetTracker");
  return <>{children}</>;
}
