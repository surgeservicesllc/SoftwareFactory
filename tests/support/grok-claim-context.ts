import { createHash } from "node:crypto";

import type { GrokClaimContext } from "@/lib/worker/grok-claim-context";

export function grokClaimContextFixture(
  capturedText = "The navigation must remain accessible on narrow screens.",
): GrokClaimContext {
  const bytes = Buffer.byteLength(capturedText, "utf8");
  return {
    schema_version: 1,
    envelope_id: "91000000-0000-4000-8000-000000000001",
    input_sha256: "a".repeat(64),
    session_id: "91000000-0000-4000-8000-000000000002",
    message_id: "91000000-0000-4000-8000-000000000003",
    item_count: 3,
    total_bytes: bytes,
    items: [
      {
        ordinal: 1, kind: "project", label: "SoftwareFactory", state: "reference_only",
        media_type: null, source_url: null, repository_path: null, integration_id: null,
        content_text: null, content_sha256: null, byte_size: 0,
      },
      {
        ordinal: 2, kind: "repository", label: "example/application", state: "reference_only",
        media_type: null, source_url: null, repository_path: "main", integration_id: null,
        content_text: null, content_sha256: null, byte_size: 0,
      },
      {
        ordinal: 3, kind: "file", label: "requirements.md", state: "captured",
        media_type: "text/markdown", source_url: null, repository_path: null,
        integration_id: null, content_text: capturedText,
        content_sha256: createHash("sha256").update(capturedText, "utf8").digest("hex"),
        byte_size: bytes,
      },
    ],
  };
}
