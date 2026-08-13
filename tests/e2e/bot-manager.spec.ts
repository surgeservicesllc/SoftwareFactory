import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("presents the bot fabric without claiming a connected worker", async ({ page }) => {
  const response = await page.goto("/bot-manager", { waitUntil: "domcontentloaded" });

  expect(response?.ok(), `bot manager returned ${response?.status()}`).toBe(true);
  await expect(page.locator("h1")).toContainText(/bot manager/i);
  await expect(page.getByText(/Worker Not Connected/i).first()).toBeVisible();
});

test("offers a truthful next step instead of a fabricated fleet", async ({ page }) => {
  await page.goto("/bot-manager");

  // Which notice appears depends on the environment: signed out, awaiting
  // organization setup, or an unconfigured control plane. All three are
  // truthful, and none of them may invent bots, roles, or assignments.
  await expect(
    page.getByRole("heading", {
      name: /sign in to manage your bots|complete organization setup|the bot fabric is unavailable/i,
    }),
  ).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /assign /i })).toHaveCount(0);
});

test("keeps the bot fabric inside the viewport", async ({ page }) => {
  await page.goto("/bot-manager");
  await expect(page.locator("main")).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
});

test("has no serious or critical accessibility violations on the bot fabric", async ({
  page,
}) => {
  await page.goto("/bot-manager");
  await expect(page.locator("main")).toBeVisible();

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
