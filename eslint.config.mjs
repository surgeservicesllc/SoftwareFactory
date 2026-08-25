import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // The underscore prefix is the deliberate "present for its type, unused
      // at runtime" convention — mock signatures in tests carry parameters so
      // call sites type-check, and destructuring skips positions the same
      // way. Without the pattern those legitimate carriers each need a
      // per-line disable, which rots into unused directives.
      "@typescript-eslint/no-unused-vars": ["warn", {
        args: "all",
        argsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "work/**",
    "next-env.d.ts",
    // The layout harness's build output — a bundle, not source.
    "tests/harness/dist/**",
    /*
     * Vendored upstream source, kept byte-for-byte.
     *
     * `vendor/ai-job-search` is a verbatim copy of the MIT-licensed
     * MadsLorentzen/ai-job-search, carried so the port beside it can be
     * audited against its origin. Linting it would report on somebody else's
     * house style, and fixing what it reported would make the copy no longer
     * a copy.
     */
    "vendor/**",
  ]),
]);

export default eslintConfig;
