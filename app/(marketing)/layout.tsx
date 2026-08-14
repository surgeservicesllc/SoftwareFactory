import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { readViewer } from "@/lib/auth/viewer";

/**
 * Public marketing site. Indexable, unlike the console route group.
 *
 * The viewer is read here rather than in the header so the signed-in
 * navigation is present in the first server render. Reading the session makes
 * these pages dynamic; they stay public, and a signed-out visitor sees exactly
 * the same marketing site as before.
 */
export const metadata = {
  robots: { index: true, follow: true },
};

export default async function MarketingLayout({
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
      <main id="main-content" className="flex-1 pb-20">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
