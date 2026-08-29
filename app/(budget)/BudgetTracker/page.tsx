import { BudgetTrackerConsole } from "@/components/budget/console";

export const metadata = { title: "Overview" };

/**
 * `/BudgetTracker` — the Overview.
 *
 * The capitalised segment is deliberate and load-bearing: Next.js routes are
 * case-sensitive, so this file is what answers `/BudgetTracker` and nothing
 * answers `/budgettracker`.
 *
 * The gate runs in this segment's layout, and the chrome around it comes from
 * the `(budget)` route group — not from `(portal)`, whose shell would put the
 * control plane's sidebar beside a household's finances.
 */
export default function BudgetOverviewPage() {
  return <BudgetTrackerConsole section="overview" />;
}
