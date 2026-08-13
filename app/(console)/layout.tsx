import { AppShell } from "@/components/app-shell";
import { readViewer } from "@/lib/auth/viewer";

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

export default async function ConsoleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const viewer = await readViewer();
  return <AppShell viewer={viewer}>{children}</AppShell>;
}
