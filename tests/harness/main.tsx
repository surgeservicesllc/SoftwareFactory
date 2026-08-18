import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@/app/globals.css";

import { AiAccountsPanel } from "@/components/ai-accounts-panel";
import { AppShell } from "@/components/app-shell";
import { ProjectBots } from "@/components/project-bots";

import { AI_ACCOUNTS, PROJECT_BOTS_ROSTER, PROJECT_ID } from "./fixtures";

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
    return json({});
  }) as typeof window.fetch;
}

serveFixtures();

const CASES: Record<string, () => React.ReactElement> = {
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
