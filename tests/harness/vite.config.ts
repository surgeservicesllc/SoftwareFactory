import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * A browser harness for the console's populated layouts.
 *
 * The console resolves its tenant on the server, so without Supabase the
 * browser suite only ever sees the "not configured" gate — every layout that
 * exists once there are rows went unmeasured, and that is precisely where the
 * defects found by hand on a phone were living.
 *
 * This mounts the *real* components against fixture props in a real browser,
 * which is the part jsdom cannot do: jsdom has no layout, so it can tell you a
 * button exists but never that it is past the right edge.
 *
 * Next's own modules are stubbed rather than bundled — `next/link` is an
 * anchor and `next/navigation` is a pathname — because nothing here needs a
 * router, and pulling the framework in would make this a slower, less
 * reliable copy of the e2e suite instead of a layout probe.
 */
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: here,
  base: "./",
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^next\/link$/, replacement: `${here}stubs/link.tsx` },
      { find: /^next\/navigation$/, replacement: `${here}stubs/navigation.ts` },
      { find: /^server-only$/, replacement: `${here}stubs/empty.ts` },
      { find: /^@\//, replacement: repositoryRoot },
    ],
  },
  /*
   * The browser-configuration gate, answered.
   *
   * `isBrowserSupabaseConfigured()` reads these, and `useTenantList` renders
   * the signed-out state when it returns false. Vite's build shims
   * `process.env` to `{}`, so it returned false for every case — and the
   * harness, whose whole purpose is measuring *populated* layouts, was
   * measuring signed-out gates for every component that consults it. That is
   * the same vacuity that got an earlier populated sweep deleted, hiding
   * inside the thing built to replace it.
   *
   * These are placeholders in a reserved TLD, not credentials, and nothing
   * reaches the network: `main.tsx` installs a fixture-serving `fetch` before
   * the first render. What they buy is the fetch path being taken at all.
   */
  define: {
    "process.env.NODE_ENV": JSON.stringify("development"),
    "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify("http://harness.invalid"),
    "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("harness-placeholder"),
    "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": JSON.stringify(""),
  },
  build: {
    outDir: `${here}dist`,
    emptyOutDir: true,
  },
});
