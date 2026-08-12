import { writeFile } from "node:fs/promises";

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  isAllowedRepositoryFile,
  resolveRepositoryFilePath,
} from "@/lib/repository-memory";

const updateFileSchema = z.object({
  path: z.string().min(1).max(160),
  content: z.string().max(250_000),
});

export async function PUT(request: Request) {
  if (process.env.SOFTWAREFACTORY_ENABLE_LOCAL_FILE_WRITES !== "true") {
    return NextResponse.json(
      {
        error:
          "Repository writes are disabled. Set SOFTWAREFACTORY_ENABLE_LOCAL_FILE_WRITES=true only in a trusted local environment.",
      },
      { status: 503 },
    );
  }

  const parsed = updateFileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isAllowedRepositoryFile(parsed.data.path)) {
    return NextResponse.json({ error: "Invalid or disallowed repository file." }, { status: 400 });
  }

  const target = resolveRepositoryFilePath(parsed.data.path);
  switch (target) {
    case "AGENTS.md": await writeFile("AGENTS.md", parsed.data.content, "utf8"); break;
    case "AI/PROJECT_CONTEXT.md": await writeFile("AI/PROJECT_CONTEXT.md", parsed.data.content, "utf8"); break;
    case "AI/CURRENT_STATE.md": await writeFile("AI/CURRENT_STATE.md", parsed.data.content, "utf8"); break;
    case "AI/ARCHITECTURE.md": await writeFile("AI/ARCHITECTURE.md", parsed.data.content, "utf8"); break;
    case "AI/ROADMAP.md": await writeFile("AI/ROADMAP.md", parsed.data.content, "utf8"); break;
    case "AI/BACKLOG.md": await writeFile("AI/BACKLOG.md", parsed.data.content, "utf8"); break;
    case "AI/DECISIONS.md": await writeFile("AI/DECISIONS.md", parsed.data.content, "utf8"); break;
    case "AI/HANDOFF.md": await writeFile("AI/HANDOFF.md", parsed.data.content, "utf8"); break;
    case "AI/QUALITY_SCORECARD.md": await writeFile("AI/QUALITY_SCORECARD.md", parsed.data.content, "utf8"); break;
    case "policies/RISK_CLASSIFICATION.md": await writeFile("policies/RISK_CLASSIFICATION.md", parsed.data.content, "utf8"); break;
    case "policies/AUTO_MERGE_POLICY.md": await writeFile("policies/AUTO_MERGE_POLICY.md", parsed.data.content, "utf8"); break;
    case "policies/PROTECTED_RESOURCES.md": await writeFile("policies/PROTECTED_RESOURCES.md", parsed.data.content, "utf8"); break;
    case "policies/AUTO_ROLLBACK.md": await writeFile("policies/AUTO_ROLLBACK.md", parsed.data.content, "utf8"); break;
    case "policies/POST_DEPLOY_VALIDATION.md": await writeFile("policies/POST_DEPLOY_VALIDATION.md", parsed.data.content, "utf8"); break;
    case "README.md": await writeFile("README.md", parsed.data.content, "utf8"); break;
    case "docs/ARCHITECTURE.md": await writeFile("docs/ARCHITECTURE.md", parsed.data.content, "utf8"); break;
    case "docs/SECURITY.md": await writeFile("docs/SECURITY.md", parsed.data.content, "utf8"); break;
    case "docs/TESTING.md": await writeFile("docs/TESTING.md", parsed.data.content, "utf8"); break;
  }

  return NextResponse.json({
    saved: true,
    path: parsed.data.path,
    message: "Saved to the local SoftwareFactory repository. No provider integration was invoked.",
  });
}
