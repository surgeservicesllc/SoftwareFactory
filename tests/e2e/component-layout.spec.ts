import { expect, test } from "@playwright/test";

import { HARNESS_URL } from "../../playwright.config";

/**
 * The layouts that only exist once there are rows.
 *
 * The rest of the browser suite measures pages, and every console page renders
 * a "not configured" gate without Supabase — so the projects roster, the bot
 * cards, the assign wizard and the accounts panel had no width coverage at
 * all. Every responsive defect found so far has been inside that gap, and all
 * of them were found by hand on a phone rather than by CI.
 *
 * These mount the real components against fixture props in a real browser.
 * jsdom cannot do this: it can prove a button exists, never that it sits past
 * the right edge of the panel it lives in.
 *
 * What this does not cover is the server — authorization, tenant scoping and
 * the routes' own behaviour are tested where they live. This is a layout probe
 * and nothing more.
 */

const WIDTHS = [320, 375, 390, 430, 768, 1024, 1280, 1440];

async function settled(page: import("@playwright/test").Page) {
  await page.evaluate(
    () => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }),
  );
}

async function open(page: import("@playwright/test").Page, layoutCase: string, width: number) {
  /*
   * A throw during mount is a failure with a name, not an empty page.
   *
   * Two cases were rendering nothing at all — `ReportsConsole` on
   * `undefined.replace`, `AgentsConsole` on `undefined.map` — and the only
   * symptom was `#root` staying empty until the 15s timeout, reported as
   * "not.toBeEmpty() failed". That says nothing about what broke. Collecting
   * the page errors turns the same failure into the exception message.
   */
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${HARNESS_URL}/index.html?case=${layoutCase}`, {
    waitUntil: "domcontentloaded",
  });
  // The components fetch their fixtures on mount; wait for real content.
  try {
    await expect(page.locator("#root")).not.toBeEmpty({ timeout: 15_000 });
  } catch (failure) {
    if (errors.length) {
      throw new Error(
        `${layoutCase} rendered nothing at ${width}px; it threw: ${errors.join(" | ")}`,
      );
    }
    throw failure;
  }
  await settled(page);
  expect(errors, `${layoutCase} threw while mounting at ${width}px`).toEqual([]);
}

/** Elements past the viewport that no ancestor clips or scrolls. */
async function overflowing(page: import("@playwright/test").Page) {
  await settled(page);
  return page.evaluate(() => {
    const root = document.documentElement;
    const limit = root.clientWidth + 1;
    if (root.scrollWidth <= limit) return [];

    const past: string[] = [];
    for (const element of Array.from(document.querySelectorAll("body *"))) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.right <= limit) continue;

      let contained = false;
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const overflowX = getComputedStyle(parent).overflowX;
        if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden") {
          contained = true;
          break;
        }
      }
      if (!contained) {
        past.push(`<${element.tagName.toLowerCase()} class="${String(element.className).slice(0, 70)}">`);
      }
    }
    return past.slice(0, 3);
  });
}

/**
 * Controls whose edges fall outside their own scrolling container.
 *
 * Measured against the container rather than the viewport, because a control
 * inside a scroll area is reachable by scrolling that area — what matters is
 * whether anything can reach it at all. This is the exact shape of the defect
 * that hid the Disconnect button on a phone.
 */
async function unreachable(page: import("@playwright/test").Page, container: string) {
  await settled(page);
  return page.evaluate((selector) => {
    const root = selector === "body" ? document.body : document.querySelector(selector);
    if (!root) return [`container ${selector} not found`];

    const bounds = root.getBoundingClientRect();
    const clipped: string[] = [];

    for (const control of Array.from(root.querySelectorAll("button, a, input, select, textarea"))) {
      const box = control.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (getComputedStyle(control).visibility === "hidden") continue;
      if (box.right <= bounds.right + 2 && box.left >= bounds.left - 2) continue;

      /*
       * Past the edge is not the same as out of reach.
       *
       * A control inside a horizontal scroller is reached by scrolling it —
       * that is what the scroller is for, and a table's last column lives
       * there by design. What cannot be reached is a control an ancestor
       * *clips*: `overflow: hidden` paints it away with nothing to scroll,
       * which is exactly how a long account name hid its Rename button.
       */
      let reachable = false;
      for (let parent = control.parentElement; parent; parent = parent.parentElement) {
        const overflowX = getComputedStyle(parent).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") { reachable = true; break; }
        if (overflowX === "hidden") break;
        if (parent === root) break;
      }
      if (reachable) continue;

      clipped.push(
        `${control.tagName.toLowerCase()} "${(control.textContent ?? "").trim().slice(0, 32)}"`,
      );
    }
    return clipped.slice(0, 5);
  }, container);
}

/**
 * How far a container scrolls sideways.
 *
 * `overflowing` measures against the document and returns early when the
 * document itself fits — and an overlay is `position: fixed`, so it never
 * widens the document however wide its contents get. Nothing inside a dialog
 * was measured at all. What over-wide dialog content does instead is make the
 * overlay scroll sideways, which is the same defect wearing a different hat:
 * the requirement is no horizontal scrolling, and "only the modal scrolls" is
 * not an exemption.
 *
 * Measured on the overlay itself rather than on its descendants, which keeps
 * a deliberate inner scroller legitimate: a wide table with its own
 * `overflow-x` absorbs its overflow, so the overlay's scrollWidth never grows
 * and nothing is reported. Content that simply refuses to reflow does grow
 * it, and is.
 */
async function sidewaysScroll(page: import("@playwright/test").Page, container: string) {
  await settled(page);
  return page.evaluate((selector) => {
    const root = document.querySelector(selector);
    if (!root) return { found: false, overflowBy: 0 };
    return { found: true, overflowBy: Math.max(0, root.scrollWidth - root.clientWidth) };
  }, container);
}

const CASES = [
  // Everything the console renders once there are rows. Each is one fixture
  // and one case name; the measurement below is identical for all of them.
  "project-bots",
  "ai-accounts",
  "app-shell",
  "runs",
  "reports",
  "agents",
  "activity",
  "backlog",
  "connections",
  "projects",
  "my-projects",
  "portfolio",
  "pipelines",
  "agentos",
  "autonomy",
  "bot-usage",
  "bot-fabric",
  "bot-manager",
  "files",
  "operations",
  "resources",
  "safety",
  "provider-settings",
  "ai-factory",
  "workflows",
  "bot-workspace",
  "composer",
  "getting-started",
  "graph-summary",
  "graph-launch",
  "dashboard-metrics",
  "attention",
  "portfolio-controls",
  "project-detail",
  "recent-activity",
] as const;

for (const width of WIDTHS) {
  for (const layoutCase of CASES) {
    test(`${layoutCase} fits and stays reachable at ${width}px`, async ({ page, isMobile }) => {
      test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");
      await open(page, layoutCase, width);

      expect(await overflowing(page), `${layoutCase} @ ${width}px overflowed`).toEqual([]);
      expect(
        await unreachable(page, "body"),
        `${layoutCase} @ ${width}px put a control out of reach`,
      ).toEqual([]);
    });
  }
}

test("every recovery action on a stuck account is reachable on a phone", async ({ page, isMobile }) => {
  // The defect this pins: Refresh, Reconnect and Disconnect sat in a row that
  // refused to shrink, so the last of them ran off the panel's right edge and
  // a stuck account could not be recovered from a phone at all.
  test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");
  await open(page, "ai-accounts", 320);

  await expect(page.getByRole("button", { name: /refresh/i }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /reconnect/i }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /disconnect/i }).first()).toBeVisible();

  expect(await unreachable(page, "body")).toEqual([]);
});

// The wizard's own layout, not just its entry point. The roster is swept with
// the other cases above, but the dialog only exists once opened, and its
// Configure step is the densest form in the application — thirteen controls
// whose grid changes at the breakpoints. Measuring it at one width leaves the
// layouts either side of every one of those switches unmeasured.
for (const width of WIDTHS) {
  test(`the assign wizard fits each of its three steps at ${width}px`, async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");
    await open(page, "project-bots", width);

    await page.getByRole("button", { name: /assign more|assign bots/i }).first().click();
    const dialog = page.getByRole("dialog", { name: /assign bots/i });
    await expect(dialog).toBeVisible();

    expect(await overflowing(page), `the Select step overflowed at ${width}px`).toEqual([]);
    expect(
      await unreachable(page, '[role="dialog"]'),
      `a Select control is out of reach at ${width}px`,
    ).toEqual([]);
    expect(
      await sidewaysScroll(page, '[role="dialog"]'),
      `the Select step made the dialog scroll sideways at ${width}px`,
    ).toEqual({ found: true, overflowBy: 0 });

    await dialog.getByLabel("Select Test Engineer").click();

    for (const step of ["Configure", "Review"]) {
      await dialog.getByRole("button", { name: /next/i }).click();
      await settled(page);
      expect(await overflowing(page), `the ${step} step overflowed at ${width}px`).toEqual([]);
      expect(
        await unreachable(page, '[role="dialog"]'),
        `a ${step} control is out of reach at ${width}px`,
      ).toEqual([]);
      expect(
        await sidewaysScroll(page, '[role="dialog"]'),
        `the ${step} step made the dialog scroll sideways at ${width}px`,
      ).toEqual({ found: true, overflowBy: 0 });
    }
  });
}

/**
 * The harness measures populated layouts, or it measures nothing.
 *
 * Seven components consult `isBrowserSupabaseConfigured()`, and
 * `useTenantList` renders the signed-out state when it says no. Vite's build
 * shims `process.env` to `{}`, so it said no for every case — and this suite,
 * built precisely because an earlier populated sweep turned out to be
 * measuring gates, was measuring gates. The vacuity moved rather than went
 * away, and nothing failed when it did.
 *
 * A gate is a handful of centred words: it fits every width, reaches every
 * control, and passes everything below unconditionally. So its absence is the
 * precondition for the rest of this file meaning anything, and it is asserted
 * rather than assumed.
 */
for (const layoutCase of CASES) {
  test(`${layoutCase} renders content rather than a sign-in gate`, async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");
    await open(page, layoutCase, 1280);

    // A heading, not any sentence starting that way: the guided journey's own
    // step description reads "Sign in to Claude or Codex…" and is content, not
    // a gate. `BlockedState` renders its title as an <h2>.
    const gates = await page.getByRole("heading", { name: /^Sign in to / }).count();
    expect(
      gates,
      `${layoutCase} rendered a sign-in gate instead of its populated layout, so every `
        + "width assertion about it passed against a few centred words. Check that the "
        + "harness answers whatever this component gates on.",
    ).toBe(0);
  });

  test(`${layoutCase} has a fixture for every endpoint it reads`, async ({ page, isMobile }) => {
    /*
     * An error card is the same shape of lie as a gate.
     *
     * The fixture server used to answer anything it did not recognise with a
     * 200 and no keys, so ten consoles rendered their error state and the
     * sweep measured that instead of their layout. It now answers 503 and says
     * so, which is honest but still not measured — an error card fits every
     * width just as well. So the warning is the assertion: a console reaching
     * for an endpoint the harness cannot answer is an unmeasured console.
     */
    test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");

    const missing: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (text.startsWith("[harness] no fixture for ")) missing.push(text);
    });

    await open(page, layoutCase, 1280);
    // The consoles fetch on mount and some chain a second read off the first.
    await page.waitForTimeout(750);

    expect(
      [...new Set(missing)],
      `${layoutCase} read an endpoint the harness does not serve, so it rendered an error `
        + "card rather than its populated layout. Add the fixture in tests/harness/fixtures.ts, "
        + "shaped like the route's own response.",
    ).toEqual([]);
  });
}

test("opening every navigation caret reflows rather than overflowing", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");
  await open(page, "app-shell", 320);

  const opener = page.getByRole("button", { name: /open console navigation/i });
  if (await opener.isVisible().catch(() => false)) await opener.click();

  const nav = page.getByRole("navigation", { name: /console/i }).filter({ visible: true });
  const carets = nav.getByRole("button", { name: /expand .* subpages/i });
  await expect(carets.first()).toBeVisible({ timeout: 10_000 });

  for (let round = 0; round < 20; round += 1) {
    if ((await carets.count()) === 0) break;
    await carets.first().click();
    expect(await overflowing(page), `caret ${round + 1} pushed content out`).toEqual([]);
  }

  // Everything open, and the column still fits.
  expect(await carets.count()).toBe(0);
  expect(await unreachable(page, "body")).toEqual([]);
});

/**
 * Interactive state, across every surface.
 *
 * A layout that fits on arrival can still break the moment something opens:
 * a dialog, a disclosure, a tab, a menu. The defects found by hand on a phone
 * were all in that second state, and measuring only the first would have
 * missed every one of them.
 *
 * This drives each surface's own controls rather than a list of known ones —
 * a control added later is swept without anybody remembering to add it here.
 */
for (const layoutCase of CASES) {
  for (const width of [320, 1280]) {
    test(`${layoutCase} survives its own controls at ${width}px`, async ({ page, isMobile }) => {
      test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");
      /*
       * Longer than the default: this drives up to a dozen controls and
       * re-opens the case whenever one navigates. Overrunning the default
       * timeout tore the context down mid-measurement and reported "target
       * closed", which reads like a crash and is only a clock.
       */
      test.setTimeout(90_000);
      await open(page, layoutCase, width);

      // Bounded: enough to reach the interesting states without the sweep
      // becoming the slowest thing in the suite.
      const controls = page.locator(
        'button:visible, summary:visible, [role="tab"]:visible, [role="switch"]:visible',
      );
      /*
       * Eight, not every control. Each click re-renders a surface that may
       * mount fetching children, and the measurement walks the whole DOM
       * afterwards — twelve of those on the heaviest console took over two
       * minutes and hit the timeout, which reads as a crash. Eight reaches the
       * dialogs and disclosures that matter while the test stays a test.
       */
      const total = Math.min(await controls.count(), 8);

      let restores = 0;
      for (let index = 0; index < total; index += 1) {
        const control = controls.nth(index);
        // Controls disappear as panels swap; a stale one is not a failure.
        const label = await control.textContent().catch(() => "");
        // A control that will not accept a click in this state is not a
        // layout defect; the measurement after it still is.
        await control.click({ timeout: 700, trial: false }).catch(() => {});

        /*
         * Some controls submit a form or follow a link, which takes the page
         * off the harness. That is the control working, not a defect — but
         * measuring the page it landed on would be measuring nothing. Put the
         * case back and carry on with the next control.
         */
        if (page.isClosed()) {
          // A control that tears the page down is worth naming, not swallowing.
          throw new Error(
            `${layoutCase} @ ${width}px: "${(label ?? "").trim().slice(0, 40)}" closed the page`,
          );
        }
        if (!page.url().includes(`case=${layoutCase}`)) {
          // Restoring costs a full mount; once is a hiccup, repeatedly is the
          // sweep spending its budget on navigation instead of measurement.
          if (restores >= 2) break;
          restores += 1;
          await open(page, layoutCase, width);
          continue;
        }
        await settled(page);

        expect(
          await overflowing(page),
          `${layoutCase} @ ${width}px overflowed after "${(label ?? "").trim().slice(0, 30)}"`,
        ).toEqual([]);

        // Anything a click opened must also be reachable inside it.
        const dialog = page.locator('[role="dialog"]');
        if (await dialog.count() > 0) {
          expect(
            await unreachable(page, '[role="dialog"]'),
            `${layoutCase} @ ${width}px clipped a control in a dialog`,
          ).toEqual([]);
          // And the overlay must not answer over-wide content by scrolling
          // sideways. `overflowing` cannot see this: a fixed overlay never
          // widens the document, so every dialog in the application was
          // outside the width sweep entirely until this line.
          expect(
            await sidewaysScroll(page, '[role="dialog"]'),
            `${layoutCase} @ ${width}px made a dialog scroll sideways`,
          ).toEqual({ found: true, overflowBy: 0 });
          await page.keyboard.press("Escape").catch(() => {});
          await settled(page);
        }
      }
    });
  }
}
