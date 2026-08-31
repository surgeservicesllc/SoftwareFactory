/** Browser-safe Grok Bot workspace contracts. */

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

export type GrokTask = Readonly<{
  id: string;
  taskKey: string;
  title: string;
  status: string;
  provider: "anthropic" | "openai" | null;
  model: string | null;
  agentName: string | null;
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
  createdAt: string;
}>;

export type GrokSessionDetail = Readonly<{
  session: GrokSession;
  messages: readonly GrokMessage[];
  tasks: readonly GrokTask[];
  events: readonly GrokEvent[];
  artifacts: readonly GrokArtifact[];
}>;

export type GrokSessionListResponse = Readonly<{ sessions: readonly GrokSession[] }>;

