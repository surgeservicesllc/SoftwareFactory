import type { Metadata, Viewport } from "next";

import "./globals.css";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";

const vercelHost =
  process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ??
      (vercelHost ? `https://${vercelHost}` : "http://localhost:3000"),
  ),
  title: {
    default: "AI Software Factory — Build, Deploy and Scale with AI",
    template: "%s · AI Software Factory",
  },
  description:
    "An end-to-end platform that helps teams plan, build, deploy and scale better software, faster, with AI agents and automation at every step.",
  applicationName: "AI Software Factory",
  // iOS ignores the web app manifest for these, so they are declared here as
  // well or an installed icon falls back to a screenshot of the page.
  appleWebApp: {
    capable: true,
    title: "SoftwareFactory",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "AI Software Factory — Build, Deploy and Scale with AI",
    description:
      "Plan, build, test, deploy and scale from one platform, with AI agents and automation at every step.",
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
    title: "AI Software Factory — Build, Deploy and Scale with AI",
    description: "Plan, build, deploy and scale better software, faster, with AI at the core.",
    images: ["/og.png"],
  },
  // The marketing route group opts back in; the console group stays noindex.
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  colorScheme: "dark light",
  // Dark is the first-visit default. The pre-paint theme bootstrap and toggle
  // keep this browser-chrome colour synchronized with a saved light choice.
  themeColor: "#0b0f14",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          id="theme-bootstrap"
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
        />
      </head>
      <body>
        {children}
        {/* Headless: registers the offline shell without delaying first paint. */}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
