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
  "/",
  "/about",
  "/features",
  "/platform",
  "/pricing",
  "/resources",
  "/auth/sign-in",
  "/auth/sign-up",
  "/solutions",
  "/solutions/activity",
  "/solutions/agents",
  "/solutions/agentos",
  // The factory embeds the console's densest controls step by step, plus a
  // horizontal step band that must compress rather than push the edge.
  "/solutions/ai-factory",
  "/solutions/autonomy",
  "/solutions/backlog",
  "/solutions/build",
  "/solutions/billing",
  "/solutions/bot-manager",
  "/solutions/bot-usage",
  "/solutions/connections",
  "/solutions/files",
  "/solutions/myprojects",
  "/solutions/operations",
  "/solutions/pipelines",
  "/solutions/portfolio",
  // The project page carries the bot roster and the assign wizard's entry
  // point, which is the densest row of controls in the console.
  "/solutions/portfolio/00000000-0000-4000-8000-00000000dead",
  "/solutions/projects",
  "/solutions/reports",
  "/solutions/resources",
  "/solutions/runs",
  "/solutions/settings",
  "/solutions/trail",
  "/solutions/workflows",
  // The lifecycle index and one stage: the detail page is dynamic, and the
  // contract matches a dynamic route by its static prefix.
  "/solutions/lifecycle",
  "/solutions/lifecycle/implementation",
  // One run's stage page. Signed out this measures the honest error state;
  // the populated layout is measured through the harness case "run-stage".
  "/solutions/lifecycle/run/00000000-0000-4000-8000-00000000dead/architecture",
  // One factory step: the ten pages share one console, and the harness case
  // "factory-step" measures the populated layout.
  "/solutions/factory/requirement",
  "/solutions/admin",
  "/auth/onboarding",
  "/offline",
  // A resource's own page: the eight library entries used to point at "#".
  "/resources/ultimate-guide-ai-powered-software-development",
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
    const limit = root.clientWidth + 1;
    const past: string[] = [];

    if (root.scrollWidth > limit) {
      for (const element of Array.from(document.querySelectorAll("body *"))) {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.right <= limit) continue;

        /*
         * Anything inside a horizontal scroller sits past the viewport by
         * design — that is what the scroller is for. Reporting it named the
         * wrong element: the pricing comparison table always sorted to the top
         * of this list while the real cause went unmentioned.
         */
        let contained = false;
        for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          const overflowX = getComputedStyle(parent).overflowX;
          if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden") {
            contained = true;
            break;
          }
        }
        if (contained) continue;

        past.push(`<${element.tagName.toLowerCase()} class="${String(element.className).slice(0, 70)}">`);
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
    /*
     * A clock, not a layout budget.
     *
     * This walks all thirty-four routes in one test, and the server under it
     * is `next dev`, which compiles a route the first time it is asked for.
     * The default 45s covers that only when the server is already warm — which
     * it was, locally, because `reuseExistingServer` kept one alive between
     * runs. Against a cold server the sweep times out mid-walk and reports
     * `net::ERR_ABORTED; maybe frame was detached?`, which reads like a
     * layout failure and is a stopwatch. The ceiling is generous on purpose:
     * a warm run still finishes in about twenty seconds and exits early, so
     * the only thing it costs is the ability to fail for the wrong reason.
     */
    test.setTimeout(20_000 + ROUTES.length * 6_000);
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

test("the job seeker page is hard-gated behind sign-in", async ({ page }) => {
  // Signed out, /job-seeker has no layout of its own — its whole behavior is
  // the redirect, which is why it sits in the coverage contract's
  // REDIRECT_ONLY set rather than the overflow loop (measuring a page that
  // navigates away mid-measure destroyed the evaluation context on runs
  // 96276312872/96276312910). The signed-in layout is measured at all eight
  // widths through the component harness ("job-seeker").
  await page.goto("/job-seeker");
  await expect(page).toHaveURL(/\/auth\/sign-in\?next=%2Fjob-seeker/);
});

