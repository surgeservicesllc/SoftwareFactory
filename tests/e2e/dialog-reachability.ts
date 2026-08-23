/**
 * Whether every control inside a container can actually be reached.
 *
 * Shared because the check needs to run in two places for one reason: the
 * dialogs suite opens the real pages, which gate without Supabase, and the
 * layout harness renders the same components from fixtures, which does not.
 * CI's browser shards configure no Supabase, so the page-driven copy skips in
 * every run — the harness copy is the one that executes.
 *
 * Not a .spec file, so Playwright's testMatch does not collect it.
 */

export async function settled(page: import("@playwright/test").Page) {
  await page.evaluate(
    () => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }),
  );
}

/**
 * Controls whose edge is past their own scrolling container.
 *
 * Measured against the container rather than the viewport: a dialog may sit
 * inside a scroll area, and what matters is whether the button can be reached
 * by scrolling the thing it lives in, not where it lands in the window.
 */
export async function unreachableControls(
  page: import("@playwright/test").Page,
  within: string,
) {
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
