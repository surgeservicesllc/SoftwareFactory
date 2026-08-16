import { ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { GettingStarted } from "@/components/getting-started";
import { LiveDashboardMetrics } from "@/components/live-dashboard-metrics";
import { RecentActivityCard } from "@/components/recent-activity-card";
import { Card, PageHeader, SectionTitle, StatusBadge } from "@/components/ui";
import { WorkerStatusBadge } from "@/components/worker-status";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** The static safety facts; worker connectivity is rendered from heartbeat evidence below. */
const safetyFacts = [
  { label: "Autonomous risk ceiling", value: "GREEN", tone: "safe" as const },
  { label: "Runs work on its own", value: "No", tone: "safe" as const },
];

async function hasAuthenticatedUser() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    return !error && Boolean(data.user);
  } catch {
    return false;
  }
}

export default async function DashboardPage() {
  // This is only a server-rendering hint used to avoid issuing protected
  // browser requests for a visitor who is already known to be signed out.
  // Every API still validates auth.getUser() and RLS independently.
  const authenticated = await hasAuthenticatedUser();

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="What is connected, what it can see, and what it is allowed to do."
      />

      <div className="mb-8">
        <GettingStarted authenticated={authenticated} />
      </div>

      <LiveDashboardMetrics authenticated={authenticated} />

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col p-5">
          <SectionTitle
            title="Safety"
            description="These limits are enforced on the server. No switch on this page can widen them."
          />
          <dl className="mt-4 flex-1 space-y-2">
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
            <div className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
              <dt className="text-sm text-muted">AI worker</dt>
              <dd><WorkerStatusBadge enabled={authenticated} /></dd>
            </div>
          </dl>
          <Link href="/solutions/settings" className="btn btn-secondary btn-sm mt-4 self-start">
            See all safety settings
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Card>

        <RecentActivityCard authenticated={authenticated} />
      </div>

      <p className="mt-6 flex items-start gap-2.5 text-sm text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
        SoftwareFactory records what you ask for and shows you what is in your repository. It does not
        merge, deploy, or change anything outside a draft pull request you review yourself.
      </p>
    </>
  );
}
