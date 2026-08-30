import type { CSSProperties } from "react";

import { ServicesShell } from "@/components/services/shell";
import { SiteHeader } from "@/components/marketing/site-header";
import { readViewer } from "@/lib/auth/viewer";

/**
 * The Services CRM's route group, on the Budget Tracker's reasoning: this
 * product must not inherit `(portal)`'s chrome, whose sidebar lists the
 * control plane's destinations. A route group changes no URL — `/Services`
 * stays `/Services`; what changes is which shell wraps it. The global
 * header stays because it is the strip that moves a person *between*
 * products.
 */
const shellOffset = { "--shell-top": "73px" } as CSSProperties;

export const metadata = {
  title: {
    absolute: "Services",
    template: "%s · Services",
  },
};

export default async function ServicesGroupLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const viewer = await readViewer();

  return (
    <div style={shellOffset}>
      <SiteHeader viewer={viewer} showMobileMenu={false} />
      <ServicesShell>{children}</ServicesShell>
    </div>
  );
}
