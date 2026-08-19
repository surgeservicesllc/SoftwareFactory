import { expect, test } from "@playwright/test";

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

async function settled(page: import("@playwright/test").Page) {
  await page.evaluate(
    () => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }),
  );
}

/**
 * Controls whose right edge is past their own scrolling container.
 *
 * Measured against the container rather than the viewport: a dialog may sit
 * inside a scroll area, and what matters is whether the button can be reached
 * by scrolling the thing it lives in, not where it lands in the window.
 */
async function unreachableControls(page: import("@playwright/test").Page, within: string) {
  await settled(page);
  return page.evaluate((selector) => {
    const root = document.querySelector(selector);
    if (!root) return ["container not found"];

    const bounds = root.getBoundingClientRect();
    const clipped: string[] = [];
    for (const control of Array.from(root.querySelectorAll("button, a, input, select"))) {
      const box = control.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      // A couple of pixels of rounding is not a defect; a whole button is.
      if (box.right > bounds.right + 2 || box.left < bounds.left - 2) {
        clipped.push(
          `${control.tagName.toLowerCase()} "${(control.textContent ?? "").trim().slice(0, 30)}"`,
        );
      }
    }
    return clipped.slice(0, 5);
  }, within);
}

test.describe("dialogs at 320px", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
  });

  test("the pipeline template dialog keeps every control reachable", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "viewport-driving check runs in the resizable projects");
    await page.goto("/solutions/pipelines", { waitUntil: "domcontentloaded" });
    await settled(page);

    const opener = page.getByRole("button", { name: /configure pipeline|new template|templates/i }).first();
    test.skip(!(await opener.isVisible().catch(() => false)), "the dialog needs a session");

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
  test.skip(!(await useButton.isVisible().catch(() => false)), "no template is offered here");

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
