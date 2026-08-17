import { expect, test } from "@playwright/test";

/**
 * No horizontal scrolling at any supported width, on any console route.
 *
 * Written as a measurement rather than a screenshot: a snapshot tells you
 * something changed, this tells you *which element* is past the right edge,
 * which is the only part anyone needs to fix it.
 *
 * The widths are the ones people actually hold — 320 is the smallest phone
 * still in use, 430 the largest, 768 and 1024 the tablet pair, and the rest
 * desktop.
 */

const WIDTHS = [320, 375, 390, 430, 768, 1024, 1280, 1440];


const ROUTES = [
  "/solutions",
  "/solutions/projects",
  "/solutions/bot-manager",
  "/solutions/runs",
  "/solutions/reports",
];

/**
 * Waits for the layout to stop moving before measuring.
 *
 * A fixed delay caught the page mid-layout and reported an overflow that a
 * direct probe could not reproduce — fonts and lazy content were still
 * settling. Two consecutive frames at the same width is the signal that the
 * measurement means something.
 */
async function settled(page: import("@playwright/test").Page) {
  await page.evaluate(
    () => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }),
  );
}

async function offenders(page: import("@playwright/test").Page) {
  await settled(page);
  return page.evaluate(() => {
    const root = document.documentElement;
    const past: string[] = [];
    if (root.scrollWidth > root.clientWidth + 1) {
      for (const element of Array.from(document.querySelectorAll("*"))) {
        const box = element.getBoundingClientRect();
        if (box.width > 0 && box.right > root.clientWidth + 1) {
          past.push(`<${element.tagName.toLowerCase()} class="${String(element.className).slice(0, 70)}">`);
        }
      }
    }
    return { documentWidth: root.scrollWidth, viewportWidth: root.clientWidth, past: past.slice(0, 3) };
  });
}

for (const width of WIDTHS) {
  test(`no horizontal overflow at ${width}px`, async ({ page, isMobile }) => {
    /*
     * The sweep drives the viewport itself, so it belongs in a project that can
     * be resized freely. Forcing 1440px inside a mobile device profile — touch
     * emulation, a device pixel ratio, `isMobile` — measures a configuration
     * nobody has, and it was the only thing failing. Scoped here rather than
     * file-wide so the drawer test below still runs on a real phone profile,
     * which is the case that matters for it.
     */
    test.skip(Boolean(isMobile), "viewport sweep runs in the resizable projects");
    await page.setViewportSize({ width, height: 900 });

    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: "domcontentloaded" });

      const result = await offenders(page);
      expect(result.past, `${route} @ ${width}px pushed past the viewport`).toEqual([]);
      expect(
        result.documentWidth,
        `${route} @ ${width}px scrolls horizontally`,
      ).toBeLessThanOrEqual(result.viewportWidth + 1);
    }
  });
}

test("opening every navigation group keeps the layout inside the viewport", async ({ page }) => {
  // Expanding is the case most likely to break the promise: a group that grows
  // the sidebar can push the content column out rather than reflowing beside it.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/solutions", { waitUntil: "domcontentloaded" });

  // Below the sidebar breakpoint the navigation lives in the drawer, so the
  // toggles are not on screen until it is opened. Opening it here keeps this
  // test meaningful at every width instead of only the desktop one — the reflow
  // it checks matters in the drawer too.
  const drawerButton = page.getByRole("button", { name: /open console navigation/i });
  if (await drawerButton.isVisible().catch(() => false)) {
    await drawerButton.click();
  }

  /*
   * Scoped to the *visible* navigation. The shell renders the docked sidebar
   * and the drawer as separate trees, hiding one with CSS, so an unscoped
   * query counts toggles nobody can click — which made the final "everything
   * is open" assertion fail against buttons in the hidden copy.
   */
  const nav = page.getByRole("navigation", { name: /console/i }).filter({ visible: true });
  const toggles = nav.getByRole("button", { name: /expand .* subpages/i });

  // Re-queried each round and driven until none are left, rather than looping a
  // count captured up front: every click removes one "Expand" button from the
  // set, so a fixed count races the shrinking list.
  expect(await toggles.count()).toBeGreaterThan(0);

  for (let opened = 0; opened < 20; opened += 1) {
    if (await toggles.count() === 0) break;

    await toggles.first().click();

    const result = await offenders(page);
    expect(result.past, `opening group ${opened + 1} pushed content past the viewport`).toEqual([]);
  }

  // Every group is open and the page still fits.
  expect(await toggles.count()).toBe(0);
});

test("the drawer leaves content full width when closed", async ({ page }) => {
  await page.goto("/solutions", { waitUntil: "domcontentloaded" });

  const drawerButton = page.getByRole("button", { name: /open console navigation/i });
  // Only meaningful below the sidebar breakpoint; above it the sidebar is
  // supposed to sit beside the content and reserve space.
  test.skip(!(await drawerButton.isVisible().catch(() => false)), "sidebar is docked at this width");

  await settled(page);
  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  const closedWidth = (await page.locator("main").boundingBox())?.width ?? 0;

  // Measured against the real viewport rather than a fixed number, so this
  // means the same thing on every device profile: a closed drawer reserves
  // nothing.
  expect(closedWidth).toBeGreaterThanOrEqual(viewportWidth - 1);

  await drawerButton.click();
  expect((await offenders(page)).past).toEqual([]);
});
