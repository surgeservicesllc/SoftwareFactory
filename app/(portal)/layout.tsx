import type { CSSProperties } from "react";

import { AppShell } from "@/components/app-shell";
import { SiteHeader } from "@/components/marketing/site-header";

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
    default: "Control plane · AI Software Factory",
    template: "%s · Control plane · AI Software Factory",
  },
};

export default function PortalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div style={shellOffset}>
      <SiteHeader />
      <AppShell>{children}</AppShell>
    </div>
  );
}
