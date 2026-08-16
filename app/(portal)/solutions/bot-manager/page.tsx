import { BotFabricConsole } from "@/components/bot-fabric-console";
import { BotManagerHome } from "@/components/bot-manager/home";
import { BotManagerWorkspace } from "@/components/bot-manager-workspace";
import { GraphExecutionSummary } from "@/components/graph-execution-summary";
import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { WorkerStatusBadge } from "@/components/worker-status";

export const metadata = {
  title: "Bot Manager",
};

const lifecycle = [
  ["You describe what you want", "In plain words, against one project."],
  ["The server checks it", "Identity, ownership, and risk are verified before anything is stored."],
  ["It is written down", "Your request and an audit record are saved together."],
  ["A worker claims it", "Only a recently-heartbeating worker can claim queued work. Without one, the request remains queued."],
] as const;

export default function BotManagerPage() {
  return (
    <>
      <PageHeader
        title="Bot Manager"
        description="Build your AI engineering team. Connect your AI accounts, create specialized bots, and put them to work."
      />

      <BotManagerHome />

      {/*
        Everything technical lives here and only here: the command-based
        connect flows, the run workspace, worker state, and control-plane
        detail. Deliberately closed by default — a person connecting Claude
        should never need to interpret this, and a person who does need it
        knows to open it.
      */}
      <details id="developer-diagnostics" className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-[var(--text-muted)]">
          Developer Diagnostics
        </summary>
        <div className="space-y-4 border-t border-[var(--border)] p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--text-muted)]">
              Command-based connections, run submission, and worker state. Nothing
              here is required for normal use.
            </p>
            <WorkerStatusBadge />
          </div>

          <BotFabricConsole />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <BotManagerWorkspace />

            <div className="space-y-4">
              <GraphExecutionSummary templateKey="code_review" />

              <Card className="h-fit p-5">
                <SectionTitle title="What happens next" />
                <ol className="mt-4 space-y-4">
                  {lifecycle.map(([title, description], index) => (
                    <li key={title} className="flex gap-3">
                      <span
                        className="tabular grid size-6 shrink-0 place-items-center rounded-full border border-line-strong text-xs font-semibold text-muted"
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-foreground">{title}</p>
                        <p className="mt-1 text-sm text-muted">{description}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </Card>
            </div>
          </div>
        </div>
      </details>
    </>
  );
}
