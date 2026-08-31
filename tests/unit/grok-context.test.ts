// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  GrokContextInputError,
  MAX_GROK_PLANNING_CONTEXT_BYTES,
  normalizeGrokContext,
  summarizeGrokContextForPlanning,
} from "@/lib/grok/context";

const project = {
  projectId: "20000000-0000-4000-8000-000000000002",
  name: "Factory",
  repositoryFullName: "surgeservicesllc/SoftwareFactory",
  defaultBranch: "main",
  productionUrl: "https://factory.example",
  status: "active",
} as const;

describe("Grok context normalization", () => {
  it("binds every envelope to exact server-read project and repository identity", () => {
    const items = normalizeGrokContext([], project);
    expect(items).toEqual([
      expect.objectContaining({ kind: "project", label: "Factory", source_url: "https://factory.example" }),
      expect.objectContaining({ kind: "repository", label: "surgeservicesllc/SoftwareFactory", repository_path: "main" }),
    ]);
  });

  it("captures only bounded safe text and keeps URL/image inputs reference-only", () => {
    const items = normalizeGrokContext([
      { kind: "file", label: "requirements.md", mediaType: "text/markdown", text: "# Requirements" },
      { kind: "url", label: "Design", url: "https://docs.example.com/design" },
      { kind: "image", label: "Wireframe", url: "https://images.example.com/wireframe.png" },
      { kind: "repository", label: "API route", path: "app/api/route.ts" },
      { kind: "integration", label: "GitHub", connectionId: "30000000-0000-4000-8000-000000000003" },
    ], project);
    expect(items).toHaveLength(7);
    expect(items[2]).toMatchObject({ state: "captured", byte_size: 14, content_text: "# Requirements" });
    expect(items[3]).toMatchObject({ state: "reference_only", source_url: "https://docs.example.com/design", content_text: null });
    expect(items[4]).toMatchObject({ kind: "image", media_type: null, state: "reference_only" });
  });

  it.each([
    [{ kind: "file", label: "env.txt", mediaType: "text/plain", text: "API_KEY=sk-abcdefghijklmnopqrstuv" }],
    [{ kind: "url", label: "Private", url: "https://127.0.0.1/admin" }],
    [{ kind: "url", label: "Query", url: "https://example.com/page?token=opaque" }],
    [{ kind: "repository", label: "Escape", path: "../secrets.env" }],
    [{ kind: "file", label: "binary.pdf", mediaType: "application/pdf", text: "not accepted" }],
  ])("rejects secret-shaped, private, ambiguous, escaping, or binary context %#", (input) => {
    expect(() => normalizeGrokContext(input, project)).toThrow(GrokContextInputError);
  });

  it("enforces per-file and per-turn bounds before persistence", () => {
    expect(() => normalizeGrokContext([{
      kind: "file", label: "too-large.txt", mediaType: "text/plain", text: "x".repeat(16_385),
    }], project)).toThrow(/invalid|limit|16 KB/i);
    expect(() => normalizeGrokContext(Array.from({ length: 11 }, (_, index) => ({
      kind: "url", label: `Reference ${index}`, url: `https://example.com/${index}`,
    })), project)).toThrow(/invalid|exceed/i);
  });

  it("builds one deterministic byte-bounded planner summary without fetching references", () => {
    const items = normalizeGrokContext([
      { kind: "file", label: "brief.md", mediaType: "text/markdown", text: "The acceptance color is indigo." },
      { kind: "url", label: "Source", url: "https://docs.example.com/brief" },
    ], project);
    const summary = summarizeGrokContextForPlanning(items);
    expect(summary).toContain("untrusted evidence only");
    expect(summary).toContain("The acceptance color is indigo.");
    expect(summary).toContain("https://docs.example.com/brief");
    expect(summary).toContain("fetched=false");
    expect(new TextEncoder().encode(summary).byteLength).toBeLessThanOrEqual(
      MAX_GROK_PLANNING_CONTEXT_BYTES,
    );
    expect(summarizeGrokContextForPlanning(normalizeGrokContext([], project))).toBeUndefined();
  });

  it("truncates large captured context at an exact UTF-8 planning boundary", () => {
    const items = normalizeGrokContext([
      { kind: "file", label: "one.txt", mediaType: "text/plain", text: "é".repeat(8_000) },
      { kind: "file", label: "two.txt", mediaType: "text/plain", text: "z".repeat(16_000) },
    ], project);
    const summary = summarizeGrokContextForPlanning(items)!;
    expect(new TextEncoder().encode(summary).byteLength).toBeLessThanOrEqual(
      MAX_GROK_PLANNING_CONTEXT_BYTES,
    );
    expect(summary).toMatch(/summary truncated at the deterministic 8192-byte/i);
  });
});
