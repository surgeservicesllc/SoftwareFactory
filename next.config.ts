import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: {
    root: process.cwd(),
  },
  /*
   * The control plane moved under /solutions. These keep existing links,
   * bookmarks and any in-flight provider callbacks working.
   */
  async redirects() {
    return [
      "activity",
      "admin",
      "agentos",
      "agents",
      "ai-factory",
      "autonomy",
      "backlog",
      "billing",
      "bot-manager",
      "bot-usage",
      "connections",
      "factory",
      "files",
      "lifecycle",
      "myprojects",
      "operations",
      "pipelines",
      "portfolio",
      "projects",
      "reports",
      "runs",
      "settings",
      "workflows",
    ].flatMap((route) => [
      { source: `/${route}`, destination: `/solutions/${route}`, permanent: true },
      { source: `/${route}/:path*`, destination: `/solutions/${route}/:path*`, permanent: true },
    ]);
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
              "font-src 'self' data:",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "img-src 'self' data: blob: https://avatars.githubusercontent.com",
              "object-src 'none'",
              `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
              "style-src 'self' 'unsafe-inline'",
              "upgrade-insecure-requests",
            ].join("; "),
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
