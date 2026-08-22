import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@/app/globals.css";

import { ActivityConsole } from "@/components/activity-console";
import { AiFactoryConsole } from "@/components/ai-factory-console";
import { BotManagerWorkspace } from "@/components/bot-manager-workspace";
import { CommandComposer } from "@/components/command-composer";
import { FactoryBriefing } from "@/components/factory-briefing";
import { GettingStarted } from "@/components/getting-started";
import { GraphExecutionSummary } from "@/components/graph-execution-summary";
import { GraphLaunchControl } from "@/components/graph-launch-control";
import { LiveDashboardMetrics } from "@/components/live-dashboard-metrics";
import { NeedsYourAttention } from "@/components/needs-your-attention";
import { PortfolioControls } from "@/components/portfolio-controls";
import { ProjectDetailConsole } from "@/components/project-detail-console";
import { RecentActivityCard } from "@/components/recent-activity-card";
import { WorkflowsConsole } from "@/components/workflows-console";
import { AgentOsConsole } from "@/components/agentos-console";
import { AutonomyConsole } from "@/components/autonomy-console";
import { BotFabricConsole } from "@/components/bot-fabric-console";
import { BotManagerHome } from "@/components/bot-manager/home";
import { BotUsageConsole } from "@/components/bot-usage-console";
import { JobSeekerConsole } from "@/components/job-seeker/console";
import { ResumeReviewPanel } from "@/components/job-seeker/resume-review-panel";
import { GitHubFileManager } from "@/components/github-file-manager";
import { MyProjectsConsole } from "@/components/my-projects-console";
import { OperationsConsole } from "@/components/operations-console";
import { PipelineTemplatesManager } from "@/components/pipeline-templates-manager";
import { PipelinesConsole } from "@/components/pipelines-console";
import { PortfolioConsole } from "@/components/portfolio-console";
import { ProviderSettings } from "@/components/provider-settings";
import { ResourceManagerConsole } from "@/components/resource-manager-console";
import { SafetyControls } from "@/components/safety-controls";
import { AgentsConsole } from "@/components/agents-console";
import { AiAccountsPanel } from "@/components/ai-accounts-panel";
import { AppShell } from "@/components/app-shell";
import { SiteHeader } from "@/components/marketing/site-header";
import { BacklogConsole } from "@/components/backlog-console";
import { ConnectionsConsole } from "@/components/connections-console";
import { ProjectBots } from "@/components/project-bots";
import { ProjectsConsole } from "@/components/projects-console";
import { ReportsConsole } from "@/components/reports-console";
import { RunsConsole } from "@/components/runs-console";

import { buildPortfolio } from "@/lib/portfolio/aggregate";

