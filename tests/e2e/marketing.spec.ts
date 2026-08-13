import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const MARKETING_NAV = [
  "Platform",
  "Features",
  "Solutions",
  "Pricing",
  "Resources",
  "About",
] as const;

const MARKETING_ROUTES = [
  { path: "/", heading: /ship better software/i },
  { path: "/platform", heading: /one platform/i },
  { path: "/features", heading: /the features behind/i },
  { path: "/pricing", heading: /simple, transparent pricing/i },
  { path: "/resources", heading: /resources to help you build/i },
  { path: "/about", heading: /building the future/i },
] as const;

async function openNavigation(page: Page, projectName: string) {
  if (projectName === "desktop-chromium") return;
  const openNavigationButton = page.getByRole("button", { name: /open site navigation/i });
  await expect(openNavigationButton).toBeVisible();
  await openNavigationButton.click();
}

for (const route of MARKETING_ROUTES) {
  test(`renders ${route.path} with its headline and no horizontal overflow`, async ({ page }) => {
    const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });

    expect(response?.ok(), `${route.path} returned ${response?.status()}`).toBe(true);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(route.heading);
    await expect(page.locator("main")).toBeVisible();

    // Test the property a reader actually experiences: the page must not scroll
    // sideways. `documentElement.scrollWidth` over-reports once a legitimate
    // inner scroll container (the pricing comparison table) is on the page.
    const overflow = await page.evaluate(() => {
      window.scrollTo(9999, 0);
      const scrolled = window.scrollX;
      window.scrollTo(0, 0);
      return {
        scrolled,
        bodyWidth: document.body.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      };
    });
    expect(overflow.scrolled, `${route.path} scrolls horizontally`).toBe(0);
    expect(overflow.bodyWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  });
}

test("exposes every marketing destination through accessible navigation", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await openNavigation(page, testInfo.project.name);

  const navigation = page
    .getByRole("navigation", { name: testInfo.project.name === "desktop-chromium" ? /primary/i : /mobile/i })
    .first();
  await expect(navigation).toBeVisible();

  for (const destination of MARKETING_NAV) {
    await expect(navigation.getByRole("link", { name: destination, exact: true })).toBeVisible();
  }
});

// Solutions is the console entry point: the marketing nav hands off to the
// dashboard, which renders inside the app shell rather than the marketing one.
test("navigates from the home page to the console dashboard", async ({ page }, testInfo) => {
  await page.goto("/");
  await openNavigation(page, testInfo.project.name);

  await page.getByRole("link", { name: "Solutions", exact: true }).first().click();
  await expect(page).toHaveURL(/\/solutions$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/dashboard/i);
});

test("labels seeded marketing copy as Demo Data rather than presenting it as live", async ({
  page,
}) => {
  await page.goto("/pricing");

  // Without a configured Supabase the page must fall back *and say so*.
  await expect(page.getByText(/demo data/i).first()).toBeVisible();
  await expect(page.getByText(/no billing provider is connected/i)).toBeVisible();
});

test("switches pricing between monthly and yearly billing", async ({ page }) => {
  await page.goto("/pricing");

  const toggle = page.getByRole("switch", { name: /pay yearly/i });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("$29", { exact: true })).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("$23.20", { exact: true })).toBeVisible();
});

test("filters the resource library from the search field", async ({ page }) => {
  await page.goto("/resources");

  const search = page.getByRole("searchbox", { name: /search guides/i });
  await search.fill("checklist");
  await expect(page.getByRole("heading", { name: /results for/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /production readiness checklist/i })).toBeVisible();

  await search.fill("nothing matches this query");
  await expect(page.getByText(/no resources match/i)).toBeVisible();
});

for (const route of MARKETING_ROUTES) {
  test(`has no serious or critical accessibility violations on ${route.path}`, async ({ page }) => {
    await page.goto(route.path);
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
}
