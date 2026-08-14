/**
 * Shared protected-path policy for both request handlers and standalone
 * workers. Keep this module dependency-free so it can run outside Next.js.
 */
export function isProtectedGitHubWritePath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  if (
    !normalized
    || normalized.length > 1024
    || normalized.startsWith("/")
    || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
    || /[\x00-\x1f\x7f]/.test(normalized)
  ) {
    throw new Error("The repository path is invalid.");
  }

  const segments = normalized.split("/");
  const fileName = segments.at(-1) ?? "";
  const protectedSubject = /(^|[._-])(auth|authentication|authorize|authorization|oauth|identity|mfa|sso|rbac|access|permission|permissions|role|roles|rls|session|sessions|cookie|middleware|crypto|cryptography|encrypt|encryption|decrypt|security|secret|credential|private[-_]?key|webhook|workflow|deploy|deployment|release|rollback|recovery|backup|dns|domain|billing|payment|stripe|autonomy|autonomous|safety|guardrail|risk|approval|audit|incident|policy|protected|provider|installation)([._-]|$)/;
  const protectedDirectories = new Set([
    ".circleci",
    ".claude",
    ".codex",
    ".github",
    ".gitlab",
    ".openai",
    ".vercel",
    "ai",
    "database",
    "db",
    "helm",
    "infra",
    "infrastructure",
    "k8s",
    "kubernetes",
    "migrations",
    "policies",
    "schema",
    "supabase",
    "terraform",
  ]);
  const containsProtectedRoute = segments.some((segment, index) => (
    (segment === "app" && ["api", "auth", "settings"].includes(segments[index + 1] ?? ""))
    || (segment === "lib" && ["github", "orchestration", "server", "supabase", "worker"].includes(segments[index + 1] ?? ""))
  ));
  return fileName === "agents.md"
    || fileName === "claude.md"
    || fileName === "codeowners"
    || fileName === ".npmrc"
    || fileName === ".gitignore"
    || fileName === ".vercelignore"
    || fileName === ".dockerignore"
    || fileName === ".yarnrc"
    || fileName === ".yarnrc.yml"
    || fileName === ".pnpmfile.cjs"
    || fileName === "package.json"
    || ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"].includes(fileName)
    || fileName.startsWith(".env")
    || fileName.startsWith("dockerfile")
    || fileName.startsWith("docker-compose")
    || /^(next|nuxt|webpack|vite|vitest|playwright|eslint|jest|rollup|turbo)\.config\.[a-z0-9]+$/.test(fileName)
    || /^tsconfig(?:\.[a-z0-9_-]+)?\.json$/.test(fileName)
    || normalized === ".github/codeowners"
    || normalized === "docs/codeowners"
    || segments.some((segment) => protectedDirectories.has(segment))
    || containsProtectedRoute
    || normalized.startsWith("components/safety-controls.")
    || normalized === "lib/autonomy.ts"
    || normalized === "lib/constants.ts"
    || normalized === "lib/risk.ts"
    || normalized === "proxy.ts"
    || normalized === "middleware.ts"
    || normalized === "scripts/worker.mts"
    || normalized === "vercel.json"
    || normalized === "netlify.toml"
    || normalized === "fly.toml"
    || normalized === "wrangler.toml"
    || segments.includes("config")
    || segments.some((segment) => protectedSubject.test(segment));
}
