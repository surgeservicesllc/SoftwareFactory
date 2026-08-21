import { expect, test } from "@playwright/test";

/**
 * The AI Factory page driven in a real browser against the real Next.js route,
 * rather than against the component harness.
 *
 * The harness renders these consoles with a fixture server standing in for
 * Supabase, which is what makes the width sweep possible and what makes it
 * blind to the page's own gates. This exercises those gates on the real route.
 *
 * The populated journey needs a signed-in tenant, which needs a running
 * Supabase — `tests/e2e/journey.spec.ts` and `auth-lifecycle.spec.ts` carry
 * that half and skip without a local stack. The gates are the half that can be
 * proved anywhere, and they are the half a wrong answer misleads hardest,
 * because an empty journey and a finished one are the same layout.
 */
test.describe("the AI Factory page without a readable tenant", () => {
  test("renders, and never claims a factory it could not read", async ({ page }) => {
    const response = await page.goto("/solutions/ai-factory");
    expect(response?.status()).toBe(200);

    // Whatever the reads answered, the page must not show a step list derived
    // from nothing. Before this was fixed, a 503 from Supabase rendered the
    // full eight-step journey with every step incomplete -- indistinguishable
    // from a genuinely empty workspace, in the same confident layout.
    const gate = page.getByRole("heading", {
      name: /Sign in to run your factory|could not be read|Finish setting up/i,
    });
    await expect(gate).toBeVisible({ timeout: 20_000 });

    for (const step of ["Connect Repository", "Assign Bots to Project", "Watch It Ship"]) {
      await expect(page.getByRole("heading", { name: step, exact: true })).toHaveCount(0);
    }
    await expect(page.getByText(/of 8 complete/)).toHaveCount(0);
  });

  test("offers a way forward instead of a dead end", async ({ page }) => {
    await page.goto("/solutions/ai-factory");
    const action = page.getByRole("link", { name: /Sign in|Try again|Open connections/i }).first();
    await expect(action).toBeVisible({ timeout: 20_000 });
    await expect(action).toHaveAttribute("href", /.+/);
  });
});
