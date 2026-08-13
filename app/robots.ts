import type { MetadataRoute } from "next";

const CONSOLE_PATHS = [
  "/activity",
  "/agents",
  "/api/",
  "/auth/",
  "/backlog",
  "/bot-manager",
  "/connections",
  "/files",
  "/projects",
  "/reports",
  "/runs",
  "/settings",
  "/sign-in",
];

/**
 * Allow the marketing site, keep the control plane out of search results.
 */
export default function robots(): MetadataRoute.Robots {
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  const base = (
    process.env.NEXT_PUBLIC_APP_URL ??
    (vercelHost ? `https://${vercelHost}` : "http://localhost:3000")
  ).replace(/\/$/, "");

  return {
    rules: [{ userAgent: "*", allow: "/", disallow: CONSOLE_PATHS }],
    sitemap: `${base}/sitemap.xml`,
  };
}
