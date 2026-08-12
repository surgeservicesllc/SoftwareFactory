import type { Metadata, Viewport } from "next";

import { AppShell } from "@/components/app-shell";

import "./globals.css";

const vercelHost =
  process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ??
      (vercelHost ? `https://${vercelHost}` : "http://localhost:3000"),
  ),
  title: {
    default: "SoftwareFactory — AI Engineering Control Plane",
    template: "%s · SoftwareFactory",
  },
  description:
    "A safety-first command center for software projects, AI agents, delivery controls, and engineering intelligence.",
  applicationName: "SoftwareFactory",
  openGraph: {
    title: "SoftwareFactory — AI Engineering Control Plane",
    description:
      "Coordinate software projects, agents, risk controls, and engineering intelligence from one command center.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "SoftwareFactory AI Engineering Control Plane with safety lock engaged",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "SoftwareFactory — AI Engineering Control Plane",
    description: "A safety-first command center for governed software automation.",
    images: ["/og.png"],
  },
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#080b10",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
