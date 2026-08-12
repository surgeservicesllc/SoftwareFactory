import type { RepositoryContextFile, WorkerRunRequest } from "@/lib/providers/types";

/**
 * Provider-neutral prompt construction.
 *
 * Only the retrieved, relevant repository context is sent. The whole repository
 * is never dumped into a model request.
 */

const MAX_CONTEXT_FILE_BYTES = 60 * 1024;
const MAX_TOTAL_CONTEXT_BYTES = 400 * 1024;

export const WORKER_SYSTEM_INSTRUCTIONS = [
  "You are an engineering worker inside SoftwareFactory, a governed AI software-engineering control plane.",
  "",
  "Rules you must follow:",
  "1. Return only the JSON object described by the response schema. No prose outside it.",
  "2. Propose complete file contents for every file you change. Never emit a partial file or a diff.",
  "3. Every `update` must carry the exact `expectedSha` given for that file in the context. If you were not given a SHA for a file, you may not update it.",
  "4. Never touch a path listed as protected. If the objective requires one, do not change it: report it in `blockers` instead.",
  "5. Never include credentials, API keys, tokens, private keys, passwords, or `.env` values in any field.",
  "6. Match the surrounding code's conventions, naming, and comment density.",
  "7. Add or update tests for behavior you change when the repository has a test suite.",
  "8. Do not report success you cannot support. Use `blockers` when the objective cannot be met safely, and leave `changes` empty.",
  "9. Do not reveal reasoning or intermediate deliberation. `summary` states what changed and why.",
].join("\n");

function truncate(content: string, limit: number) {
  if (content.length <= limit) return { content, truncated: false };
  return {
    content: `${content.slice(0, limit)}\n\n[truncated by SoftwareFactory at ${limit} characters]`,
    truncated: true,
  };
}

function renderFile(file: RepositoryContextFile) {
  const { content } = truncate(file.content, MAX_CONTEXT_FILE_BYTES);
  const shaLine = file.sha ? `expectedSha: ${file.sha}` : "expectedSha: unavailable (this file may not be updated)";
  return [`--- ${file.path}`, shaLine, "```", content, "```"].join("\n");
}

function renderSection(title: string, files: readonly RepositoryContextFile[]) {
  if (files.length === 0) return null;

  const rendered: string[] = [];
  let budget = MAX_TOTAL_CONTEXT_BYTES;
  for (const file of files) {
    const block = renderFile(file);
    if (block.length > budget) break;
    budget -= block.length;
    rendered.push(block);
  }
  if (rendered.length === 0) return null;

  return [`## ${title}`, "", rendered.join("\n\n")].join("\n");
}

export function buildWorkerPrompt(request: WorkerRunRequest): string {
  const sections: (string | null)[] = [
    [
      "## Objective",
      "",
      request.objective,
      "",
      `Work type: ${request.workType}`,
      `Repository: ${request.repository}`,
      `Base branch: ${request.baseBranch} @ ${request.baseSha}`,
    ].join("\n"),
    request.acceptanceCriteria
      ? ["## Acceptance criteria", "", request.acceptanceCriteria].join("\n")
      : null,
    request.protectedPathGuidance.length > 0
      ? [
          "## Protected paths — never change these",
          "",
          ...request.protectedPathGuidance.map((pattern) => `- ${pattern}`),
        ].join("\n")
      : null,
    request.priorFailure
      ? [
          `## Real ${request.priorFailure.kind === "ci" ? "CI" : "test"} failure from your previous attempt`,
          "",
          request.priorFailure.summary,
          "",
          ...request.priorFailure.details.map((detail) => `- ${detail}`),
          "",
          "Diagnose and fix the cause. Do not disable, skip, or weaken a failing check to make it pass.",
        ].join("\n")
      : null,
    renderSection("Repository memory", request.memory),
    renderSection("Relevant files", request.files),
  ];

  return sections.filter((section): section is string => Boolean(section)).join("\n\n");
}
