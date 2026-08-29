import {
  CalendarClock,
  FileSpreadsheet,
  Landmark,
  LayoutDashboard,
  Receipt,
  type LucideIcon,
} from "lucide-react";

/**
 * The Budget Tracker's own navigation.
 *
 * Deliberately self-contained: it imports nothing from `lib/navigation`,
 * `lib/job-seeker/navigation` or the console shell, and nothing imports it
 * back. The Budget Tracker is a product in its own right, and a shared
 * navigation module is how two products end up constraining each other's
 * wayfinding — a destination added for one appearing in the other, an icon
 * set chosen for the console dictating this one's.
 *
 * The paths are capitalised to match the route, which is case-sensitive.
 */

export type BudgetNavItem = {
  readonly href: string;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
};

export const BUDGET_ROOT = "/BudgetTracker";

export const BUDGET_NAVIGATION: readonly BudgetNavItem[] = [
  {
    href: BUDGET_ROOT,
    label: "Overview",
    description: "Net position, cash flow, what is due next",
    icon: LayoutDashboard,
  },
  {
    href: `${BUDGET_ROOT}/accounts`,
    label: "Accounts",
    description: "What your money sits in, and what it is owed on",
    icon: Landmark,
  },
  {
    href: `${BUDGET_ROOT}/transactions`,
    label: "Transactions",
    description: "The ledger, searchable and paged",
    icon: Receipt,
  },
  {
    href: `${BUDGET_ROOT}/bills`,
    label: "Bills & Debt",
    description: "Recurring obligations and payoff order",
    icon: CalendarClock,
  },
  {
    href: `${BUDGET_ROOT}/import`,
    label: "Import",
    description: "Bring in a statement or spreadsheet",
    icon: FileSpreadsheet,
  },
];

/** Whether a path belongs to the Budget Tracker. */
export function isBudgetPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === BUDGET_ROOT || pathname.startsWith(`${BUDGET_ROOT}/`);
}

/**
 * Which entry a path is on.
 *
 * Exact match rather than prefix, because the root would otherwise claim every
 * child and light up "Overview" on all five pages.
 */
export function isCurrentBudgetPath(href: string, pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === href;
}
