import "server-only";

import { readFile } from "node:fs/promises";

export const repositoryFileCatalog = [
  { path: "AGENTS.md", category: "Agents", label: "Agent instructions" },
  { path: "AI/PROJECT_CONTEXT.md", category: "AI", label: "Project context" },
  { path: "AI/CURRENT_STATE.md", category: "AI", label: "Current state" },
  { path: "AI/ARCHITECTURE.md", category: "AI", label: "Architecture" },
  { path: "AI/ROADMAP.md", category: "AI", label: "Roadmap" },
  { path: "AI/BACKLOG.md", category: "AI", label: "Backlog" },
  { path: "AI/DECISIONS.md", category: "AI", label: "Decisions" },
  { path: "AI/HANDOFF.md", category: "AI", label: "Handoff" },
  { path: "AI/QUALITY_SCORECARD.md", category: "Checklists", label: "Quality scorecard" },
  { path: "policies/RISK_CLASSIFICATION.md", category: "Policies", label: "Risk classification" },
  { path: "policies/AUTO_MERGE_POLICY.md", category: "Policies", label: "Auto merge policy" },
  { path: "policies/PROTECTED_RESOURCES.md", category: "Policies", label: "Protected resources" },
  { path: "policies/AUTO_ROLLBACK.md", category: "Policies", label: "Auto rollback" },
  { path: "policies/POST_DEPLOY_VALIDATION.md", category: "Playbooks", label: "Post-deploy validation" },
  { path: "README.md", category: "Documentation", label: "Repository README" },
  { path: "docs/ARCHITECTURE.md", category: "Documentation", label: "Architecture guide" },
  { path: "docs/SECURITY.md", category: "Documentation", label: "Security guide" },
  { path: "docs/TESTING.md", category: "Documentation", label: "Testing guide" },
] as const;

export const repositoryFileLoaders: Record<RepositoryFilePath, () => Promise<string>> = {
  "AGENTS.md": () => readFile("AGENTS.md", "utf8"),
  "AI/PROJECT_CONTEXT.md": () => readFile("AI/PROJECT_CONTEXT.md", "utf8"),
  "AI/CURRENT_STATE.md": () => readFile("AI/CURRENT_STATE.md", "utf8"),
  "AI/ARCHITECTURE.md": () => readFile("AI/ARCHITECTURE.md", "utf8"),
  "AI/ROADMAP.md": () => readFile("AI/ROADMAP.md", "utf8"),
  "AI/BACKLOG.md": () => readFile("AI/BACKLOG.md", "utf8"),
  "AI/DECISIONS.md": () => readFile("AI/DECISIONS.md", "utf8"),
  "AI/HANDOFF.md": () => readFile("AI/HANDOFF.md", "utf8"),
  "AI/QUALITY_SCORECARD.md": () => readFile("AI/QUALITY_SCORECARD.md", "utf8"),
  "policies/RISK_CLASSIFICATION.md": () => readFile("policies/RISK_CLASSIFICATION.md", "utf8"),
  "policies/AUTO_MERGE_POLICY.md": () => readFile("policies/AUTO_MERGE_POLICY.md", "utf8"),
  "policies/PROTECTED_RESOURCES.md": () => readFile("policies/PROTECTED_RESOURCES.md", "utf8"),
  "policies/AUTO_ROLLBACK.md": () => readFile("policies/AUTO_ROLLBACK.md", "utf8"),
  "policies/POST_DEPLOY_VALIDATION.md": () => readFile("policies/POST_DEPLOY_VALIDATION.md", "utf8"),
  "README.md": () => readFile("README.md", "utf8"),
  "docs/ARCHITECTURE.md": () => readFile("docs/ARCHITECTURE.md", "utf8"),
  "docs/SECURITY.md": () => readFile("docs/SECURITY.md", "utf8"),
  "docs/TESTING.md": () => readFile("docs/TESTING.md", "utf8"),
};

export type RepositoryFilePath = (typeof repositoryFileCatalog)[number]["path"];

export type RepositoryMemoryFile = {
  path: RepositoryFilePath;
  category: string;
  label: string;
  content: string;
  available: boolean;
};

export function isAllowedRepositoryFile(filePath: string): filePath is RepositoryFilePath {
  return repositoryFileCatalog.some((file) => file.path === filePath);
}

export function resolveRepositoryFilePath(filePath: RepositoryFilePath) {
  const allowedFile = repositoryFileCatalog.find((file) => file.path === filePath);
  if (!allowedFile) throw new Error("Repository file is not allowlisted.");
  return allowedFile.path;
}

export async function loadRepositoryMemory(): Promise<RepositoryMemoryFile[]> {
  return Promise.all(
    repositoryFileCatalog.map(async (file) => {
      try {
        const content = await repositoryFileLoaders[file.path]();
        return { ...file, content, available: true };
      } catch {
        return { ...file, content: "", available: false };
      }
    }),
  );
}
