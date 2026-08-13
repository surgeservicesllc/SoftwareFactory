import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const consoleNavigation = [
  "Dashboard",
  "Projects",
  "Bot Manager",
  "Files",
  "Agents",
  "Backlog",
  "Runs",
  "Reports",
  "Connections",
  "Activity",
  "Settings",
] as const;

const CONSOLE_ROUTE = "/projects";

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
  await expect(page.getByRole("link", { name: /softwarefactory dashboard/i }).first()).toBeVisible();
  expect(browserErrors, browserErrors.join("\n")).toEqual([]);
});

test("exposes every console destination through accessible navigation", async ({
  page,
}, testInfo) => {
  await page.goto(CONSOLE_ROUTE);

  if (testInfo.project.name !== "desktop-chromium") {
    const openNavigation = page.getByRole("button", {
      name: /open navigation/i,
    });
    await expect(openNavigation).toBeVisible();
    await openNavigation.click();
  }

  const navigation = page.getByRole("navigation", { name: /console/i });
  await expect(navigation).toBeVisible();

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
