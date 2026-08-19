import type { CSSProperties } from "react";

import { AppShell } from "@/components/app-shell";
import { SiteHeader } from "@/components/marketing/site-header";
import { readViewer } from "@/lib/auth/viewer";

/**
 * The console dashboard, reached from the public site's "Solutions" link.
 *
 * It carries the marketing global navigation so someone arriving from the
 * public site keeps that wayfinding, and the console shell underneath so the
 * control-plane destinations stay one click away.
 *
 * `--shell-top` offsets the shell's fixed sidebar and header by the height of
 * the global navigation (72px plus its 1px border). The shell defaults the
 * variable to 0, so every other console page is unaffected.
 */
const shellOffset = { "--shell-top": "73px" } as CSSProperties;

/*
 * The console keeps its own title identity. Without this the root layout's
 * marketing default applies, and every control-plane tab reads as the public
 * home page. Indexing is inherited: the root layout defaults to noindex and
 * only the marketing group opts back in.
 */
export const metadata = {
  title: {
    /*
     * `absolute`, not `default`: a layout's `default` is still run through the
     * parent template, which appended the site name a second time and titled
     * the dashboard "Control plane · AI Software Factory · AI Software
     * Factory". `absolute` supplies the same fallback for child segments while
     * ignoring the root template.
     */
    absolute: "Control plane · AI Software Factory",
    template: "%s · Control plane · AI Software Factory",
  },
};

export default async function PortalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const viewer = await readViewer();

  return (
    <div style={shellOffset}>
      {/*
        No menu button here: the console shell below renders its own drawer,
        and two hamburgers in two stacked bars is what a phone showed. The
        drawer lists this header's destinations under "Site", so nothing that
        was reachable stops being reachable.
      */}
      <SiteHeader viewer={viewer} showMobileMenu={false} />
      <AppShell viewer={viewer}>{children}</AppShell>
    </div>
  );
}
