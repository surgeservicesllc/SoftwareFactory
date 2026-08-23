import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { readViewer } from "@/lib/auth/viewer";

/**
 * The chooser sits between signing in and the console, so it carries the
 * global header and nothing else — no console sidebar, because the whole
 * point of this screen is that the person has not yet said which console they
 * want.
 *
 * Indexing is inherited: the root layout defaults to `noindex`, and only the
 * marketing group opts back in. This page is private by construction.
 */
export const metadata = {
  title: { absolute: "Choose where to work · AI Software Factory" },
};

export default async function DecisionLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const viewer = await readViewer();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-md bg-[#7c5cff] px-3 py-2 text-sm font-semibold text-white transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>
      <SiteHeader viewer={viewer} />
      <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
