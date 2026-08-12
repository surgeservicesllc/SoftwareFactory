import { ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { LiveDashboardMetrics } from "@/components/live-dashboard-metrics";
import { Card, DemoBadge, PageHeader, SectionTitle, StatusBadge } from "@/components/ui";
import { demoActivity } from "@/lib/demo-data";

/** The three facts about safety that people actually need, stated plainly. */
const safetyFacts = [
  { label: "Highest risk allowed", value: "GREEN", tone: "safe" as const },
  { label: "Runs work on its own", value: "No", tone: "safe" as const },
  { label: "AI worker", value: "Not Connected", tone: "neutral" as const },
];

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="What is connected, what it can see, and what it is allowed to do."
      />

      <LiveDashboardMetrics />

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle
            title="Safety"
            description="These limits are enforced on the server. No switch on this page can widen them."
          />
          <dl className="mt-4 space-y-2">
            {safetyFacts.map((fact) => (
              <div
                key={fact.label}
                className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5"
              >
                <dt className="text-sm text-muted">{fact.label}</dt>
                <dd>
                  <StatusBadge tone={fact.tone}>{fact.value}</StatusBadge>
                </dd>
              </div>
            ))}
          </dl>
          <Link href="/settings" className="btn btn-secondary btn-sm mt-4">
            See all safety settings
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Card>

        <Card className="p-5">
          <SectionTitle
            title="What a busy day looks like"
            description="A preview of the activity feed once agents are connected."
            action={<DemoBadge />}
          />
          <ul className="mt-4 space-y-2">
            {demoActivity.slice(0, 3).map((event) => (
              <li key={event.id} className="rounded-lg border border-line px-3 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="text-sm font-medium text-foreground">{event.action}</p>
                  <time className="text-xs text-faint">{event.time}</time>
                </div>
                <p className="mt-1 text-sm text-muted">{event.detail}</p>
              </li>
            ))}
          </ul>
          <Link href="/activity" className="btn btn-secondary btn-sm mt-4">
            Open your real activity
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Card>
      </div>

      <p className="mt-6 flex items-start gap-2.5 text-sm text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
        SoftwareFactory records what you ask for and shows you what is in your repository. It does not
        merge, deploy, or change anything outside a draft pull request you review yourself.
      </p>
    </>
  );
}
