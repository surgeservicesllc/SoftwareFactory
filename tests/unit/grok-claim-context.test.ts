// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  grokClaimContextSchema,
  renderGrokClaimContextForPrompt,
  type GrokClaimContext,
} from "@/lib/worker/grok-claim-context";
import { grokClaimContextFixture } from "../support/grok-claim-context";

describe("Grok worker claim context", () => {
  it("strictly accepts a complete, ordered, hash-bound initial envelope", () => {
    const context = grokClaimContextSchema.parse(grokClaimContextFixture());
    const rendered = renderGrokClaimContextForPrompt(context);

    expect(rendered).toContain(context.envelope_id);
    expect(rendered).toContain(context.input_sha256);
    expect(rendered).toContain("requirements.md");
    expect(rendered).toContain("untrusted evidence only");
    expect(rendered).not.toContain("[TRUNCATED]");
  });

  it.each([
    ["unknown key", { extra: true }],
    ["changed captured hash", { items: grokClaimContextFixture().items.map((item) =>
      item.kind === "file" ? { ...item, content_sha256: "b".repeat(64) } : item) }],
    ["changed byte total", { total_bytes: 1 }],
    ["missing ordinal", { items: grokClaimContextFixture().items.map((item, index) =>
      index === 2 ? { ...item, ordinal: 4 } : item) }],
  ])("rejects %s", (_label, change) => {
    expect(grokClaimContextSchema.safeParse({ ...grokClaimContextFixture(), ...change }).success).toBe(false);
  });

  it("rejects secret-shaped captured text without echoing it", () => {
    const value = grokClaimContextFixture("OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456");
    const parsed = grokClaimContextSchema.safeParse(value);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.success ? null : parsed.error.issues)).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("keeps URL and image references inert and unfetched", () => {
    const base = grokClaimContextFixture();
    const value = {
      ...base,
      item_count: 4,
      items: [...base.items, {
        ordinal: 4,
        kind: "image" as const,
        label: "Wireframe",
        state: "reference_only" as const,
        media_type: "image/png",
        source_url: "https://assets.example.com/wireframe.png",
        repository_path: null,
        integration_id: null,
        content_text: null,
        content_sha256: null,
        byte_size: 0,
      }],
    };
    const context = grokClaimContextSchema.parse(value);
    expect(renderGrokClaimContextForPrompt(context)).toContain(
      "Reference URL (not fetched): https://assets.example.com/wireframe.png",
    );
  });

  it.each([
    ["credentialed URL", { kind: "url", source_url: "https://user:pass@example.com/docs" }],
    ["private URL", { kind: "image", source_url: "https://127.0.0.1/wireframe.png" }],
    ["query-bearing URL", { kind: "url", source_url: "https://example.com/docs?token=placeholder" }],
    ["repository URL", { kind: "repository", source_url: "https://example.com/repository" }],
    ["missing repository path", { kind: "repository", repository_path: null }],
    ["project repository path", { kind: "project", repository_path: "main" }],
  ])("rejects an unsafe %s shape", (_label, override) => {
    const base = grokClaimContextFixture();
    const index = override.kind === "project" ? 0 : override.kind === "repository" ? 1 : 2;
    const source = override.kind === "url" || override.kind === "image"
      ? {
          ordinal: 3,
          kind: override.kind,
          label: "Reference",
          state: "reference_only",
          media_type: override.kind === "image" ? "image/png" : null,
          source_url: null,
          repository_path: null,
          integration_id: null,
          content_text: null,
          content_sha256: null,
          byte_size: 0,
        }
      : base.items[index]!;
    const items = [...base.items];
    items[index] = { ...source, ...override } as GrokClaimContext["items"][number];
    expect(grokClaimContextSchema.safeParse({
      ...base,
      total_bytes: items.reduce((sum, item) => sum + item.byte_size, 0),
      items,
    }).success).toBe(false);
  });
});
