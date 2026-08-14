"use client";

import { Menu, Settings2, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { SignOutButton } from "@/components/sign-out-button";
import { cn } from "@/lib/cn";
import { globalNavigation, PUBLIC_NAV } from "@/lib/navigation";

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

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-3" aria-label="AI Software Factory home">
      <span className="relative grid size-10 shrink-0 place-items-center rounded-xl border border-[#2d3550] bg-gradient-to-br from-[#161a2e] to-[#0e1120]">
        <Settings2 className="size-6 text-[#7c8cff]" strokeWidth={1.5} aria-hidden="true" />
        <span className="absolute font-mono text-[8px] font-bold text-[#c9d2ff]">AI</span>
      </span>
      <span className="leading-none">
        <span className="block text-[15px] font-bold tracking-[-0.01em] text-white sm:text-[17px]">
          AI SOFTWARE
        </span>
        <span className="mt-1 block font-mono text-[9px] font-semibold uppercase tracking-[0.42em] text-[#8fa0ff] sm:text-[10px]">
          Factory
        </span>
      </span>
    </Link>
  );
}

export function SiteHeader({ viewer = SIGNED_OUT_VIEWER }: { viewer?: HeaderViewer }) {
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

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <header className="sticky top-0 z-50 border-b border-[#161d2a] bg-[#080b10]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] w-full max-w-[1400px] items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        <Wordmark />

        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cn(
                "relative rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive(item.href)
                  ? "text-[#a78bfa]"
                  : "text-[#9aa6b8] hover:text-white",
              )}
            >
              {item.label}
              {isActive(item.href) ? (
                <span
                  className="absolute inset-x-3 -bottom-[1px] h-0.5 rounded-full bg-gradient-to-r from-[#7c5cff] to-[#4d8dff]"
                  aria-hidden="true"
                />
              ) : null}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          {viewer.signedIn ? (
            <>
              {viewer.isSuperAdmin ? (
                <span className="hidden items-center gap-1.5 rounded-lg border border-[#4c3a86] bg-[#1a1436] px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#c4b5fd] md:inline-flex">
                  <ShieldCheck className="size-3" aria-hidden="true" />
                  Super admin
                </span>
              ) : null}
              <span
                className="hidden max-w-[180px] truncate text-sm text-[#9aa6b8] lg:inline"
                title={viewer.email ?? undefined}
              >
                {accountLabel}
              </span>
              <Link
                href="/solutions"
                className="hidden min-h-10 items-center rounded-xl bg-gradient-to-r from-[#7c5cff] to-[#4d8dff] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 sm:inline-flex"
              >
                Open Console
              </Link>
              <SignOutButton className="hidden min-h-10 items-center rounded-xl border border-[#2b3547] bg-[#0f1520] px-4 text-sm font-semibold text-[#d3dbe6] transition-colors hover:border-[#44536a] hover:text-white sm:inline-flex" />
            </>
          ) : (
            <>
          <Link
            href="/auth/sign-in?next=/solutions"
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
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open site navigation"
            aria-expanded={mobileOpen}
            className="grid size-10 place-items-center rounded-xl border border-[#2b3547] bg-[#0f1520] text-[#aab5c3] lg:hidden"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-label="Close site navigation"
          />
          <div className="absolute inset-x-0 top-0 border-b border-[#1c2433] bg-[#0a0e15] p-4 pb-6">
            <div className="flex items-center justify-between">
              <Wordmark />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close site navigation"
                className="grid size-10 place-items-center rounded-xl border border-[#2b3547] text-[#aab5c3]"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="Mobile" className="mt-5 grid gap-1">
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
                href="/auth/sign-in?next=/solutions"
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