test("search is gated server-side, not merely hidden from the navigation", async ({ page }) => {
  /*
   * Search is a new destination and the requirement on it was explicit: only
   * for signed-in people, and protected on the server rather than by leaving
   * the link out. Those are different claims — a hidden link is still a
   * reachable URL — so this asks for the URL directly while signed out.
   *
   * It inherits the gate from the job-seeker layout rather than carrying its
   * own; that is deliberate, and this is the test that proves the inheritance
   * actually reaches a page added later.
   */
  await page.goto("/job-seeker/search");
  await expect(page).toHaveURL(/\/auth\/sign-in\?next=%2Fjob-seeker/);
});

test("/BudgetTracker is gated server-side, and by its own call", async ({ page }) => {
  /*
   * The most sensitive page in the product: a household's accounts, income
   * and debts. It sits directly under the portal route group with no section
   * layout above it, so the gate is called by the page itself.
   *
   * Asking for the URL directly while signed out is the only way to tell a
   * real server gate from a link merely left out of the navigation, and a
   * hidden link is still a reachable URL.
   *
   * The capitalised path is asserted as written because Next.js routes are
   * case-sensitive: this is the spelling that answers, and the one the header
   * links to.
   */
  await page.goto("/BudgetTracker");
  await expect(page).toHaveURL(/\/auth\/sign-in\?next=%2FBudgetTracker/);
});

test("every Budget Tracker section inherits that gate", async ({ page }) => {
  /*
   * The gate moved into `(budget)/BudgetTracker/layout.tsx` when the section
   * grew its own left navigation and four more routes. This is the test that
   * proves the inheritance actually reaches a page added later — the same
   * reason the job-seeker section has one.
   */
  for (const section of ["accounts", "transactions", "bills", "import"]) {
    await page.goto(`/BudgetTracker/${section}`);
    await expect(page).toHaveURL(/\/auth\/sign-in\?next=%2FBudgetTracker/);
  }
});

test("every Services CRM section is gated server-side through its layout", async ({ page }) => {
  /*
   * The pest-services CRM (ADR-185): an organization's whole book of
   * business. The gate lives in `(services)/Services/layout.tsx`, so every
   * destination — including ones added by later increments — inherits it.
   * Asking for the URLs directly while signed out is the only way to tell a
   * real server gate from a link merely left out of the navigation.
   */
  for (const path of [
    "/Services",
    "/Services/customers",
    "/Services/pipeline",
    "/Services/schedule",
    "/Services/technicians",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/auth\/sign-in\?next=%2FServices/);
  }
});

test("/Job-Search is gated server-side, and by its own call", async ({ page }) => {
  /*
   * The named entry point to the board search. Unlike /job-seeker/search it
   * inherits no job-seeker layout -- it sits outside that segment -- so the
   * gate is called by the page itself. This asks for the URL directly while
   * signed out, which is the only way to tell a real server gate from a link
   * left out of the navigation.
   *
   * The `next` parameter carries this path rather than the section's, so
   * signing in returns to the page that was asked for.
   */
  await page.goto("/Job-Search");
  await expect(page).toHaveURL(/\/auth\/sign-in\?next=%2FJob-Search/);
});

test("/JobSearch is gated server-side with its canonical return path", async ({ page }) => {
  /*
   * The product header points here, so the canonical spelling needs its own
   * direct server-gate proof. The legacy hyphenated route above cannot catch a
   * canonical page that accidentally stops calling the gate.
   */
  await page.goto("/JobSearch");
  await expect(page).toHaveURL(/\/auth\/sign-in\?next=%2FJobSearch/);
});

