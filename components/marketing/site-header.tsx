"use client";

import { Menu, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { BrandMark } from "@/components/brand-mark";
import { SignOutButton } from "@/components/sign-out-button";
import { cn } from "@/lib/cn";
import { globalNavigation, globalNavigationMatches, PUBLIC_NAV } from "@/lib/navigation";

/**
 * The signed-out navigation, kept as a named export for callers and tests that
 * want the public shape specifically. The header itself derives its entries
 * from the viewer via `globalNavigation`.
 */
export const MARKETING_NAV = PUBLIC_NAV;

/**
 * What the header knows about the person looking at it.
 *
 * This is resolved on the server and passed down. The header never fetches it,
 * so the first paint is already correct and the navigation does not flicker
 * from signed-out to signed-in after hydration.
 */
export type HeaderViewer = {
  readonly signedIn: boolean;
  readonly email?: string | null;
  readonly displayName?: string | null;
  readonly isSuperAdmin?: boolean;
};

const SIGNED_OUT_VIEWER: HeaderViewer = { signedIn: false };

export function SiteHeader({
  viewer = SIGNED_OUT_VIEWER,
  /**
   * Whether this header carries the small-screen menu button.
   *
   * The console renders this header *and* its own navigation drawer, so a
   * phone showed two hamburgers in two stacked bars — one for the site, one
   * for the console — with no way to tell which was which but their invisible
   * accessible names. The console passes `false` and lists the site's
   * destinations inside its own drawer, so there is one button and one menu.
   */
  showMobileMenu = true,
}: {
  viewer?: HeaderViewer;
  showMobileMenu?: boolean;
}) {
  const pathname = usePathname();
  const navItems = globalNavigation({
    signedIn: viewer.signedIn,
    isSuperAdmin: viewer.isSuperAdmin,
  });
  const accountLabel = viewer.displayName ?? viewer.email ?? "Account";
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  /*
   * One current destination, decided by the most specific match.
   *
   * The signed-in set no longer nests — `Admin` was `/solutions/admin` under
   * `Software Factory`'s `/solutions`, and a prefix test alone marked both as
   * current on the admin page, drawing two underlines at once. The rule stays
   * because it is the correct one whether or not the set nests today: the
   * longest matching href wins, which is the entry a person is actually on.
   */
  const activeHref = navItems.reduce<string | null>((best, item) => {
    const matches = globalNavigationMatches(pathname, item.href);
    if (!matches) return best;
    return best === null || item.href.length > best.length ? item.href : best;
  }, null);

  function isActive(href: string) {
    return href === activeHref;
  }

  return (
    <header className="sticky top-0 z-50 border-b border-[#161d2a] bg-[#080b10]/90 backdrop-blur-xl">
      <div className="flex h-[68px] w-full items-center justify-between gap-4 px-4 sm:h-[76px] sm:gap-6 sm:px-6 lg:px-8 2xl:px-10">
        <BrandMark />

        {/*
          `min-w-0` so a long entry set shrinks this column rather than pushing
          the account controls off the right edge — the failure that turns a
          wide header into a horizontally scrolling page.
        */}
        <nav
          aria-label="Primary"
          className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 xl:gap-1 lg:flex"
        >
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cn(
                "relative whitespace-nowrap rounded-lg px-2.5 py-2 text-[15px] font-medium",
                "transition-colors xl:px-3.5",
                isActive(item.href)
                  ? "text-[#a78bfa]"
                  : "text-[#96a2b4] hover:text-white",
              )}
            >
              {item.label}
              {isActive(item.href) ? (
                <span
                  className="absolute inset-x-2.5 -bottom-[9px] h-[3px] rounded-full bg-[#7c5cff] xl:inset-x-3.5"
                  aria-hidden="true"
                />
              ) : null}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
          {viewer.signedIn ? (
            <>
              {viewer.isSuperAdmin ? (
                <span className="hidden items-center gap-1.5 rounded-xl border border-[#4a3d80] bg-[#161230] px-3 py-1.5 text-[10px] font-bold uppercase leading-[1.15] tracking-[0.14em] text-[#c9bcff] xl:inline-flex">
                  <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
                  {/*
                    Two lines by width rather than a <br>. The break is
                    typographic, and a hard break splits the accessible name
                    into two text nodes — so a screen reader, and anything
                    matching on the label, stops seeing one phrase.
                  */}
                  <span className="block max-w-[4.25rem]">Super admin</span>
                </span>
              ) : null}
              <span
                className="hidden max-w-[150px] truncate text-sm text-[#96a2b4] xl:inline"
                title={viewer.email ?? undefined}
              >
                {accountLabel}
              </span>
              <Link
                href="/solutions"
                className="hidden min-h-10 items-center rounded-xl bg-gradient-to-r from-[#7c5cff] to-[#5b7cff] px-4 text-sm font-bold leading-tight text-white transition-opacity hover:opacity-90 sm:inline-flex"
              >
                Open Console
              </Link>
              <SignOutButton className="hidden min-h-10 items-center rounded-xl border border-[#2b3547] bg-[#0f1520] px-4 text-sm font-semibold text-[#d3dbe6] transition-colors hover:border-[#44536a] hover:text-white sm:inline-flex" />
            </>
          ) : (
            <>
          {/*
            No `next`. This is the generic entry point, so the destination is
            whatever a fresh sign-in decides — the decision page. A "sign in to
            see your pipelines" prompt still carries its own `next`, because
            that person asked for somewhere specific.
          */}
          <Link
            href="/auth/sign-in"
            className="hidden min-h-10 items-center rounded-xl border border-[#2b3547] bg-[#0f1520] px-4 text-sm font-semibold text-[#d3dbe6] transition-colors hover:border-[#44536a] hover:text-white sm:inline-flex"
          >
            Sign In
          </Link>
          {/*
            Sign-up, not sign-in. This pointed at /sign-in, so the primary
            call to action on every marketing page landed a brand-new visitor
            on a page headed "Sign in / Welcome back", with account creation
            hidden behind a small link at the bottom.
          */}
          <Link
            href="/auth/sign-up"
            className="inline-flex min-h-10 items-center rounded-xl bg-gradient-to-r from-[#7c5cff] to-[#4d8dff] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Get Started Free
          </Link>
            </>
          )}
          {showMobileMenu ? (
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open site navigation"
              aria-expanded={mobileOpen}
              className="grid size-10 place-items-center rounded-xl border border-[#2b3547] bg-[#0f1520] text-[#aab5c3] lg:hidden"
            >
              <Menu className="size-5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {mobileOpen && showMobileMenu ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Same as the console drawer: a click-away scrim, not a second
              control sharing the X's accessible name. */}
          <button
            type="button"
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
            tabIndex={-1}
          />
          <div className="absolute inset-x-0 top-0 border-b border-[#1c2433] bg-[#0a0e15] p-4 pb-6">
            <div className="flex items-center justify-between">
              <BrandMark />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close site navigation"
                className="grid size-10 place-items-center rounded-xl border border-[#2b3547] text-[#aab5c3]"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="Mobile" className="mt-5 grid grid-cols-1 gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className={cn(
                    "rounded-xl px-3 py-3 text-sm font-medium",
                    isActive(item.href)
                      ? "bg-[#171233] text-[#c4b5fd]"
                      : "text-[#9aa6b8] hover:bg-[#101620] hover:text-white",
                  )}
                >
                  {item.label}
                </Link>
              ))}
              {viewer.signedIn ? (
                <>
                  <p className="mt-2 truncate px-3 text-xs text-[#6f7c90]">
                    Signed in as {accountLabel}
                    {viewer.isSuperAdmin ? " · Super admin" : ""}
                  </p>
                  <Link
                    href="/solutions"
                    onClick={() => setMobileOpen(false)}
                    className="rounded-xl bg-gradient-to-r from-[#7c5cff] to-[#4d8dff] px-3 py-3 text-center text-sm font-semibold text-white"
                  >
                    Open Console
                  </Link>
                  <SignOutButton className="w-full rounded-xl border border-[#2b3547] px-3 py-3 text-center text-sm font-semibold text-[#d3dbe6]" />
                </>
              ) : (
                <>
              <Link
                href="/auth/sign-up"
                onClick={() => setMobileOpen(false)}
                className="mt-2 rounded-xl bg-gradient-to-r from-[#7c5cff] to-[#4d8dff] px-3 py-3 text-center text-sm font-semibold text-white"
              >
                Get Started Free
              </Link>
              <Link
                href="/auth/sign-in"
                onClick={() => setMobileOpen(false)}
                className="rounded-xl border border-[#2b3547] px-3 py-3 text-center text-sm font-semibold text-[#d3dbe6]"
              >
                Sign In
              </Link>
                </>
              )}
            </nav>
          </div>
        </div>
      ) : null}
    </header>
  );
}
