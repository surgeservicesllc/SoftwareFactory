import { expect, test } from "@playwright/test";

import { settled, unreachableControls } from "./dialog-reachability";

/**
 * Dialogs, on a phone.
 *
 * The route sweep measures pages, and a dialog is not on the page until
 * somebody opens it — so every defect inside one survived a clean sweep. The
 * two found this way were both invisible from outside: an account's action row
 * ran its last button off the right edge of the panel, and the template
 * dialog offered an empty dropdown beside a permanently disabled button.
 *
 * These open the real dialogs at the narrowest supported width and measure
 * what is actually reachable.
 */

const PHONE = { width: 320, height: 900 };

test.describe("dialogs at 320px", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
  });

  test("the pipeline template dialog keeps every control reachable", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");
    await page.goto("/solutions/pipelines", { waitUntil: "domcontentloaded" });
    await settled(page);

    const opener = page.getByRole("button", { name: /configure pipeline|new template|templates/i }).first();
    /*
     * Unconditional in CI, not occasional: the browser shards configure no
     * Supabase, so /solutions/pipelines gates and this opener is never
     * visible there. This copy therefore runs only against a configured
     * environment. The assertion itself executes on every commit in
     * component-layout.spec.ts, which opens the same dialog from the
     * harness — a skip here is a lane being unavailable, not a check
     * going unmade.
     */
    test.skip(
      !(await opener.isVisible().catch(() => false)),
      "needs a Supabase-backed session; the harness copy in component-layout.spec.ts is the one CI runs",
    );

    await opener.click();
    const dialog = page.getByRole("dialog").first();
    await expect(dialog).toBeVisible();

    expect(await unreachableControls(page, '[role="dialog"]')).toEqual([]);
  });

  test("a dialog never pushes the page sideways", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");

    for (const route of ["/solutions/pipelines", "/solutions/bot-manager", "/solutions/projects"]) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await settled(page);

      const openers = page.getByRole("button");
      const total = Math.min(await openers.count(), 8);
      for (let index = 0; index < total; index += 1) {
        await openers.nth(index).click({ timeout: 2_000 }).catch(() => {});
        await settled(page);

        const measurement = await page.evaluate(() => ({
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
        }));
        expect(
          measurement.documentWidth,
          `${route}: opening control ${index} scrolled the page sideways`,
        ).toBeLessThanOrEqual(measurement.viewportWidth + 1);

        await page.keyboard.press("Escape").catch(() => {});
      }
    }
  });
});

test("using a template without a project explains itself", async ({ page, isMobile }) => {
  // Signed out, or in a workspace with no projects, the dialog used to show an
  // empty dropdown beside a disabled button and say nothing — which reads as a
  // broken dialog rather than a missing prerequisite.
  test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/solutions/pipelines", { waitUntil: "domcontentloaded" });
  await settled(page);

  const useButton = page.getByRole("button", { name: /^use$/i }).first();
  // Same lane limitation as above: no Supabase in CI means no template is
  // offered, so this never runs there. The harness copy carries the check.
  test.skip(
    !(await useButton.isVisible().catch(() => false)),
    "needs a Supabase-backed session; the harness copy in component-layout.spec.ts is the one CI runs",
  );

  await useButton.click();
  const dialog = page.getByRole("dialog").first();
  await expect(dialog).toBeVisible();

  const projectSelect = dialog.getByRole("combobox");
  if ((await projectSelect.count()) === 0) {
    // No projects: the dialog must say why rather than showing a dead control.
    await expect(dialog).toContainText(/no projects|create a project|reading your projects/i);
    await expect(dialog.getByRole("button", { name: /plan graph/i })).toHaveCount(0);
  } else {
    await expect(projectSelect.locator("option")).not.toHaveCount(0);
  }
});