test("a console page offers one menu button, not two", async ({ page }) => {
  /*
   * The console renders the global header and its own drawer, so a phone had
   * two hamburgers stacked in two bars — distinguishable only by their
   * accessible names, which nobody sees. The console's is the one that stays,
   * because it is the navigation the page is about; the site's destinations
   * move into it rather than losing their route.
   */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/solutions", { waitUntil: "domcontentloaded" });

  const menus = page.getByRole("button", { name: /open (site|console) navigation/i });
  await expect(menus).toHaveCount(1);
  await expect(page.getByRole("button", { name: /open console navigation/i })).toBeVisible();

  /*
   * The click is retried, not just the assertion: these pages are rendered on
   * the server and then hydrated, and a click that lands before the handler is
   * attached does nothing at all.
   */
  const opener = page.getByRole("button", { name: /open console navigation/i });
  await expect(async () => {
    if (await opener.isVisible()) await opener.click();
    // Every destination the suppressed menu carried is still one tap away.
    for (const label of ["Platform", "Pricing"]) {
      await expect(page.getByRole("link", { name: label, exact: true }).first())
        .toBeVisible({ timeout: 2_000 });
    }
  }).toPass({ timeout: 20_000 });
});

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

  /*
   * Waited for rather than counted once. The drawer is mounted by a click and
   * the docked sidebar by hydration, so under parallel workers a single count
   * could read zero before either had arrived — which failed as "there are no
   * groups" when the real answer was "not yet".
   */
  await expect(toggles.first()).toBeVisible({ timeout: 15_000 });

  // Re-queried each round and driven until none are left, rather than looping a
  // count captured up front: every click removes one "Expand" button from the
  // set, so a fixed count races the shrinking list. The first wait retries,
  // because domcontentloaded lands before hydration puts the buttons on screen
  // and a bare count() measures whatever instant it happens to run in.
  await expect(toggles.first()).toBeVisible();
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

/**
 * Regressions from the 2026-08-17 project-wide sweep.
 *
 * Each of these was a real defect found by measuring every route at every
 * supported width, and each is the kind that returns quietly: a table that
 * scrolls the page rather than itself, a grid one breakpoint too tight, a
 * control the size of its own text. They are asserted rather than described.
 */

test("the plan comparison stacks instead of scrolling the page sideways", async ({ page, isMobile }) => {
  /*
   * Drives the viewport, so it belongs in a project that can be resized. The
   * width sweep above skips mobile device profiles for the same reason:
   * forcing a width inside a profile that carries touch emulation and its own
   * device pixel ratio measures a configuration nobody has, and reports the
   * difference as a defect.
   */
  test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");

  // A 720px-minimum table inside a horizontal scroller still inflated the
  // root's scroll width, so the whole page scrolled sideways on a phone — and
  // the table was unusable at that width even when the scrolling worked.
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/pricing", { waitUntil: "domcontentloaded" });

  const result = await offenders(page);
  expect(result.documentWidth).toBeLessThanOrEqual(result.viewportWidth + 1);

  // The stacked form carries the same rows, so nothing is hidden on mobile.
  await expect(page.getByRole("table")).toBeHidden({ timeout: 10_000 });
  await expect(page.locator("dl").first()).toBeVisible({ timeout: 10_000 });
});

test("the comparison table returns on a wide screen", async ({ page, isMobile }) => {
  /*
   * Drives the viewport, so it belongs in a project that can be resized. The
   * width sweep above skips mobile device profiles for the same reason:
   * forcing a width inside a profile that carries touch emulation and its own
   * device pixel ratio measures a configuration nobody has, and reports the
   * difference as a defect.
   */
  test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/pricing", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("table")).toBeVisible();
});

