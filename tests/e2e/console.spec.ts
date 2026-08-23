import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The console's reachability contract: every label a person can click, in a
// live browser, after opening every group. This is the strongest statement the
// repository makes that a destination is not merely declared but reachable —
// a jsdom test asserts the shell renders a link, and this asserts the page
// actually serves one.
//
// Restructured 2026-08-23 around the lifecycle: five primary destinations, the
// ten stages under AI Factory, and the surfaces that had no lifecycle home
// grouped under Operations and System rather than dropped.
const consoleNavigation = [
  "Overview",
  "Projects",
  "All Projects",
  "My Projects",
  "Portfolio",
  "Backlog",
  "Archived",
  "AI Factory",
  // The ten stages, numbered. Listed literally rather than derived from
  // SDLC_LIFECYCLE on purpose: this file is the outside view, and importing
  // the same table the navigation is built from would let a rename pass on
  // both sides at once.
  "1 Requirement",
  "2 Discover",
  "3 Evaluate",
  "4 Decide",
  "5 Architect",
  "6 Build",
  "7 Review",
  "8 Test",
  "9 Deploy",
  "10 Monitor",
  "Operations",
  "Runs",
  "Agents",
  "Pipelines",
  "Artifacts",
  "Reports",
  "Bots",
  "Bot Usage",
  "Templates",
  "Activity",
  "Health",
  "System",
  "Integrations",
  "Secrets",
  "Settings",
  "Files",
  "Resources",
  "AgentOS",
  "Autonomy",
] as const;

const CONSOLE_ROUTE = "/solutions/projects";

test("loads the control plane without browser errors", async ({
  page,
}) => {
  const browserErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // Same fail-closed API responses the response listener already excludes;
    // the browser reports them a second time as a resource-load failure.
    if (/Failed to load resource.*(401|403|409|503)/.test(message.text())) return;
    browserErrors.push(message.text());
  });
  page.on("response", (response) => {
    const status = response.status();
    if (status < 400) return;
    // Authenticated APIs fail closed when no session or provider is configured.
    // 401/403/409/503 from /api/* is the documented behavior, not an error.
    const expectedFailClosed = [401, 403, 409, 503].includes(status)
      && new URL(response.url()).pathname.startsWith("/api/");
    if (!expectedFailClosed) browserErrors.push(`${status} ${response.url()}`);
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  const response = await page.goto(CONSOLE_ROUTE, { waitUntil: "domcontentloaded" });

  expect(response?.ok(), `console returned ${response?.status()}`).toBe(true);
  await expect(page).toHaveTitle(/AI Software Factory/i);
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator("h1").first()).toBeVisible();
  // The console shell carries no brand of its own at any breakpoint: the
  // marketing global navigation sits directly above it and already states the
  // identity, so the sidebar's logo and then the mobile header's workspace
  // chip were both removed as the same duplication. This asserts the brand
  // affordance that actually survives — on every breakpoint, signed in or out.
  await expect(
    page.getByRole("link", { name: /ai factory home/i }).first(),
  ).toBeVisible();
  // Every surface now reads live tenant records, so there is no seeded
  // content left to label. The truthfulness contract is stronger this way:
  // rather than labelling fake rows, the console shows none at all.
  await expect(page.getByText(/Demo Data/i)).toHaveCount(0);
  // A signed-out or locally unconfigured visitor cannot truthfully determine
  // tenant-scoped provider state. The console must expose that exact boundary
  // rather than claim live project or worker state.
  await expect(
    page.getByRole("heading", {
      name: /Sign in (?:required|to see your projects)|Projects are unavailable/i,
    }).first(),
  ).toBeVisible();
  expect(browserErrors, browserErrors.join("\n")).toEqual([]);
});

test("exposes every console destination through accessible navigation", async ({
  page,
}, testInfo) => {
  await page.goto(CONSOLE_ROUTE);

  if (testInfo.project.name !== "desktop-chromium") {
    const openNavigation = page.getByRole("button", {
      name: /open console navigation/i,
    });
    await expect(openNavigation).toBeVisible();
    await openNavigation.click();
  }

  const navigation = page.getByRole("navigation", { name: /console/i });
  await expect(navigation).toBeVisible();

  // Groups arrive closed, so every destination is reachable rather than
  // listed. Opening them all is what "reachable" means here — the assertion
  // below is unchanged, and a destination that no chevron reveals still fails.
  for (let opened = 0; opened < 20; opened += 1) {
    const next = navigation.getByRole("button", { name: /expand .* subpages/i }).first();
    if (await next.count() === 0) break;
    await next.click();
  }

  for (const destination of consoleNavigation) {
    await expect(
      navigation.getByRole("link", { name: destination, exact: true }),
    ).toBeVisible();
  }
});

test("keeps console content inside the viewport", async ({ page }) => {
  await page.goto(CONSOLE_ROUTE);
  await expect(page.locator("main")).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
});

test("has no serious or critical console accessibility violations", async ({
  page,
}) => {
  await page.goto(CONSOLE_ROUTE);

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
          `[${impact}] ${id}: ${help} (${nodes.length} node(s))`,
      )
      .join("\n"),
  ).toEqual([]);
});
