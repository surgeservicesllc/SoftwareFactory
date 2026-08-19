/**
 * Global navigation, as a function of who is looking.
 *
 * Signed out, the header advertises the product. Signed in, it stops
 * advertising: the marketing pages drop out entirely and the header becomes a
 * way back into the work. Someone who already has an account does not need to
 * be sold the product on every screen, and those five links were pushing the
 * console destinations and the account area apart for no one's benefit.
 *
 * This module is deliberately free of `server-only`: both the server layouts
 * and the client header import it, and it holds no secret — the entries are
 * link labels. Showing a link is not granting access; each destination still
 * enforces its own authorization.
 */

export type NavItem = {
  readonly label: string;
  readonly href: string;
};

/**
 * Public pages, shown to a signed-out visitor.
 *
 * `Solutions` is the console entry point the public site hands off to, so it
 * belongs here rather than only in the signed-in set — dropping it would leave
 * a signed-out visitor no way to reach the dashboard from the navigation.
 *
 * These are marketing destinations. They remain reachable by URL and from the
 * footer once signed in; they are simply not global navigation for someone who
 * has already arrived.
 */
export const PUBLIC_NAV: readonly NavItem[] = [
  { label: "Platform", href: "/platform" },
  { label: "Features", href: "/features" },
  { label: "Solutions", href: "/solutions" },
  { label: "Pricing", href: "/pricing" },
  { label: "Resources", href: "/resources" },
  { label: "About", href: "/about" },
];

/**
 * Added once there is a verified session.
 *
 * `Dashboard` points at the same route as the public `Solutions` entry. Signed
 * in it is the more useful name, so `globalNavigation` keeps this one and drops
 * the public duplicate rather than rendering two links to one destination.
 */
export const SIGNED_IN_NAV: readonly NavItem[] = [
  { label: "Dashboard", href: "/solutions" },
  { label: "Projects", href: "/solutions/projects" },
  { label: "Runs", href: "/solutions/runs" },
  { label: "Activity", href: "/solutions/activity" },
];

/** Added only for a confirmed super administrator. */
export const SUPER_ADMIN_NAV: readonly NavItem[] = [{ label: "Admin", href: "/solutions/admin" }];

/**
 * The global navigation for a viewer.
 *
 * Signed out: the public pages, and nothing else.
 * Signed in: the console destinations, and nothing else.
 *
 * The signed-in set is deliberately not "console entries plus whatever public
 * pages are left over". That produced a header carrying two unrelated
 * vocabularies at once — Dashboard, Projects, Runs, Activity, Admin, then
 * Platform, Features, Pricing, Resources, About — where the second half sells
 * the product to someone already using it.
 */
export function globalNavigation(options: {
  signedIn: boolean;
  isSuperAdmin?: boolean;
}): readonly NavItem[] {
  if (!options.signedIn) return PUBLIC_NAV;

  return [...SIGNED_IN_NAV, ...(options.isSuperAdmin ? SUPER_ADMIN_NAV : [])];
}