import {
  ACTIVITY,
  AGENTOS_CHAINS,
  AGENTOS_GOALS,
  AGENTOS_GRANTS,
  AGENTOS_MESSAGES,
  AGENTOS_TRIGGERS,
  AGENTS,
  AI_ACCOUNTS,
  AUTONOMY_CONTROLS,
  AUTONOMY_DECISIONS,
  AUTONOMY_STATUS,
  COMMANDS,
  CONNECTIONS,
  CUSTOM_PIPELINE_TEMPLATES,
  FACTORY_BRIEFING_AGENTS,
  FACTORY_BRIEFING_CONNECTIONS,
  FACTORY_BRIEFING_RUNS,
  OPERATIONS_OVERVIEW,
  JOB_SEEKER_PREFERENCES,
  JOB_SEEKER_PROFILE,
  PORTFOLIO_SCHEDULING,
  PORTFOLIO_SOURCES,
  PROJECT_BOTS_ROSTER,
  PROJECT_ID,
  PROJECT_OPERATIONS,
  PROJECT_PIPELINES,
  PROJECTS,
  PROVIDER_STATUS,
  REPORTS,
  RESOURCE_MODELS,
  RESOURCES_OVERVIEW,
  STALE_AI_ACCOUNTS,
  RUNS,
  TEMPLATES,
  WORKER_STATUS,
  WORKFLOW_TEMPLATES,
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

  /*
   * Anything not served above answers like a failing endpoint, not like a
   * successful empty one.
   *
   * This used to `return json({})`: a 200 with no keys. Components believed
   * it. `AgentsConsole` read `/api/providers`, got `{}`, entered its ready
   * state, and threw on `payload.providers.map` — the case rendered nothing
   * at all while the width sweep reported it fitting at every width. An
   * unserved endpoint is a gap in the harness, and the honest rendering of a
   * gap is the component's documented error path.
   */
  const unserved = (url: string) => {
    console.warn(`[harness] no fixture for ${url}; answering 503`);
    return Promise.resolve({
      ok: false,
      status: 503,
      json: async () => ({ error: { message: `No harness fixture for ${url}` } }),
    } as unknown as Response);
  };

  window.fetch = ((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/bots") && url.includes("/projects/")) return json(PROJECT_BOTS_ROSTER);
    // Order matters: the more specific bot routes before the fabric snapshot.
    if (url.includes("/api/bots/providers")) return json({ providers: [] });
    if (url.includes("/api/bots")) {
      return json({
        activeOrganizationId: "10000000-0000-4000-8000-000000000001",
        canManage: true,
        bots: PROJECT_BOTS_ROSTER.available,
        roles: PROJECT_BOTS_ROSTER.roles,
        assignments: PROJECT_BOTS_ROSTER.assigned,
        projects: PROJECTS,
        executor: {
          connected: false,
          label: "Not Connected",
          detail: "No worker is connected in this phase.",
          globalKillSwitchActive: true,
        },
      });
    }
    if (url.includes("/api/job-seeker/profile")) return json({ profile: JOB_SEEKER_PROFILE });
    if (url.includes("/api/job-seeker/preferences")) return json({ preferences: JOB_SEEKER_PREFERENCES });
    if (url.includes("/api/ai-accounts/usage")) return json({ usage: [] });
    /*
     * `canManage` matters: the Bot Manager renders read-only without it, so
     * every management control — Add AI Account, Create Bot, Add to project,
     * rename, remove — was absent from the harness and therefore from the
     * width sweep. The route returns it for an owner or an admin; so does
     * this.
     */
    if (url.includes("/api/ai-accounts")) {
      // The stalled case swaps in the owner's four-stale-accounts state.
      return json({
        accounts: window.location.search.includes("case=bot-manager-stalled")
          ? STALE_AI_ACCOUNTS
          : AI_ACCOUNTS,
        canManage: true,
      });
    }
    if (url.includes("/api/project-pipelines")) {
      return json({ available: true, canManage: true, pipelines: PROJECT_PIPELINES });
    }
    if (url.includes("/api/pipeline-templates")) {
      return json({ templates: CUSTOM_PIPELINE_TEMPLATES, canManage: true });
    }
    if (url.includes("/api/graphs/runs")) return json({ runs: [] });
    if (url.includes("/api/runs?limit=100")) return json({ runs: FACTORY_BRIEFING_RUNS });
    if (url.includes("/api/runs")) return json({ runs: RUNS });
    if (url.includes("/api/reports")) return json({ reports: REPORTS });
    if (url.includes("/api/project-agents")) {
      return json({
        available: true,
        canManage: true,
        selections: [{
          id: "dddddddd-2222-4222-8222-222222222222",
          projectId: PROJECT_ID,
          agentId: AGENTS[0].id,
          agentName: AGENTS[0].name,
          agentRole: AGENTS[0].role,
          selectedAt: "2026-08-22T00:00:00.000Z",
        }],
      });
    }
    if (url.includes("/api/agents?limit=100")) return json({ agents: FACTORY_BRIEFING_AGENTS });
    if (url.includes("/api/agents")) return json({ agents: AGENTS });
    if (url.includes("/api/activity")) return json({ events: ACTIVITY });
    if (url.includes("/api/github/connections?view=briefing")) {
      return json({ connections: FACTORY_BRIEFING_CONNECTIONS });
    }
    if (url.includes("/api/github/connections")) return json({ connections: CONNECTIONS });
    if (url.includes("/api/projects")) return json({ projects: PROJECTS });
    if (url.includes("/api/tasks") || url.includes("/api/backlog")) return json({ tasks: [] });
    if (url.includes("/api/organizations")) {
      return json({ organizations: [], activeOrganization: { id: "org-1", role: "owner" } });
    }
    if (url.includes("/api/providers")) return json(PROVIDER_STATUS);
    /*
     * The portfolio payload is built by the same pure aggregator the route
     * uses, not transcribed from it. `buildPortfolio` is what turns rows into
     * what the browser receives, so this fixture cannot drift out of shape the
     * way the reports one silently had.
     */
    if (url.includes("/api/portfolio/scheduling")) return json({ scheduling: PORTFOLIO_SCHEDULING });
    if (url.includes("/api/portfolio")) return json({ portfolio: buildPortfolio(PORTFOLIO_SOURCES) });
    if (url.includes("/api/operations/overview")) return json(OPERATIONS_OVERVIEW);
    if (url.includes("/api/operations/projects/")) return json(PROJECT_OPERATIONS);
    if (url.includes("/api/resources/models")) return json(RESOURCE_MODELS);
    if (url.includes("/api/resources/overview")) return json(RESOURCES_OVERVIEW);
    if (url.includes("/api/agentos/grants")) return json({ agentGrants: AGENTOS_GRANTS });
    if (url.includes("/api/agentos/inbox")) return json({ messages: AGENTOS_MESSAGES });
    if (url.includes("/api/agentos/goals")) return json({ goals: AGENTOS_GOALS });
    if (url.includes("/api/agentos/chains")) return json({ chains: AGENTOS_CHAINS });
    if (url.includes("/api/agentos/triggers")) return json({ triggers: AGENTOS_TRIGGERS });
    if (url.includes("/api/autonomy/controls")) return json(AUTONOMY_CONTROLS);
    if (url.includes("/api/autonomy/status")) return json({ status: AUTONOMY_STATUS });
    if (url.includes("/api/autonomy/decisions")) return json({ decisions: AUTONOMY_DECISIONS });
    if (url.includes("/api/worker/status")) return json({ worker: WORKER_STATUS });
    if (url.includes("/api/commands")) return json({ commands: COMMANDS });
    return unserved(url);
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
  "my-projects": () => <InShell><MyProjectsConsole /></InShell>,
  portfolio: () => <InShell><PortfolioConsole /></InShell>,
  pipelines: () => <InShell><PipelinesConsole templates={TEMPLATES} /></InShell>,
  agentos: () => <InShell><AgentOsConsole /></InShell>,
  autonomy: () => <InShell><AutonomyConsole /></InShell>,
  "bot-usage": () => <InShell><BotUsageConsole /></InShell>,
  "job-seeker": () => <InShell><JobSeekerConsole /></InShell>,
  /*
   * The resume review panel only exists after an upload, so the job-seeker
   * case above never renders it and it had no width coverage at all. Its
   * content is the widest thing on that page — a long employment line and a
   * comma-joined skills list — which is exactly the shape that overflows a
   * 320px column.
   */
  "resume-review": () => (
    <InShell>
      <ResumeReviewPanel
        busy={false}
        onApply={() => {}}
        onDismiss={() => {}}
        extraction={{
          id: "a0000000-0000-4000-8000-0000000000e1",
          status: "reviewed",
          model: "claude-opus-5",
          detail: "Reviewed by claude-opus-5.",
          proposal: {
            fullName: "Dana Okafor",
            email: "dana.okafor@example.com",
            phone: "+1 (415) 555-0148",
            linkedinUrl: "https://www.linkedin.com/in/danaokafor",
            location: "Oakland, CA",
            summary:
              "Platform engineer with eleven years building developer infrastructure at scale, "
              + "most recently leading the migration of four hundred repositories onto a shared "
              + "continuous integration platform.",
            employmentHistory: [
              {
                organization: "Northwind Systems International",
                title: "Staff Platform Engineer",
                started: "2021",
                ended: "Present",
              },
              {
                organization: "Helio Labs",
                title: "Senior Software Engineer",
                started: "2017",
                ended: "2021",
              },
            ],
            skills: ["Go", "TypeScript", "PostgreSQL", "Terraform", "Kubernetes", "Distributed systems"],
            technologies: ["Next.js", "Supabase", "GitHub Actions"],
          },
          sources: {
            fullName: "pattern",
            email: "pattern",
            phone: "pattern",
            linkedinUrl: "pattern",
            location: "pattern",
            summary: "model",
            employmentHistory: "model",
            skills: "pattern",
            technologies: "model",
          },
          proposedFieldCount: 9,
          characterCount: 4200,
          truncated: false,
          appliedAt: null,
        }}
      />
    </InShell>
  ),
  "bot-fabric": () => <InShell><BotFabricConsole /></InShell>,
  "bot-manager": () => <InShell><BotManagerHome /></InShell>,
  /*
   * The same component as the AI Factory hands it: a project in context, so
   * the in-place Add Bots row exists to be measured. Without a case for it the
   * width sweep only ever saw the standalone form.
   */
  /*
   * The screenshot state: every account stale, no bots. The case exists to
   * prove the journey still has a way forward from there.
   */
  "bot-manager-stalled": () => (
    <InShell>
      <BotManagerHome
        projectContext={{ id: PROJECT_ID, name: "E-Commerce Platform" }}
        onFinished={() => {}}
      />
    </InShell>
  ),
  "bot-manager-in-journey": () => (
    <InShell>
      <BotManagerHome
        projectContext={{ id: PROJECT_ID, name: "E-Commerce Platform" }}
        onFinished={() => {}}
      />
    </InShell>
  ),
  /*
   * The manager with pipelines already selected. A selected card is a layout
   * that only exists once something is selected — grey Use with a check, and
   * a summary counting them above the grid — so it needs its own case or the
   * sweep only ever measures the unselected one.
   */
  "pipeline-templates-selected": () => (
    <InShell>
      <PipelineTemplatesManager
        builtIns={TEMPLATES}
        projectContext={{ id: PROJECT_ID, name: "E-Commerce Platform" }}
      />
    </InShell>
  ),
  files: () => <InShell><GitHubFileManager /></InShell>,
  operations: () => <InShell><OperationsConsole authenticated /></InShell>,
  resources: () => <InShell><ResourceManagerConsole authenticated /></InShell>,
  safety: () => <InShell><SafetyControls /></InShell>,
  "provider-settings": () => <InShell><ProviderSettings /></InShell>,
  "ai-factory": () => <InShell><AiFactoryConsole builtIns={TEMPLATES} /></InShell>,
  workflows: () => <InShell><WorkflowsConsole templates={WORKFLOW_TEMPLATES} /></InShell>,
  "bot-workspace": () => <InShell><BotManagerWorkspace /></InShell>,
  composer: () => <InShell><CommandComposer /></InShell>,
  "getting-started": () => <InShell><GettingStarted authenticated /></InShell>,
  "graph-summary": () => (
    <InShell><GraphExecutionSummary templateKey={TEMPLATES[0].key} /></InShell>
  ),
  "graph-launch": () => (
    <InShell>
      <GraphLaunchControl templateKey={TEMPLATES[0].key} templateName={TEMPLATES[0].name} />
    </InShell>
  ),
  "dashboard-metrics": () => <InShell><LiveDashboardMetrics authenticated /></InShell>,
  "factory-briefing": () => <InShell><FactoryBriefing authenticated /></InShell>,
  attention: () => <InShell><NeedsYourAttention authenticated /></InShell>,
  "portfolio-controls": () => <InShell><PortfolioControls /></InShell>,
  "project-detail": () => <InShell><ProjectDetailConsole projectId={PROJECT_ID} /></InShell>,
  "recent-activity": () => <InShell><RecentActivityCard authenticated /></InShell>,
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
  /*
   * The global header as a signed-in super administrator sees it.
   *
   * The browser suite browses signed out, so this state had no coverage above
   * the unit tests at all — and it is the one the owner specified: AI Factory,
   * Job Seeker, Admin, then the badge, the address and the account controls.
   * Deliberately not in the layout sweep's CASES: it is checked by one test
   * that reads the entries, rather than by the click-everything measurement,
   * whose sweep would find the sign-out button.
   */
  "site-header": () => (
    <SiteHeader
      viewer={{
        signedIn: true,
        email: "owner@example.org",
        displayName: null,
        isSuperAdmin: true,
      }}
    />
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
