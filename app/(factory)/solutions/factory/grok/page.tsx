import { GrokWorkspace } from "@/components/grok/grok-workspace";
import { readViewer } from "@/lib/auth/viewer";

export const metadata = { title: "Grok Bot" };

function one(value: string | string[] | undefined) {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export default async function GrokBotPage({
  searchParams,
}: {
  searchParams: Promise<{
    graphId?: string | string[];
    graphRunId?: string | string[];
    projectId?: string | string[];
    sessionId?: string | string[];
  }>;
}) {
  const [viewer, selection] = await Promise.all([readViewer(), searchParams]);
  return (
    <GrokWorkspace
      initialSelection={{
        graphId: one(selection.graphId),
        graphRunId: one(selection.graphRunId),
        projectId: one(selection.projectId),
        sessionId: one(selection.sessionId),
      }}
      viewer={viewer.signedIn
        ? { email: viewer.email, displayName: viewer.displayName }
        : undefined}
    />
  );
}
