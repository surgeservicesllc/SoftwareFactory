import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { HARNESS_URL } from "../../playwright.config";

const THEME_STORAGE_KEY = "softwarefactory:color-theme";
const PUBLIC_LIGHT_ROUTES = [
  "/",
  "/platform",
  "/features",
  "/pricing",
  "/resources",
  "/about",
  "/auth/sign-in",
  "/auth/sign-up",
] as const;

type Theme = "dark" | "light";

type Palette = {
  readonly backgroundColor: string;
  readonly color: string;
};

const PALETTES = {
  root: {
    dark: { backgroundColor: "rgb(11, 15, 20)", color: "rgb(244, 247, 250)" },
    light: { backgroundColor: "rgb(245, 247, 250)", color: "rgb(23, 32, 43)" },
  },
  services: {
    dark: { backgroundColor: "rgb(11, 15, 20)", color: "rgb(242, 247, 245)" },
    light: { backgroundColor: "rgb(244, 247, 245)", color: "rgb(20, 33, 27)" },
  },
  factory: {
    dark: { backgroundColor: "rgb(7, 7, 13)", color: "rgb(244, 244, 250)" },
    light: { backgroundColor: "rgb(247, 246, 251)", color: "rgb(29, 23, 40)" },
  },
} as const satisfies Record<string, Record<Theme, Palette>>;

async function settled(page: Page) {
  await page.evaluate(
    () => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }),
  );
}

async function openCase(page: Page, layoutCase: string, hasToggle = true) {
  await page.goto(`${HARNESS_URL}/index.html?case=${layoutCase}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("#root")).not.toBeEmpty({ timeout: 15_000 });
  if (hasToggle) {
    await expect(page.getByRole("button", { name: /switch to (?:dark|light) mode/i })).toBeVisible();
  }
  await settled(page);
}

async function computedPalette(locator: Locator): Promise<Palette> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
    };
  });
}

async function expectTheme(page: Page, theme: Theme, persisted: boolean, hasToggle = true) {
  await expect.poll(() => page.locator("html").getAttribute("data-theme")).toBe(theme);
  if (hasToggle) {
    const next = theme === "dark" ? "light" : "dark";
    const toggle = page.getByRole("button", { name: `Switch to ${next} mode` });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", theme === "light" ? "true" : "false");
  }
  expect(await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY))
    .toBe(persisted ? theme : null);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflowBy = await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ));
  expect(overflowBy).toBeLessThanOrEqual(1);
}

async function expectNoSeriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations.filter(({ impact }) => (
    impact === "serious" || impact === "critical"
  ))).toEqual([]);
}

test("the global theme is accessible, persistent and shared by every product shell", async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  // A fresh browser starts dark and exposes one action named for its result.
  await openCase(page, "theme-root");
  await expectTheme(page, "dark", false);
  expect(await computedPalette(page.getByTestId("theme-surface"))).toEqual(PALETTES.root.dark);
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxeViolations(page);

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expectTheme(page, "light", true);
  expect(await computedPalette(page.getByTestId("theme-surface"))).toEqual(PALETTES.root.light);
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxeViolations(page);

  // The explicit choice survives both a reload and navigation between product
  // harness cases on the same origin.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#root")).not.toBeEmpty({ timeout: 15_000 });
  await expectTheme(page, "light", true);

  await openCase(page, "app-shell", false);
  await expectTheme(page, "light", true, false);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  expect(await computedPalette(page.locator("body"))).toEqual(PALETTES.root.light);
  await expectNoHorizontalOverflow(page);

  await openCase(page, "job-search", false);
  await expectTheme(page, "light", true, false);
  await expect(page.getByRole("searchbox", { name: "What to search for" })).toBeVisible();
  expect(await computedPalette(page.locator("body"))).toEqual(PALETTES.root.light);
  await expectNoHorizontalOverflow(page);

  await openCase(page, "theme-budget");
  await expectTheme(page, "light", true);
  expect(await computedPalette(page.getByTestId("theme-surface"))).toEqual(PALETTES.root.light);
  await expectNoHorizontalOverflow(page);

  await openCase(page, "theme-services");
  await expectTheme(page, "light", true);
  expect(await computedPalette(page.getByTestId("theme-surface"))).toEqual(PALETTES.services.light);
  const lightChip = await computedPalette(page.getByTestId("theme-status-chip"));
  const lightPrint = await computedPalette(page.getByTestId("theme-print-surface"));
  expect(lightPrint.backgroundColor).toBe("rgb(255, 255, 255)");
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxeViolations(page);

  await openCase(page, "factory-step");
  await expectTheme(page, "light", true);
  expect(await computedPalette(page.locator(".factory-theme").first())).toEqual(
    PALETTES.factory.light,
  );
  await expectNoHorizontalOverflow(page);

  await openCase(page, "theme-customer");
  await expectTheme(page, "light", true);
  expect(await computedPalette(page.getByTestId("customer-theme-shell"))).toEqual(
    PALETTES.services.light,
  );
  await expectNoHorizontalOverflow(page);

  // Changing the customer-facing product changes the same global choice. The
  // Services status chip follows its dark translation; paper stays paper.
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expectTheme(page, "dark", true);
  expect(await computedPalette(page.getByTestId("customer-theme-shell"))).toEqual(
    PALETTES.services.dark,
  );

  await openCase(page, "theme-services");
  await expectTheme(page, "dark", true);
  expect(await computedPalette(page.getByTestId("theme-surface"))).toEqual(PALETTES.services.dark);
  const darkChip = await computedPalette(page.getByTestId("theme-status-chip"));
  const darkPrint = await computedPalette(page.getByTestId("theme-print-surface"));
  expect(darkChip).not.toEqual(lightChip);
  expect(darkPrint).toEqual(lightPrint);
  expect(darkPrint.backgroundColor).toBe("rgb(255, 255, 255)");
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxeViolations(page);

  await openCase(page, "factory-step");
  await expectTheme(page, "dark", true);
  expect(await computedPalette(page.locator(".factory-theme").first())).toEqual(
    PALETTES.factory.dark,
  );
  await expectNoHorizontalOverflow(page);

  await openCase(page, "theme-budget");
  await expectTheme(page, "dark", true);
  expect(await computedPalette(page.getByTestId("theme-surface"))).toEqual(PALETTES.root.dark);
  await expectNoHorizontalOverflow(page);

  await openCase(page, "app-shell", false);
  await expectTheme(page, "dark", true, false);
  expect(await computedPalette(page.locator("body"))).toEqual(PALETTES.root.dark);
  await expectNoHorizontalOverflow(page);

  await openCase(page, "job-search", false);
  await expectTheme(page, "dark", true, false);
  await expect(page.getByRole("searchbox", { name: "What to search for" })).toBeVisible();
  expect(await computedPalette(page.locator("body"))).toEqual(PALETTES.root.dark);
  await expectNoHorizontalOverflow(page);

  expect(pageErrors).toEqual([]);
});

test("the real public and authentication pages stay accessible and responsive in light mode", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBe(true);
  await expect.poll(() => page.locator("html").getAttribute("data-theme")).toBe("dark");

  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "Open site navigation" }).click();
  }
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expectTheme(page, "light", true);

  for (const route of PUBLIC_LIGHT_ROUTES) {
    const routeResponse = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(routeResponse?.ok(), `${route} returned ${routeResponse?.status()}`).toBe(true);
    await expect(page.locator("main")).toBeVisible();
    await expect.poll(() => page.locator("html").getAttribute("data-theme")).toBe("light");
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAxeViolations(page);
  }

  expect(pageErrors).toEqual([]);
});
