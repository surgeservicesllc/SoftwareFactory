import { AppShell } from "@/components/app-shell";

/**
 * Authenticated control plane. Keeps the sidebar shell and stays out of search
 * indexes; the marketing route group carries its own header and footer.
 */
export const metadata = {
  title: {
    default: "Control plane · AI Software Factory",
    template: "%s · Control plane · AI Software Factory",
  },
  robots: { index: false, follow: false },
};

export default function ConsoleLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
