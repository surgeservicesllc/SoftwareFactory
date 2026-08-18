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
  build: {
    outDir: `${here}dist`,
    emptyOutDir: true,
  },
});
