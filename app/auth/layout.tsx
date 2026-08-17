import { SiteHeader } from "@/components/marketing/site-header";
import { readViewer } from "@/lib/auth/viewer";

/**
 * The authentication pages were the one part of the product with no global
 * navigation at all.
 *
 * `/auth/sign-in`, `/auth/sign-up` and `/auth/onboarding` sit outside both the
 * marketing and the console route groups, so they inherited only the root
 * layout — which renders no header. The result was a page with the product's
 * name in the browser tab and nowhere on screen, and no way back to the site
 * except the browser's own back button.
 *
 * The header is the same component the other two groups render, resolved from
 * the same viewer, so there is one navigation in the application rather than
 * one plus an exception. Onboarding runs after a session exists, and the header
 * correctly shows the account area there.
 *
 * `robots` is restated because the root layout's `noindex` is what these pages
 * want and the marketing group opts back in — inheriting through a shared
 * component should not quietly change what a crawler is told.
 */

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const viewer = await readViewer();

  return (
    <div className="flex min-h-screen flex-col bg-[#080b10]">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-md bg-[#7c5cff] px-3 py-2 text-sm font-semibold text-white transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>
      <SiteHeader viewer={viewer} />
      <main id="main-content" className="flex-1">
        {children}
      </main>
    </div>
  );
}