test("no text spills out of its grid cell", async ({ page, isMobile }) => {
  /*
   * Drives the viewport, so it belongs in a project that can be resized. The
   * width sweep above skips mobile device profiles for the same reason:
   * forcing a width inside a profile that carries touch emulation and its own
   * device pixel ratio measures a configuration nobody has, and reports the
   * difference as a defect.
   */
  test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");

  // Six columns at 1280 and five at 640 were narrower than the words in them,
  // so the text painted over its neighbour with nothing to reveal it.
  for (const [route, width] of [["/platform", 1280], ["/pricing", 1024], ["/", 1280]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await settled(page);

    const spills = await page.evaluate(() =>
      Array.from(document.querySelectorAll("body *"))
        .filter((element) => {
          if (element.scrollWidth <= element.clientWidth + 1) return false;
          const overflowX = getComputedStyle(element).overflowX;
          return overflowX !== "auto" && overflowX !== "scroll" && overflowX !== "hidden";
        })
        .map((element) => `<${element.tagName.toLowerCase()} class="${String(element.className).slice(0, 60)}">`)
        .slice(0, 3));

    expect(spills, `${route} @ ${width}px clips content inside a cell`).toEqual([]);
  }
});

test("the newsletter field is a usable height on a phone", async ({ page, isMobile }) => {
  /*
   * Drives the viewport, so it belongs in a project that can be resized. The
   * width sweep above skips mobile device profiles for the same reason:
   * forcing a width inside a profile that carries touch emulation and its own
   * device pixel ratio measures a configuration nobody has, and reports the
   * difference as a defect.
   */
  test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");

  // `flex-1` is `flex: 1 1 0%` along the container's main axis. The container
  // is a column below `sm`, so on a phone it governed the *height* and
  // collapsed an `h-11` field to the 18px of its own text.
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/resources", { waitUntil: "domcontentloaded" });
  await settled(page);

  const field = page.getByRole("textbox", { name: /email address/i }).first();
  const box = await field.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
});

test("stacked navigation links are big enough to hit", async ({ page, isMobile }) => {
  /*
   * Drives the viewport, so it belongs in a project that can be resized. The
   * width sweep above skips mobile device profiles for the same reason:
   * forcing a width inside a profile that carries touch emulation and its own
   * device pixel ratio measures a configuration nobody has, and reports the
   * difference as a defect.
   */
  test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");

  // The footer's links were the height of their own text on every marketing
  // page. The inline-prose exemption does not cover a stacked list.
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await settled(page);

  const links = page.getByRole("navigation", { name: "Product" }).getByRole("link");
  // The footer is the last thing on the page, so counting it before it has
  // rendered reads zero and fails as "there are no links" — waiting for the
  // first one is the difference between absent and not-yet.
  await expect(links.first()).toBeVisible({ timeout: 15_000 });

  const total = await links.count();
  expect(total).toBeGreaterThan(0);

  for (let index = 0; index < total; index += 1) {
    /*
     * Polled rather than measured once. Two animation frames is enough when
     * the page is the only thing loading, and not enough under parallel
     * workers — a single reading caught the link before its styles applied and
     * reported the unstyled text height, which failed only in a full run.
     */
    await expect
      .poll(async () => (await links.nth(index).boundingBox())?.height ?? 0, {
        message: `footer link ${index} never reached a usable height`,
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(24);
  }
});

test("a resource card is tappable across its whole surface", async ({ page, isMobile }) => {
  /*
   * Drives the viewport, so it belongs in a project that can be resized. The
   * width sweep above skips mobile device profiles for the same reason:
   * forcing a width inside a profile that carries touch emulation and its own
   * device pixel ratio measures a configuration nobody has, and reports the
   * difference as a defect.
   */
  test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");

  // The link wrapped the title text alone: a 15px-tall target on a card
  // several hundred pixels tall. Stretched over the card, the target is the
  // card — checked by hit-testing a corner far from the text.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/resources", { waitUntil: "domcontentloaded" });
  await settled(page);

  const card = page.locator("li.relative").first();
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  expect(box).not.toBeNull();

  const hit = await page.evaluate(
    ([x, y]) => {
      const element = document.elementFromPoint(x, y);
      return element ? Boolean(element.closest("a")) || element.tagName === "A" : false;
    },
    [Math.round(box!.x + 14), Math.round(box!.y + box!.height - 14)],
  );

  expect(hit, "the card corner does not resolve to its link").toBe(true);
});
