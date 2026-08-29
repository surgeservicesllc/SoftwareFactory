import { AgentTrailConsole } from "@/components/agent-trail-console";
import { PageHeader } from "@/components/ui";

export const metadata = {
  title: "Agent Trail",
};

export default function AgentTrailPage() {
  return (
    <>
      <PageHeader
        title="Agent Trail"
        description="Your runs as a live map: recorded dependencies, recorded states, and the node the worker is actually on."
      />
      <AgentTrailConsole />
    </>
  );
}
