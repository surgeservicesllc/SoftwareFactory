import { expect, test } from "@playwright/test";

/**
 * The AI Factory foundation journey, driven in a real browser against a local
 * Supabase stack: real GoTrue sign-in, real PostgREST, real Postgres carrying
 * the production migration chain, and the production Next build in front.
 *
 * Guarded by AI_FACTORY_E2E because it needs that stack. The ordinary suites
 * run the same page against the component harness, whose fixture server stands
 * in for Supabase — which is what makes the width sweep possible and what makes
 * it blind to whether any of this is wired.
 *
 * Step 1 is seeded. Connecting a repository means
 * installing a GitHub App, which is a real account action against github.com.
 * The runner seeds the rows that installation would have recorded — connection,
 * installation and repository — without contacting GitHub. The browser performs
 * steps 2-3 with fake data and reads them back from Supabase. Steps 4-8 are
 * deliberately not performed: they require an external AI account and an
 * executor, so this lane proves their honest blocked states instead. It does not
 * claim all-eight-step or provider execution coverage.
 *
 * Running it: see .github/workflows/ai-factory-journey.yml, which is the same
 * sequence a person would type.
 */
test.describe("AI Factory local Supabase foundation journey", () => {
  test.skip(!process.env.AI_FACTORY_E2E, "needs the local Supabase stack (AI_FACTORY_E2E=1)");
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1440, height: 900 } });

  const email = process.env.AI_FACTORY_E2E_EMAIL ?? "factory.owner@example.com";
  const password = process.env.AI_FACTORY_E2E_PASSWORD ?? "fake-data-journey-2026!";

  /** The card for one step, found by its title. */
  function stepCard(page: import("@playwright/test").Page, title: string) {
    return page.getByRole("heading", { name: title, exact: true }).locator("xpath=ancestor::li[1]");
  }

  test("seeds step 1, performs steps 2-3, and proves steps 4-8 remain blocked", async ({ page }) => {
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
    const repository = projectDialog.getByLabel("Repository");
    await expect(repository).toBeVisible({ timeout: 20_000 });
    await repository.selectOption({ label: "fake-owner/storefront" });
    await projectDialog.getByLabel("Name it").fill("Storefront Rebuild");
    await projectDialog.getByLabel(/what is it/i).fill("A fake project created by the local foundation journey.");
    await projectDialog.getByRole("button", { name: "Add project" }).click();
    // The shared control closes this overlay only after the API write and its
    // own read-back succeed.
    await expect(projectDialog).toBeHidden({ timeout: 30_000 });
    await expect(createStep.getByText("Done")).toBeVisible({ timeout: 30_000 });

    // ── Step 3: Configure Pipeline ────────────────────────────────────────
    const pipelineStep = stepCard(page, "Configure Pipeline");
    await pipelineStep.getByRole("button", { name: /choose a pipeline|change pipelines/i }).click();
    const pipelineDialog = page.getByRole("dialog");
    const use = pipelineDialog.getByRole("button", { name: /^use$/i }).first();
    await expect(use).toBeVisible({ timeout: 20_000 });
    await use.click();
    await expect(pipelineDialog.locator('button[aria-pressed="true"]').first()).toBeVisible({ timeout: 30_000 });
    await pipelineDialog.getByRole("button", { name: "Close" }).click();
    // The selection has to survive the overlay closing, or "Use" meant nothing.
    await expect(pipelineStep.getByText("Done")).toBeVisible({ timeout: 30_000 });
    await expect(pipelineStep.getByRole("list", { name: "Selected pipelines" })).toBeVisible();

    // ── Steps 4-8: blocked, never simulated or silently marked done ───────
    // Signing into a provider is an external account action, and no worker is
    // started in this lane. Each remaining card must name the missing live
    // prerequisite and remain incomplete.
    const blockedSteps = [
      ["Connect Bots", "No AI account connected yet"],
      ["Assign Bots to Project", "No bot is assigned to this factory yet"],
      ["Configure Bot Settings", "Assign a bot first"],
      ["Issue a Command", "No command yet for this factory"],
      ["Watch It Ship", "Nothing has run yet"],
    ] as const;

    for (const [title, evidence] of blockedSteps) {
      const card = stepCard(page, title);
      await expect(card.getByText("Done", { exact: true })).toHaveCount(0);
      await expect(card.getByText(evidence, { exact: true })).toBeVisible();
    }

    // Step 8 also exposes the worker truth rather than suggesting anything ran.
    const watchStep = stepCard(page, "Watch It Ship");
    await watchStep.getByRole("button", { name: "Watch execution" }).click();
    const watchDialog = page.getByRole("dialog");
    await expect(watchDialog.getByText("Worker Not Connected")).toBeVisible({ timeout: 20_000 });
    await expect(watchDialog.getByText(/will not start until an executor is connected/)).toBeVisible();
    await watchDialog.getByRole("button", { name: "Close" }).click();

    // ── Persistence: what Supabase stored, not what React remembered ──────
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your factory, step by step" }))
      .toBeVisible({ timeout: 45_000 });
    await expect(stepCard(page, "Create Project").getByText("Done")).toBeVisible();
    await expect(stepCard(page, "Configure Pipeline").getByText("Done")).toBeVisible();
    await expect(page.getByText("Storefront Rebuild").first()).toBeVisible();
    for (const [title, evidence] of blockedSteps) {
      const card = stepCard(page, title);
      await expect(card.getByText("Done", { exact: true })).toHaveCount(0);
      await expect(card.getByText(evidence, { exact: true })).toBeVisible();
    }
  });

  test("the foundation journey's reads are refused to a signed-out visitor", async ({ browser }) => {
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
