import type { MetadataRoute } from "next";

const MARKETING_ROUTES = [
  { path: "/", priority: 1 },
  { path: "/platform", priority: 0.9 },
  { path: "/features", priority: 0.9 },
  { path: "/solutions", priority: 0.8 },
  { path: "/pricing", priority: 0.9 },
  { path: "/resources", priority: 0.8 },
  { path: "/about", priority: 0.7 },
] as const;

/**
 * Marketing routes only.
 *
 * Console routes are deliberately absent: that route group is `noindex`, and
 * listing authenticated surfaces here would advertise them to crawlers.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  const base = (
    process.env.NEXT_PUBLIC_APP_URL ??
    (vercelHost ? `https://${vercelHost}` : "http://localhost:3000")
  ).replace(/\/$/, "");
  const lastModified = new Date();

  return MARKETING_ROUTES.map(({ path, priority }) => ({
    url: `${base}${path}`,
    lastModified,
    changeFrequency: "weekly" as const,
    priority,
  }));
}
