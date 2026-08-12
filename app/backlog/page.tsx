import { Card, DemoNotice, PageHeader, StatusBadge } from "@/components/ui";
import { demoBacklog } from "@/lib/demo-data";

function priorityTone(priority: string) {
  return priority === "P0" ? "danger" : priority === "P1" ? "warning" : "neutral";
}

function riskTone(risk: string) {
  return risk === "GREEN" ? "safe" : risk === "YELLOW" ? "warning" : "danger";
}

/**
 * A five-column table cannot be read on a phone, and forcing one into a
 * horizontal scroller also strands keyboard users. Each item is a row that
 * lines up into columns on wide screens and stacks on narrow ones.
 */
export default function BacklogPage() {
  return (
    <>
      <PageHeader title="Backlog" description="Work waiting on refinement, evidence, approval, or execution." />

      <DemoNotice>
        These items are examples. The backlog is not connected to GitHub Issues or any planning tool
        yet.
      </DemoNotice>

      <Card className="overflow-hidden">
        <div className="hidden items-center gap-4 border-b border-line px-5 py-3 md:grid md:grid-cols-[minmax(0,1fr)_84px_96px_140px]">
          <p className="label">Work item</p>
          <p className="label">Priority</p>
          <p className="label">Risk</p>
          <p className="label">Status</p>
        </div>

        <ul className="divide-y divide-[var(--border)]">
          {demoBacklog.map((item) => (
            <li
              key={item.id}
              className="grid gap-2 px-5 py-4 md:grid-cols-[minmax(0,1fr)_84px_96px_140px] md:items-center md:gap-4"
            >
              <div className="min-w-0">
                <p className="font-medium text-foreground">{item.title}</p>
                <p className="mt-0.5 text-sm text-faint">{item.id}</p>
              </div>
              {/* `contents` lets these three share the row's grid columns on
                  wide screens while staying one flex row on narrow ones. */}
              <div className="flex flex-wrap items-center gap-2 md:contents">
                <div>
                  <StatusBadge tone={priorityTone(item.priority)} dot={false}>
                    {item.priority}
                  </StatusBadge>
                </div>
                <div>
                  <StatusBadge tone={riskTone(item.risk)}>{item.risk}</StatusBadge>
                </div>
                <span className="text-sm text-muted">{item.status}</span>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
