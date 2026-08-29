import type { CSSProperties } from "react";

import { BudgetShell } from "@/components/budget/shell";
import { SiteHeader } from "@/components/marketing/site-header";
import { readViewer } from "@/lib/auth/viewer";

/**
 * The Budget Tracker's route group.
 *
 * It exists so this product does **not** inherit `(portal)`'s chrome. That
 * layout renders `AppShell`, whose sidebar lists the control plane's
 * destinations — so before this group existed, the Budget Tracker's left rail
 * was the console's, which is wayfinding for a different product entirely.
 *
 * A route group changes no URL: `/BudgetTracker` is still `/BudgetTracker`.
 * What changes is which shell wraps it.
 *
 * The global header stays. It is not the section navigation — it is the strip
 * that moves a person *between* products, and dropping it would strand anyone
 * who arrived here and wanted the factory or the job search next. The left
 * navigation underneath is entirely this product's own.
 */
const shellOffset = { "--shell-top": "73px" } as CSSProperties;

export const metadata = {
  title: {
    absolute: "Budget Tracker",
    template: "%s · Budget Tracker",
  },
};

export default async function BudgetLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const viewer = await readViewer();

  return (
    <div style={shellOffset}>
      <SiteHeader viewer={viewer} showMobileMenu={false} />
      <BudgetShell>{children}</BudgetShell>
    </div>
  );
}
