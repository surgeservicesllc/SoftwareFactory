import {
  KanbanSquare,
  LayoutDashboard,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * The Services CRM's own navigation.
 *
 * Self-contained on the Budget Tracker's reasoning: a product owns its
 * wayfinding, and a shared navigation module is how two products end up
 * constraining each other's. The path is capitalised to match the
 * case-sensitive route.
 *
 * Only real destinations are listed. The platform's roadmap (scheduling,
 * IPM, compliance, sales, marketing — AI/SERVICES_CRM_GAP_ANALYSIS.md) adds
 * entries here as each one becomes a page that genuinely works, never
 * before: a navigation entry is a claim that the destination exists.
 */

export type ServicesNavItem = {
  readonly href: string;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
};

export const SERVICES_ROOT = "/Services";

export const SERVICES_NAVIGATION: readonly ServicesNavItem[] = [
  {
    href: SERVICES_ROOT,
    label: "Overview",
    description: "The book of business at a glance",
    icon: LayoutDashboard,
  },
  {
    href: `${SERVICES_ROOT}/customers`,
    label: "Customers & Leads",
    description: "Accounts, contacts, properties, history",
    icon: Users,
  },
  {
    href: `${SERVICES_ROOT}/pipeline`,
    label: "Pipeline",
    description: "Opportunities from first contact to won",
    icon: KanbanSquare,
  },
];

/** Whether a path belongs to the Services CRM. */
export function isServicesPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === SERVICES_ROOT || pathname.startsWith(`${SERVICES_ROOT}/`);
}

/**
 * Which entry a path is on. The customers entry claims its detail pages —
 * a person reading one account is still in Customers & Leads — while the
 * root stays exact so Overview does not light up everywhere.
 */
export function isCurrentServicesPath(href: string, pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (href === SERVICES_ROOT) return pathname === SERVICES_ROOT;
  return pathname === href || pathname.startsWith(`${href}/`);
}
