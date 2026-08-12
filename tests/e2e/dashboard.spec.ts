import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const primaryNavigation = [
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

test("loads the truthful control-plane dashboard without browser errors", async ({
  page,
}) => {
  const browserErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  const response = await page.goto("/", { waitUntil: "domcontentloaded" });

  expect(response?.ok(), `dashboard returned ${response?.status()}`).toBe(true);
  await expect(page).toHaveTitle(/SoftwareFactory/i);
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator("h1").first()).toBeVisible();
  await expect(page.getByText(/Demo Data/i).first()).toBeVisible();
  await expect(page.getByText(/Not Connected/i).first()).toBeVisible();
  expect(browserErrors, browserErrors.join("\n")).toEqual([]);
});

test("exposes every primary destination through accessible navigation", async ({
  page,
}, testInfo) => {
  await page.goto("/");

  if (testInfo.project.name !== "desktop-chromium") {
    const openNavigation = page.getByRole("button", {
      name: /open navigation/i,
    });
    await expect(openNavigation).toBeVisible();
    await openNavigation.click();
  }

  const navigation = page.getByRole("navigation", { name: /primary/i });
  await expect(navigation).toBeVisible();

  for (const destination of primaryNavigation) {
    await expect(
      navigation.getByRole("link", { name: destination, exact: true }),
    ).toBeVisible();
  }
});

test("keeps core content inside the viewport", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
});

test("has no serious or critical automated accessibility violations", async ({
  page,
}) => {
  await page.goto("/");

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
