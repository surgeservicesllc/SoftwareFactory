import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@/app/globals.css";

import { ActivityConsole } from "@/components/activity-console";
import { AgentsConsole } from "@/components/agents-console";
import { AiAccountsPanel } from "@/components/ai-accounts-panel";
import { AppShell } from "@/components/app-shell";
import { BacklogConsole } from "@/components/backlog-console";
import { ConnectionsConsole } from "@/components/connections-console";
import { ProjectBots } from "@/components/project-bots";
import { ProjectsConsole } from "@/components/projects-console";
import { ReportsConsole } from "@/components/reports-console";
import { RunsConsole } from "@/components/runs-console";

import {
  ACTIVITY,
  AGENTS,
  AI_ACCOUNTS,
  CONNECTIONS,
  PROJECT_BOTS_ROSTER,
  PROJECT_ID,
  PROJECTS,
  REPORTS,
  RUNS,
} from "./fixtures";

/**
 * Serves the fixture reads these components make.
 *
 * Installed before render rather than intercepted from the test, so a
 * component that fetches on mount never sees a real network — the harness is
 * a layout probe, and a request escaping it would make the measurement depend
 * on whatever answered.
 */
function serveFixtures() {
  const json = (body: unknown) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => body,
    } as unknown as Response);

  window.fetch = ((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/bots") && url.includes("/projects/")) return json(PROJECT_BOTS_ROSTER);
    if (url.includes("/api/ai-accounts/usage")) return json({ usage: [] });
    if (url.includes("/api/ai-accounts")) return json({ accounts: AI_ACCOUNTS });
    if (url.includes("/api/runs")) return json({ runs: RUNS });
    if (url.includes("/api/reports")) return json({ reports: REPORTS });
    if (url.includes("/api/agents")) return json({ agents: AGENTS });
    if (url.includes("/api/activity")) return json({ events: ACTIVITY });
    if (url.includes("/api/github/connections")) return json({ connections: CONNECTIONS });
    if (url.includes("/api/projects")) return json({ projects: PROJECTS });
    if (url.includes("/api/tasks") || url.includes("/api/backlog")) return json({ tasks: [] });
    if (url.includes("/api/organizations")) {
      return json({ organizations: [], activeOrganization: { id: "org-1", role: "owner" } });
    }
    return json({});
  }) as typeof window.fetch;
}

serveFixtures();

/** Each console renders inside the shell it really lives in. */
function InShell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell viewer={{ signedIn: true, email: "owner@example.org" }}>
      <div className="p-4">{children}</div>
    </AppShell>
  );
}

const CASES: Record<string, () => React.ReactElement> = {
  runs: () => <InShell><RunsConsole /></InShell>,
  reports: () => <InShell><ReportsConsole /></InShell>,
  agents: () => <InShell><AgentsConsole /></InShell>,
  activity: () => <InShell><ActivityConsole /></InShell>,
  backlog: () => <InShell><BacklogConsole /></InShell>,
  connections: () => <InShell><ConnectionsConsole /></InShell>,
  projects: () => <InShell><ProjectsConsole /></InShell>,
  "project-bots": () => (
    <div className="bg-background p-4">
      <ProjectBots projectId={PROJECT_ID} projectName="E-Commerce Platform" />
    </div>
  ),
  "ai-accounts": () => (
    <div className="bg-background p-4">
      <AiAccountsPanel canManage onChanged={() => {}} />
    </div>
  ),
  "app-shell": () => (
    <AppShell viewer={{ signedIn: true, email: "owner@example.org", isSuperAdmin: true }}>
      <div className="p-4">
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <p className="mt-2 text-muted">Content beside the navigation.</p>
      </div>
    </AppShell>
  ),
};

const requested = new URLSearchParams(window.location.search).get("case") ?? "project-bots";
const render = CASES[requested];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {render ? render() : <p>Unknown case: {requested}</p>}
  </StrictMode>,
);
