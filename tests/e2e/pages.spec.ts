import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * The dashboard spec covers the landing experience in depth. This spec walks
 * every remaining destination so a shared style or layout change cannot
 * regress contrast, heading structure, or responsive width on a page nobody
 * happened to open.
 *
 * Pages that need a session render their signed-out or unconfigured state
 * here, which is exactly the state most visitors meet first.
 */
const routes = [
  // The console home moved to /solutions when / became the marketing landing.
  { path: "/solutions", heading: "Dashboard" },
  { path: "/solutions/ai-factory", heading: "AI Factory" },
  { path: "/solutions/operations", heading: "Operations" },
  { path: "/solutions/projects", heading: "All Projects" },
  { path: "/solutions/myprojects", heading: "My Projects" },
  { path: "/solutions/portfolio", heading: "Portfolio" },
  // A dynamic route with an id nothing owns: renders the honest missing state
  // signed-out, which is what this suite exercises everywhere.
  { path: "/solutions/portfolio/00000000-0000-4000-8000-00000000dead", heading: "Project detail" },
  { path: "/solutions/files", heading: "Files" },
  { path: "/solutions/bot-manager", heading: "Bot Manager" },
  { path: "/solutions/bot-usage", heading: "Bot Usage" },
  { path: "/solutions/connections", heading: "Connections" },
  { path: "/solutions/activity", heading: "Activity" },
  { path: "/solutions/settings", heading: "Safety" },
  { path: "/solutions/agents", heading: "Agents" },
  { path: "/solutions/resources", heading: "Resource manager" },
  { path: "/solutions/pipelines", heading: "Pipelines" },
  { path: "/solutions/workflows", heading: "Workflows" },
  { path: "/solutions/backlog", heading: "Backlog" },
  { path: "/solutions/runs", heading: "Runs" },
  { path: "/solutions/reports", heading: "Reports" },
  { path: "/solutions/agentos", heading: "AgentOS" },
  { path: "/solutions/autonomy", heading: "Autonomy" },
  { path: "/auth/sign-in", heading: "Sign in" },
  { path: "/auth/sign-up", heading: "Create your account" },
] as const;

for (const { path, heading } of routes) {
  test(`${path} renders its heading, stays in the viewport, and passes axe`, async ({ page }) => {
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(response?.ok(), `${path} returned ${response?.status()}`).toBe(true);

    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();

    // Metadata resolves through nested layouts, so a title can silently pick up
    // the wrong ancestor: the console once rendered the marketing home page's
    // title on every page, then rendered the site name twice.
    const title = await page.title();
    expect(title, `${path} has no distinguishing title`).not.toBe(
      "AI Software Factory — Build, Deploy and Scale with AI",
    );
    expect(
      title.split("AI Software Factory").length - 1,
      `${path} repeats the site name: ${title}`,
    ).toBeLessThanOrEqual(1);

    // Client consoles settle into a signed-out or unconfigured state; wait for
    // the loading spinner to clear so axe sees the real content.
    await expect(page.locator('[aria-label*="Loading"]')).toHaveCount(0, { timeout: 15_000 });

    /*
     * One global navigation, on every page.
     *
     * The authentication pages sit outside both route groups, so they
     * inherited only the root layout and rendered no header at all — the
     * product's name was in the tab and nowhere on screen, with no way back
     * to the site. Asserted for every route rather than for those two, so a
     * future route group cannot quietly become another exception.
     */
    await expect(
      page.getByRole("link", { name: /ai software factory (home|console home)/i }).first(),
      `${path} renders no global brand link`,
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Primary" }).or(
        page.getByRole("button", { name: /open site navigation/i }),
      ).first(),
      `${path} renders no global navigation`,
    ).toBeAttached();

    const dimensions = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.contentWidth, `${path} scrolls horizontally`).toBeLessThanOrEqual(
      dimensions.viewportWidth,
    );

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const blockingViolations = results.violations.filter(({ impact }) =>
      impact === "serious" || impact === "critical",
    );

    expect(
      blockingViolations,
      blockingViolations
        .map(
          ({ id, impact, help, nodes }) =>
            `${path} [${impact}] ${id}: ${help}\n${nodes
              .map((node) => `  ${node.html}`)
              .join("\n")}`,
        )
        .join("\n"),
    ).toEqual([]);
  });
}
