import { BudgetTrackerConsole } from "@/components/budget/console";
import { requirePortalViewer } from "@/lib/portal/viewer-gate";

export const metadata = { title: "Budget Tracker" };

/**
 * `/BudgetTracker`.
 *
 * The capitalised segment is deliberate and load-bearing: Next.js routes are
 * case-sensitive, so this file is what answers `/BudgetTracker` and nothing
 * answers `/budgettracker`.
 *
 * The gate is called here rather than inherited, because this page sits
 * directly under the portal route group and has no section layout of its own.
 * It is the same function the Job Seeker section runs, not a copy of it. That
 * matters more here than anywhere else in the product: this page shows a
 * household's accounts, income and debts, and an entry point that skipped the
 * gate would expose them.
 *
 * The gate decides who reaches the page. Row-level security decides who reads
 * a row, and it is the half that does not depend on this file being right.
 */
export default async function BudgetTrackerPage() {
  await requirePortalViewer("/BudgetTracker");
  return <BudgetTrackerConsole />;
}
