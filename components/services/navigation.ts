import {
  Building2,
  CalendarDays,
  Coins,
  Trophy,
  HardHat,
  IdCard,
  KanbanSquare,
  LayoutDashboard,
  Radar,
  ShieldCheck,
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
  {
    href: `${SERVICES_ROOT}/schedule`,
    label: "Schedule",
    description: "Work orders, dispatch, recurring plans",
    icon: CalendarDays,
  },
  {
    href: `${SERVICES_ROOT}/technicians`,
    label: "Technicians",
    description: "The roster that performs service",
    icon: HardHat,
  },
  {
    href: `${SERVICES_ROOT}/ipm`,
    label: "IPM & Devices",
    description: "Stations, scans, sightings, thresholds",
    icon: Radar,
  },
  {
    href: `${SERVICES_ROOT}/compliance`,
    label: "Chemicals & Compliance",
    description: "Products, lots, applications, audit reports",
    icon: ShieldCheck,
  },
  {
    href: `${SERVICES_ROOT}/billing`,
    label: "Billing",
    description: "Estimates, contracts, invoices, payments",
    icon: Coins,
  },
  {
    href: `${SERVICES_ROOT}/sales`,
    label: "Sales",
    description: "Leaderboard, quota, commission ledger",
    icon: Trophy,
  },
  {
    href: `${SERVICES_ROOT}/branches`,
    label: "Branches & Territories",
    description: "Offices, managers, the map each one covers",
    icon: Building2,
  },
  {
    href: `${SERVICES_ROOT}/team`,
    label: "Team",
    description: "The org chart and the field roster",
    icon: IdCard,
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
