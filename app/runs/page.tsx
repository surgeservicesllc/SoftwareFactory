import { Clock3 } from "lucide-react";

import { Card, DemoNotice, PageHeader, StatusBadge } from "@/components/ui";
import { demoRuns } from "@/lib/demo-data";

export default function RunsPage() {
  return (
    <>
      <PageHeader
        title="Runs"
        description="A record of every job an agent performed, kept so you can check the work afterwards."
        action={<StatusBadge tone="neutral">Worker Not Connected</StatusBadge>}
      />

      <DemoNotice>
        No AI worker produced these. They show what a completed run will look like once one is
        connected.
      </DemoNotice>

      <div className="grid gap-3">
        {demoRuns.map((run) => (
          <Card key={run.id} className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <h2 className="font-medium text-foreground">{run.command}</h2>
              <p className="mt-1 text-sm text-muted">
                {run.agent} agent · {run.id}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 md:shrink-0">
              <div>
                <p className="label">State</p>
                <p className="mt-1 text-sm text-muted">{run.state}</p>
              </div>
              <div>
                <p className="label">Risk</p>
                <div className="mt-1">
                  <StatusBadge tone={run.risk === "GREEN" ? "safe" : "warning"}>{run.risk}</StatusBadge>
                </div>
              </div>
              <div>
                <p className="label">Duration</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
                  <Clock3 className="size-4" aria-hidden="true" />
                  {run.duration}
                </p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <p className="mt-6 text-sm text-muted">
        A real run will record who asked for it, which model ran it, what it changed, how that was
        validated, and who approved it.
      </p>
    </>
  );
}
