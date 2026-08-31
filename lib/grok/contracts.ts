/** Browser-safe Grok Bot workspace contracts. */

import type { ReleaseEvidence } from "@/lib/factory/release-evidence";

export type GrokControlAction = "pause" | "resume" | "stop" | "retry" | "cancel";

export type GrokSession = Readonly<{
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  goal: string;
  status: string;
  commandId: string | null;
  graphId: string | null;
  graphRunId: string | null;
  createdAt: string;
  updatedAt: string;
  allowedActions: readonly GrokControlAction[];
}>;

export type GrokMessage = Readonly<{
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: string;
}>;

export const GROK_CONTEXT_KINDS = [
  "file",
  "image",
  "url",
  "repository",
  "project",
  "integration",
] as const;

export type GrokContextKind = (typeof GROK_CONTEXT_KINDS)[number];

/** Browser input. File text is bounded before it crosses the API boundary. */
export type GrokContextDraft = Readonly<{
  kind: GrokContextKind;
  label: string;
  mediaType?: string;
  text?: string;
  url?: string;
  path?: string;
  connectionId?: string;
}>;

export type GrokContextItem = Readonly<{
  id: string;
  kind: GrokContextKind;
  label: string;
  state: "captured" | "reference_only";
  mediaType: string | null;
  url: string | null;
  repositoryPath: string | null;
  integrationId: string | null;
  textPreview: string | null;
  byteSize: number;
}>;

export type GrokContextEnvelope = Readonly<{
  id: string;
  messageId: string;
  itemCount: number;
  totalBytes: number;
  inputSha256: string;
  replanRequired: boolean;
  createdAt: string;
  items: readonly GrokContextItem[];
}>;

export type GrokTask = Readonly<{
  id: string;
  taskKey: string;
  title: string;
  status: string;
  provider: "anthropic" | "openai" | null;
  model: string | null;
  agentName: string | null;
  /** The persisted node-run attempt. Null means no runtime attempt was observed. */
  attempt?: number | null;
  dependsOn: readonly string[];
}>;

export type GrokEvent = Readonly<{
  id: string;
  type: string;
  detail: string;
  createdAt: string;
}>;

export type GrokArtifact = Readonly<{
  id: string;
  kind: string;
  label: string;
  uri: string | null;
  nodeKey?: string | null;
  createdAt: string;
}>;

export type GrokRunEvidence = Readonly<{
  state: string;
  closureNote: string | null;
  startedAt: string | null;
  completedAt: string | null;
  tokensUsed: number | null;
  costMicros: number | null;
  progress: Readonly<{ completed: number; total: number; percent: number }>;
  events: readonly (GrokEvent & Readonly<{ nodeKey: string | null }>)[];
  eventsTruncated: boolean;
  release: ReleaseEvidence;
}>;

export type GrokSessionDetail = Readonly<{
  session: GrokSession;
  messages: readonly GrokMessage[];
  contextEnvelopes: readonly GrokContextEnvelope[];
  tasks: readonly GrokTask[];
  events: readonly GrokEvent[];
  /** True when only the newest bounded Grok session-event window is returned. */
  eventsTruncated?: boolean;
  artifacts: readonly GrokArtifact[];
  /** Canonical graph-run evidence. Absent on older payloads; null until a run exists. */
  runEvidence?: GrokRunEvidence | null;
}>;

export type GrokSessionCursor = Readonly<{
  createdAt: string;
  id: string;
}>;

export type GrokSessionListResponse = Readonly<{
  sessions: readonly GrokSession[];
  nextCursor: GrokSessionCursor | null;
}>;

