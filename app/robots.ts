import type { MetadataRoute } from "next";

/*
 * The whole control plane now lives under /solutions, so one prefix covers the
 * dashboard and every page beneath it. The marketing pages stay crawlable.
 */
const CONSOLE_PATHS = [
  "/solutions",
  "/api/",
  "/auth/",
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
