import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Vite 8 resolves the repository's @/* mapping directly from tsconfig.
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Integration suites replay the full PostgreSQL migration chain. At 130
    // files that setup legitimately exceeds Vitest's 10s hook default on a
    // busy Windows runner; contract walks can likewise cross the 5s test
    // default. Keep failures bounded without treating expected setup as a hang.
    hookTimeout: 30_000,
    testTimeout: 30_000,
    include: [
      "tests/unit/**/*.test.{ts,tsx}",
      "tests/integration/**/*.test.{ts,tsx}",
    ],
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/*.d.ts"],
      thresholds: {
        "lib/risk.ts": { 100: true },
        "lib/constants.ts": { 100: true },
      },
    },
  },
});
