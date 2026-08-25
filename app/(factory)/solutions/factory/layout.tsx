/**
 * The AI Factory workspace, in its own frame.
 *
 * The owner's boards draw these pages inside their own shell — the AI
 * FACTORY sidebar, the topbar, the violet-on-near-black palette — not
 * inside the console's. So this subtree leaves the (portal) group: no
 * marketing header, no console sidebar, and the `.factory-theme` scope
 * re-skins every token-reading component to the boards' palette. The
 * workspace shell itself (sidebar, topbar, current-run card) is rendered by
 * the pages' client console, which is where the live run data lives.
 */

export const metadata = {
  title: {
    absolute: "AI Factory · Control plane",
    template: "%s · AI Factory",
  },
  robots: { index: false, follow: false },
};

export default function FactoryLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="factory-theme min-h-screen">{children}</div>;
}
