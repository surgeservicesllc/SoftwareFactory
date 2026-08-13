import { BotManagerWorkspace } from "@/components/bot-manager-workspace";
import { Card, PageHeader, SectionTitle, StatusBadge } from "@/components/ui";

const lifecycle = [
  ["You describe what you want", "In plain words, against one project."],
  ["The server checks it", "Identity, ownership, and risk are verified before anything is stored."],
  ["It is written down", "Your request and an audit record are saved together."],
  ["It stops there", "No worker is connected, so nothing runs."],
] as const;

export default function BotManagerPage() {
  return (
    <>
      <PageHeader
        title="Bot Manager"
        description="Ask for a piece of engineering work. It gets recorded, reviewed, and kept — not run."
        action={<StatusBadge tone="neutral">Worker Not Connected</StatusBadge>}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <BotManagerWorkspace />

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
    </>
  );
}
