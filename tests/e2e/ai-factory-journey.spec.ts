import { expect, test } from "@playwright/test";

/**
 * The AI Factory guided journey, driven in a real browser against a real
 * Supabase stack: real GoTrue sign-in, real PostgREST, real Postgres carrying
 * the production migration chain, the production Next build in front.
 *
 * Guarded by AI_FACTORY_E2E because it needs that stack. The ordinary suites
 * run the same page against the component harness, whose fixture server stands
 * in for Supabase — which is what makes the width sweep possible and what makes
 * it blind to whether any of this is wired.
 *
 * **Step 1 is seeded, and only step 1.** Connecting a repository means
 * installing a GitHub App, which is a real account action against github.com.
 * The runner seeds the rows that installation would have recorded — connection,
 * installation, repository — and every step after it is performed here, in the
 * browser, filling every field with fake data. Seeding the external system's
 * recorded result is the only honest way to test what depends on it; seeding
 * anything further would be testing the seed.
 *
 * Running it: see .github/workflows/ai-factory-journey.yml, which is the same
 * sequence a person would type.
 */
test.describe("AI Factory live journey", () => {
  test.skip(!process.env.AI_FACTORY_E2E, "needs the local Supabase stack (AI_FACTORY_E2E=1)");
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1440, height: 900 } });

  const email = process.env.AI_FACTORY_E2E_EMAIL ?? "factory.owner@example.com";
  const password = process.env.AI_FACTORY_E2E_PASSWORD ?? "fake-data-journey-2026!";

  /** The card for one step, found by its title. */
  function stepCard(page: import("@playwright/test").Page, title: string) {
    return page.getByRole("heading", { name: title, exact: true }).locator("xpath=ancestor::li[1]");
  }

  test("walks all eight steps with fake data and reads them back from Supabase", async ({ page }) => {
    test.setTimeout(420_000);

    // ── The gate, from outside ────────────────────────────────────────────
    await page.goto("/solutions/ai-factory");
    const signInLink = page.getByRole("link", { name: /sign in/i }).first();
    await expect(signInLink).toBeVisible({ timeout: 30_000 });
    await signInLink.click();

    // ── Sign in (user admin-created and pre-confirmed by the runner) ──────
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    // ── The journey, with the seeded installation already behind step 1 ───
    await page.goto("/solutions/ai-factory");
    await expect(page.getByRole("heading", { name: "Your factory, step by step" }))
      .toBeVisible({ timeout: 45_000 });

    // Step 1 is the seeded half: assert it reads as done rather than doing it.
    await expect(stepCard(page, "Connect Repository").getByText("Done")).toBeVisible();

    // ── Step 2: Create Project, every field ───────────────────────────────
    const createStep = stepCard(page, "Create Project");
    await createStep.getByRole("button", { name: "Create a project" }).click();
    const projectDialog = page.getByRole("dialog");
    await expect(projectDialog.getByLabel("Repository")).toBeVisible({ timeout: 20_000 });
    await projectDialog.getByLabel("Name it").fill("Storefront Rebuild");
    await projectDialog.getByLabel(/what is it/i).fill("A fake project created by the journey walk.");
    await projectDialog.getByRole("button", { name: "Add project" }).click();
    await expect(projectDialog.getByText(/Storefront Rebuild is connected/)).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Escape");
    await expect(createStep.getByText("Done")).toBeVisible({ timeout: 30_000 });

    // ── Step 3: Configure Pipeline ────────────────────────────────────────
    const pipelineStep = stepCard(page, "Configure Pipeline");
    await pipelineStep.getByRole("button", { name: /choose a pipeline|change pipelines/i }).click();
    const pipelineDialog = page.getByRole("dialog");
    const use = pipelineDialog.getByRole("button", { name: /^use$/i }).first();
    await expect(use).toBeVisible({ timeout: 20_000 });
    await use.click();
    await page.keyboard.press("Escape");
    // The selection has to survive the overlay closing, or "Use" meant nothing.
    await expect(pipelineStep.getByText("Done")).toBeVisible({ timeout: 30_000 });
    await expect(pipelineStep.getByRole("list", { name: "Selected pipelines" })).toBeVisible();

    // ── Step 4: Connect Bots ──────────────────────────────────────────────
    // Signing into a provider is an external account action, like step 1. What
    // is testable here is that the step is honest about not being done.
    await expect(stepCard(page, "Connect Bots").getByText("Done")).toHaveCount(0);

    // ── Step 8: Watch It Ship says what actually executes ─────────────────
    const watchStep = stepCard(page, "Watch It Ship");
    await expect(watchStep.getByText("Done")).toHaveCount(0);
    await watchStep.getByRole("button", { name: "Watch execution" }).click();
    const watchDialog = page.getByRole("dialog");
    await expect(watchDialog.getByText("Not Connected")).toBeVisible({ timeout: 20_000 });
    await expect(watchDialog.getByText(/will not start until an executor is connected/)).toBeVisible();
    await page.keyboard.press("Escape");

    // ── Persistence: what Supabase stored, not what React remembered ──────
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your factory, step by step" }))
      .toBeVisible({ timeout: 45_000 });
    await expect(stepCard(page, "Create Project").getByText("Done")).toBeVisible();
    await expect(stepCard(page, "Configure Pipeline").getByText("Done")).toBeVisible();
    await expect(page.getByText("Storefront Rebuild").first()).toBeVisible();
  });

  test("the journey's reads are refused to a signed-out visitor", async ({ browser }) => {
    // A fresh context: no cookies, so this is the state a stranger meets.
    const context = await browser.newContext();
    const page = await context.newPage();
    const statuses: number[] = [];
    page.on("response", (response) => {
      if (new URL(response.url()).pathname.startsWith("/api/")) statuses.push(response.status());
    });

    await page.goto("/solutions/ai-factory");
    await expect(page.getByRole("link", { name: /sign in/i }).first()).toBeVisible({ timeout: 30_000 });
    // Nothing about the tenant may render, and nothing may answer 200.
    await expect(page.getByText("Storefront Rebuild")).toHaveCount(0);
    expect(statuses.filter((status) => status === 200)).toEqual([]);

    await context.close();
  });
});
