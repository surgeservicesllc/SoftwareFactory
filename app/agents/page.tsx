import { Card, DemoNotice, PageHeader, StatusBadge } from "@/components/ui";
import { agents } from "@/lib/demo-data";

export default function AgentsPage() {
  return (
    <>
      <PageHeader
        title="Agents"
        description="The roles work will be split into once AI providers are connected. An agent is a job description, not a login."
        action={<StatusBadge tone="neutral">None active</StatusBadge>}
      />

      <DemoNotice>
        These are role descriptions only. No provider, model, or worker is connected, so none of them
        can run.
      </DemoNotice>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((agent) => (
          <Card key={agent.name} className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-foreground">{agent.name}</h2>
                <p className="text-sm text-faint">{agent.role}</p>
              </div>
              <StatusBadge tone="neutral">Inactive</StatusBadge>
            </div>

            <p className="mt-3 flex-1 text-sm text-muted">{agent.description}</p>

            <div className="mt-4">
              <p className="label">Would handle</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {agent.capabilities.map((capability) => (
                  <span
                    key={capability}
                    className="rounded border border-line px-2 py-1 text-xs text-muted"
                  >
                    {capability}
                  </span>
                ))}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <p className="mt-6 text-sm text-muted">
        Provider credentials always live in server-side connection records. They are never stored on an
        agent.
      </p>
    </>
  );
}
