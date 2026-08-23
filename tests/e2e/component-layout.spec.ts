import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { HARNESS_URL } from "../../playwright.config";
import { MAX_LENGTH_COORDINATOR_NAME } from "../harness/fixtures";

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

async function waitForFactoryBriefingReady(page: import("@playwright/test").Page) {
  await expect(page.getByRole("heading", { name: "Factory briefing" })).toBeVisible();
  for (const lane of ["Needs owner now", "Underway", "Recently finished", "Up next"]) {
    await expect(page.getByRole("region", { name: lane })).toBeVisible();
  }
  await expect(page.getByText(/Briefing incomplete/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
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
    if (layoutCase === "factory-briefing") {
      // Its loading card also makes #root non-empty. The four lanes and
      // enabled Refresh control are the stable ready-state contract that the
      // width, reachability, interaction, and axe assertions must measure.
      await waitForFactoryBriefingReady(page);
    }
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
  "pipeline-templates-selected",
  "job-seeker-overview",
  "job-seeker-documents",
  "job-seeker-contacts",
  "job-seeker-interviews",
  "agentos",
  "autonomy",
  "bot-usage",
  "job-seeker",
  "resume-review",
  "bot-fabric",
  "bot-manager",
  "bot-manager-in-journey",
  "bot-manager-stalled",
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
  "factory-briefing",
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

for (const width of [320, 1440]) {
  test(`factory-briefing passes axe at ${width}px`, async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");
    await open(page, "factory-briefing", width);

    // The component harness intentionally mounts below no page heading; the
    // real Dashboard supplies its h1. Keep the component's h2 hierarchy and
    // exclude only that harness-level page rule.
    const results = await new AxeBuilder({ page })
      .disableRules(["page-has-heading-one"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}

test("factory-briefing keeps a max-length coordinator inside 320px", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");
  await open(page, "factory-briefing", 320);

  await expect(
    page.getByLabel("Crew status").getByText(MAX_LENGTH_COORDINATOR_NAME, { exact: false }),
  ).toBeVisible();
  expect(await overflowing(page), "the maximum accepted coordinator name overflowed").toEqual([]);
});

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

test("AI Factory owns one modal above the whole shell, including pipeline Plan and Clone", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");
  await open(page, "ai-factory", 1280);

  const pipelineStep = page.getByRole("heading", {
    name: "Configure Pipeline",
    exact: true,
  }).locator("xpath=ancestor::li[1]");
  const opener = pipelineStep.getByRole("button", { name: /choose a pipeline|change pipelines/i });
  const skipLink = page.locator('a[href="#main-content"]');
  await expect(opener).toBeVisible();

  // A pre-existing boolean/string value on an unrelated body child catches a
  // cleanup that blindly removes attributes instead of restoring exact state.
  await page.evaluate(() => {
    const preserved = document.createElement("div");
    preserved.id = "pre-existing-modal-sibling";
    preserved.setAttribute("inert", "legacy");
    preserved.setAttribute("aria-hidden", "false");
    document.body.append(preserved);
  });

  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Configure Pipeline" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(1);

  const isolation = await page.evaluate(() => {
    const current = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
    return {
      directBodyChild: current?.parentElement === document.body,
      backgrounds: Array.from(document.body.children)
        .filter((element) => element !== current)
        .map((element) => ({
          id: element.id,
          inert: element.getAttribute("inert"),
          ariaHidden: element.getAttribute("aria-hidden"),
        })),
    };
  });
  expect(isolation.directBodyChild).toBe(true);
  expect(isolation.backgrounds.length).toBeGreaterThan(0);
  expect(isolation.backgrounds.every((entry) => (
    entry.inert === "" && entry.ariaHidden === "true"
  ))).toBe(true);

  // Even an adversarial programmatic focus attempt cannot escape to the
  // shell's z-100 skip link; the z-110 dialog remains the active boundary.
  await skipLink.evaluate((element) => (element as HTMLElement).focus());
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await dialog.getByRole("button", { name: /^Plan a graph from / }).first().click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(dialog.getByRole("region", { name: /^Plan a graph from / })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toHaveCount(1);
  await dialog.getByRole("button", { name: "Back to templates" }).click();

  await dialog.getByRole("button", { name: /^Clone / }).first().click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(dialog.getByRole("region", { name: "New template" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "Back to templates" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  expect(await page.locator("#root").getAttribute("inert")).toBeNull();
  expect(await page.locator("#root").getAttribute("aria-hidden")).toBeNull();
  await expect(page.locator("#pre-existing-modal-sibling")).toHaveAttribute("inert", "legacy");
  await expect(page.locator("#pre-existing-modal-sibling")).toHaveAttribute("aria-hidden", "false");
});

test("AI Factory advances a persisted record-only command to a truthful non-execution Step 9", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "semantic browser check runs once in a resizable project");
  await open(page, "ai-factory", 1280);

  const commandStep = page.getByRole("heading", {
    name: "Issue a Command",
    exact: true,
  }).locator("xpath=ancestor::li[1]");
  await expect(commandStep.getByText("Done")).toBeVisible();
  await expect(commandStep.getByText(/1 recorded only/i)).toBeVisible();

  const watchStep = page.getByRole("heading", {
    name: "Watch It Ship",
    exact: true,
  }).locator("xpath=ancestor::li[1]");
  await expect(watchStep.getByText(/no execution is queued/i)).toBeVisible();
  await expect(watchStep.getByText(/no worker dispatch, execution run, branch, or pull request/i))
    .toBeVisible();
  await expect(watchStep.getByText(/when an executor is connected/i)).toHaveCount(0);

  await watchStep.getByRole("button", { name: "Review command record" }).click();
  const dialog = page.getByRole("dialog", { name: "Watch It Ship" });
  await expect(dialog.getByText("Command record")).toBeVisible();
  await expect(dialog.getByText(/creates no worker dispatch, execution run, branch, or pull request by design/i))
    .toBeVisible();
  await expect(dialog.getByText(/will not start until an executor is connected/i)).toHaveCount(0);
});

test("standalone Bot Manager and Project Bots modals contain focus and share one close path", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");

  await open(page, "bot-manager", 1280);
  let opener = page.getByRole("button", { name: "Create Bot" });
  await opener.click();
  let dialog = page.getByRole("dialog", { name: "Create Bot" });
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await expect(page.locator("#root")).toHaveAttribute("inert", "");
  await page.locator('a[href="#main-content"]').evaluate((element) => (
    element as HTMLElement
  ).focus());
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  await opener.click();
  dialog = page.getByRole("dialog", { name: "Create Bot" });
  await expect(dialog).toBeVisible();
  await dialog.evaluate((element) => {
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  await open(page, "project-bots", 1280);
  opener = page.getByRole("button", { name: /assign more|assign bots/i }).first();
  await opener.click();
  dialog = page.getByRole("dialog", { name: /assign bots/i });
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await expect(page.locator("#root")).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

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

/*
 * The global header, signed in.
 *
 * The rest of the browser suite browses signed out, so the owner's specified
 * header — AI Factory, Job Seeker, Admin, then the account controls — had no
 * coverage in a real browser at all. This reads the rendered entries rather
 * than the module that supplies them, which is the point: the wiring is the
 * instruction, and a unit test importing the same constant cannot catch a
 * header that stops rendering what it is given.
 */
test("the signed-in header names the two products and the admin area", async ({ page }) => {
  await open(page, "site-header", 1440);

  const primary = page.getByRole("navigation", { name: "Primary" });
  await expect(primary).toBeVisible();

  await expect(primary.getByRole("link")).toHaveText(["AI Factory", "Job Seeker", "Admin"]);
  await expect(primary.getByRole("link", { name: "AI Factory" })).toHaveAttribute(
    "href",
    "/solutions",
  );
  await expect(primary.getByRole("link", { name: "Job Seeker" })).toHaveAttribute(
    "href",
    "/job-seeker",
  );

  // The account side of the same row, which the owner's image also shows.
  await expect(page.getByText("Super admin")).toBeVisible();
  await expect(page.getByText("owner@example.org")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Console" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" }).first()).toBeVisible();

  // A signed-in header must not still be selling the product.
  for (const gone of ["Platform", "Features", "Pricing", "About", "Get Started Free"]) {
    await expect(page.getByRole("link", { name: gone, exact: true })).toHaveCount(0);
  }

  expect(await overflowing(page), "the signed-in header pushed content out").toEqual([]);
});

/*
 * The desktop rail: narrower column, wider content, and the choice remembered.
 *
 * "Retract and expand on a Windows or macOS device" and "the content must take
 * back the space" are one requirement measured from two sides — a column that
 * narrows while the content keeps its old padding has reclaimed nothing. Both
 * numbers are read here rather than the class names that produce them, because
 * the class names are the implementation and the widths are the promise.
 *
 * This case was deleted once, when the control was, and is restored with it.
 * Playwright's desktop projects report `hover: hover` and `pointer: fine`,
 * which is the same question the shell asks to decide whether to offer the
 * control at all — so this runs on exactly the devices the owner named, and
 * the mobile project skips for the same reason a phone gets no control.
 */
test("retracting the sidebar gives its width back to the content", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "the rail is a pointer-device control; phones get the drawer");
  await open(page, "app-shell", 1280);

  const aside = page.locator("aside").first();
  const main = page.locator("#main-content");

  const wideColumn = (await aside.boundingBox())?.width ?? 0;
  const wideContent = await main.evaluate(
    (element) => element.clientWidth - parseFloat(getComputedStyle(element).paddingLeft),
  );
  expect(wideColumn).toBeGreaterThan(200);

  await page.getByRole("button", { name: /collapse navigation/i }).click();
  await settled(page);
  // The width transitions, so the measurement waits for it to land.
  await expect.poll(async () => Math.round((await aside.boundingBox())?.width ?? 0))
    .toBeLessThan(wideColumn - 100);

  const narrowContent = await main.evaluate(
    (element) => element.clientWidth - parseFloat(getComputedStyle(element).paddingLeft),
  );
  expect(
    narrowContent,
    "the column narrowed but the content kept its old left padding",
  ).toBeGreaterThan(wideContent + 100);

  // Every destination survives the narrowing, by accessible name.
  const rail = page.getByRole("navigation", { name: /console/i });
  for (const label of ["Overview", "Projects", "Pipelines", "Bots", "Settings"]) {
    await expect(rail.getByRole("link", { name: label, exact: true })).toBeVisible();
  }

  /*
   * The account block becomes one working glyph.
   *
   * Measured in the browser rather than only in jsdom because the failure this
   * guards against is a layout one: the panel is the widest thing in the
   * column, and a 4rem rail that still tried to render an email address would
   * push the content out. The overflow check below is what proves it does not,
   * and this proves the control survived the shrinking.
   */
  // Scoped to the column, not the nav: the account block is a sibling of the
  // navigation inside the aside, which is why a nav-scoped query finds nothing.
  const signOut = aside.getByRole("button", { name: "Sign out" });
  await expect(signOut).toBeVisible();
  await expect(signOut).toHaveText("S");
  await expect(aside.getByText("Signed in")).toBeHidden();

  expect(await overflowing(page), "the retracted rail pushed content out").toEqual([]);
  expect(await unreachable(page, "body")).toEqual([]);

  await page.getByRole("button", { name: /expand navigation/i }).click();
  await settled(page);
  await expect.poll(async () => Math.round((await aside.boundingBox())?.width ?? 0))
    .toBeGreaterThan(wideColumn - 10);
});

test("the tablet band gets a standing rail rather than the phone's drawer", async ({
  page,
  isMobile,
}) => {
  /*
   * Three tiers, measured at the two boundaries that define the middle one.
   *
   * The column used to exist only from 1280px up, so a landscape tablet got
   * the phone treatment: no standing navigation on a screen with room for it.
   * At 1024 the rail is present and there is no drawer opener; at 900 the
   * drawer opener is back and the column is gone.
   */
  test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");

  await open(page, "app-shell", 1024);
  const rail = page.locator("aside").first();
  await expect(rail).toBeVisible();
  expect(Math.round((await rail.boundingBox())?.width ?? 0)).toBeLessThan(120);
  await expect(page.getByRole("button", { name: /open console navigation/i })).toBeHidden();
  // A reduced footprint is not a hidden one: the destinations are still there.
  await expect(
    page.getByRole("navigation", { name: /console/i }).getByRole("link", { name: "Projects", exact: true }),
  ).toBeVisible();
  expect(await overflowing(page), "the tablet rail pushed content out").toEqual([]);

  await open(page, "app-shell", 900);
  await expect(page.locator("aside").first()).toBeHidden();
  await expect(page.getByRole("button", { name: /open console navigation/i })).toBeVisible();
  expect(await overflowing(page), "the drawer band overflowed").toEqual([]);
});

test("selecting accounts and bots holds its layout at every width", async ({
  page,
  isMobile,
}) => {
  /*
   * Selection changes the row — a border, a filled button, and a bar that
   * appears above the list — so the selected state is a layout nobody had
   * measured. Both lists are exercised, because both grew the control.
   */
  test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");

  for (const width of [320, 768, 1440]) {
    await open(page, "bot-manager", width);

    const accountSelects = page.getByRole("button", { name: /^Select .+/ });
    const total = await accountSelects.count();
    expect(total, "no Select control rendered").toBeGreaterThan(1);
    for (let index = 0; index < total; index += 1) await accountSelects.nth(index).click();

    // The bar states the selection, and every selected row stays inside.
    await expect(page.getByText(/\d+ selected/).first()).toBeVisible();
    expect(await overflowing(page), `selection overflowed at ${width}px`).toEqual([]);
    expect(await unreachable(page, "body"), `a control left reach at ${width}px`).toEqual([]);

    // Pressed state, not colour alone.
    await expect(accountSelects.first()).toHaveAttribute("aria-pressed", "true");
  }
});

test("a workspace whose accounts have all gone stale still has a way forward", async ({
  page,
  isMobile,
}) => {
  /*
   * The owner's screenshot, reproduced: four accounts, three of which refused
   * their stored credential, one disconnected, and no bots at all. The console
   * offered nothing — "None can create a bot", no Add Bots, and an empty team
   * with nothing to select — because it treated "connected" as the condition
   * for backing a bot. That is stricter than the server, which resolves
   * readiness from credential presence, and the accounts that 403'd still hold
   * theirs.
   */
  test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");
  await open(page, "bot-manager-stalled", 1280);

  await page.getByRole("button", { name: "Select Claude Blackstone" }).click();
  await page.getByRole("button", { name: "Select Claude NWV" }).click();

  // The offer exists, counts them, and says what the consequence is.
  await expect(page.getByRole("button", { name: /create 2 bots/i })).toBeEnabled();
  await expect(page.getByText(/need signing in again/i).first()).toBeVisible();
  const addBots = page.getByRole("button", { name: /^add bots$/i });
  await expect(addBots).toBeVisible();
  await expect(page.getByText(/E-Commerce Platform/).first()).toBeVisible();

  // The disconnected account has no credential left, so it still cannot.
  await page.getByRole("button", { name: "Select Codex Daniel" }).click();
  await expect(page.getByText(/1 cannot back a bot yet/i)).toBeVisible();

  expect(await overflowing(page), "the stalled state overflowed").toEqual([]);
  expect(await unreachable(page, "body")).toEqual([]);
});

test("Add Bots lands the selection on the journey's project", async ({ page, isMobile }) => {
  /*
   * The step finishing where it started. With a project in context the panel
   * names it, offers the role the assignment needs, and puts the selection on
   * it — no second screen asking for a project this page was already holding.
   * Measured at 320px because that row carries a select and a button and is
   * the densest thing the overlay gained.
   */
  test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");
  await open(page, "bot-manager-in-journey", 320);

  // Nothing selected: no offer to add nothing.
  await expect(page.getByRole("button", { name: /^add bots$/i })).toHaveCount(0);

  /*
   * A bot, not just any Select. The first account in the fixture needs signing
   * in again, and an account that cannot back a bot deliberately does not
   * count towards the offer — selecting it must leave the row absent.
   */
  const team = page.getByRole("region", { name: /your ai team/i });
  await team.getByRole("button", { name: /^Select .+/ }).first().click();

  const addBots = page.getByRole("button", { name: /^add bots$/i });
  await expect(addBots).toBeVisible();
  await expect(page.getByText(/E-Commerce Platform/).first()).toBeVisible();
  await expect(page.getByLabel("Role")).toBeVisible();

  expect(await overflowing(page), "the Add Bots row overflowed at 320px").toEqual([]);
  expect(await unreachable(page, "body"), "a control left reach at 320px").toEqual([]);
});

test("the bot roster's own dialogs fit a phone", async ({ page, isMobile }) => {
  /*
   * Both are new routes out of a dead end the owner hit: Create Bot used to
   * open the *add an account* chooser when nothing was connected, and a bot on
   * the roster had no way onto a project at all. Measured at 320px because
   * that is where the screenshot came from, and because a dialog is exactly
   * the thing `overflowing` cannot see — a fixed overlay never widens the
   * document, it scrolls sideways instead.
   */
  test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");
  await open(page, "bot-manager", 320);

  await page.getByRole("button", { name: /^create bot$/i }).click();
  const createDialog = page.getByRole("dialog", { name: /create bot/i });
  await expect(createDialog).toBeVisible();
  expect(await overflowing(page), "the Create Bot dialog overflowed").toEqual([]);
  expect(await unreachable(page, '[role="dialog"]')).toEqual([]);
  expect(await sidewaysScroll(page, '[role="dialog"]'))
    .toEqual({ found: true, overflowBy: 0 });
  await page.getByRole("button", { name: /^close$/i }).first().click();

  const addToProject = page.getByRole("button", { name: /add to project/i }).first();
  await expect(addToProject).toBeVisible();
  await addToProject.click();
  const assignDialog = page.getByRole("dialog", { name: /to a project/i });
  await expect(assignDialog).toBeVisible();
  // The controls that make the choice, not just the frame around them.
  await expect(assignDialog.getByLabel("Project")).toBeVisible();
  await expect(assignDialog.getByLabel("Role")).toBeVisible();
  expect(await overflowing(page), "the assign dialog overflowed").toEqual([]);
  expect(await unreachable(page, '[role="dialog"]')).toEqual([]);
  expect(await sidewaysScroll(page, '[role="dialog"]'))
    .toEqual({ found: true, overflowBy: 0 });
});

test("a collapsed submenu keeps its links out of the tab order", async ({ page, isMobile }) => {
  /*
   * The smooth reveal is a grid track animating from 0fr, which hides the
   * submenu by clipping it. Clipping is a visual state: without the
   * `invisible` alongside it the links stay focusable, so tabbing through a
   * collapsed navigation walks destinations nobody can see.
   */
  test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");
  await open(page, "app-shell", 1280);

  const nav = page.getByRole("navigation", { name: /console/i });

  /*
   * Named, not positional. `/expand .* subpages/` matched the first *closed*
   * group, and Playwright locators re-resolve on every use — so the moment the
   * click opened it, the same expression pointed at the next group along and
   * the assertion measured a submenu nobody had touched. Matching on the group
   * name holds through both states.
   */
  const opener = nav.getByRole("button", { name: /expand .* subpages/i }).first();
  await expect(opener).toBeVisible();
  const groupName = ((await opener.getAttribute("aria-label")) ?? "")
    .replace(/^Expand /, "")
    .replace(/ subpages$/, "");
  expect(groupName, "could not read a group name from the caret").not.toBe("");

  const caret = nav.getByRole("button", { name: new RegExp(`${groupName} subpages`, "i") });
  const group = caret.locator("xpath=ancestor::li[1]");
  const links = group.locator("ul a");
  expect(await links.count(), "the group has no subpages to hide").toBeGreaterThan(0);
  await expect(links.first()).toBeHidden();

  await caret.click();
  await expect(links.first()).toBeVisible();
  expect(await overflowing(page), "revealing a submenu pushed content out").toEqual([]);

  await caret.click();
  await expect(links.first()).toBeHidden();
});

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
        /*
         * The list shrinks under the sweep, and an index past its end must not
         * be waited on.
         *
         * `locator.textContent()` takes no timeout from this config — the
         * default action timeout is unbounded — so reading a control that a
         * previous click removed waits until the *test* times out. That was
         * latent until the sidebar gained a collapse toggle: it is the first
         * control whose click deletes the controls after it, and every
         * `survives its own controls at 1280px` case then hung for ninety
         * seconds and reported the page closing, which is the teardown rather
         * than the cause.
         */
        if (index >= (await controls.count())) break;
        const control = controls.nth(index);
        // Controls disappear as panels swap; a stale one is not a failure.
        const label = await control.textContent({ timeout: 1_000 }).catch(() => "");
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

test("a selected pipeline says so without colour, and stays reachable on a phone", async ({ page, isMobile }) => {
  /*
   * The defect this pins is the whole point of the control: pressing Use has
   * to leave a mark a person can find again. Grey alone would not be enough —
   * someone who cannot see the difference between the accent and the border
   * needs the same fact — so the pressed state is asserted on the element, not
   * on its class.
   */
  test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");
  await open(page, "pipeline-templates-selected", 320);

  const selected = page.getByRole("button", { name: "Stop using Production Readiness" });
  await expect(selected).toBeVisible();
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  await expect(selected).toHaveText(/Selected/);

  // A template nobody chose still offers itself.
  const unselected = page.getByRole("button", { name: "Use Security Audit" });
  await expect(unselected).toHaveAttribute("aria-pressed", "false");

  // Both selections are counted where a person looks for them, and planning a
  // graph is its own action rather than something Use does behind their back.
  await expect(page.getByText(/2 pipelines selected for E-Commerce Platform/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Plan a graph from Production Readiness" }),
  ).toBeVisible();

  expect(await overflowing(page), "the selected pipeline grid overflowed at 320px").toEqual([]);
  expect(
    await unreachable(page, "body"),
    "a selected pipeline's controls went out of reach at 320px",
  ).toEqual([]);
});
