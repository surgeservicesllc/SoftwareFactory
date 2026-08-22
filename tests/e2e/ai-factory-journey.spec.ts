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
 * **What this lane can and cannot reach.** Steps 1 to 6 are performed here in
 * the browser. Step 7 is refused by the server on purpose — before queueing it
 * re-resolves the repository and its base commit from the live GitHub API, and
 * the seeded repository does not exist there — so what is asserted is that the
 * refusal is stated rather than swallowed. Step 8 is Not Connected, because
 * nothing executes commands in this phase, and the page must say so.
 *
 * Two product gates stop the journey short of a finished assignment, and both
 * are correct, so they are asserted rather than seeded past:
 *   - a bot cannot be assigned unless its credential reference resolves on the
 *     server (this is what caught the catalogue/allowlist mismatch);
 *   - an assignment needs a role, and a new workspace has none.
 *
 * Running it: see .github/workflows/ai-factory-journey.yml, which is the same
 * sequence a person would type. Locally, reset between runs — the journey
 * creates a project and a pipeline selection, and a second run finds them
 * already there.
 */
test.describe("AI Factory live journey", () => {
  test.skip(!process.env.AI_FACTORY_E2E, "needs the local Supabase stack (AI_FACTORY_E2E=1)");
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1440, height: 900 } });

  const email = process.env.AI_FACTORY_E2E_EMAIL ?? "factory.owner@example.com";
  const password = process.env.AI_FACTORY_E2E_PASSWORD ?? "fake-data-journey-2026!";
  /*
   * Whether step 1 is already satisfied for this account, by either honest
   * route.
   *
   * The local lane seeds the rows, because installing a GitHub App is an
   * account action against github.com that no runner can perform. A deployed
   * target cannot be seeded at all -- nothing here has write access to a
   * hosted database, and nothing should -- so there the same precondition has
   * to be met the real way: somebody installs the App on that workspace once,
   * and from then on step 1 is genuinely done rather than fabricated.
   *
   * Two variables rather than one, because they are two different claims.
   * SEEDED says a runner wrote the rows; INSTALLED says a person completed
   * the installation and the walk may proceed against a deployed site. Only
   * the second is ever true of production, and nothing in this repository can
   * set it on its own.
   */
  const seeded = process.env.AI_FACTORY_E2E_SEEDED === "1";
  const installed = process.env.AI_FACTORY_E2E_INSTALLED === "1";
  const stepOneReady = seeded || installed;

  /** The card for one step, found by its title. */
  function stepCard(page: import("@playwright/test").Page, title: string) {
    return page.getByRole("heading", { name: title, exact: true }).locator("xpath=ancestor::li[1]");
  }

  test("walks all eight steps with fake data and reads them back from Supabase", async ({ page }) => {
    test.skip(
      !stepOneReady,
      "needs step 1 satisfied: seeded rows locally (AI_FACTORY_E2E_SEEDED=1), or a real GitHub App installation on a deployed target (AI_FACTORY_E2E_INSTALLED=1)",
    );
    test.setTimeout(420_000);

    // ── Sign in (user admin-created and pre-confirmed by the runner) ──────
    // Straight to the form: the gate's own link is covered by
    // ai-factory-live.spec.ts, and the header carries a second "Sign In" that
    // makes a by-role click here ambiguous.
    await page.goto("/auth/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    // Wait for the session to land. Navigating straight on raced the POST and
    // arrived at the journey still signed out.
    await page.waitForURL(/\/solutions(\/|$)/, { timeout: 45_000 });

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
    // The form's own confirmation is not the thing to wait for: creating a
    // project calls back into the page, which closes the overlay and re-reads,
    // so that message can be gone before an assertion sees it. What must be
    // true is the step itself, derived from the row the POST created.
    await expect(projectDialog).toBeHidden({ timeout: 30_000 });
    await expect(createStep.getByText("Done")).toBeVisible({ timeout: 30_000 });

    // ── Step 3: Configure Pipeline ────────────────────────────────────────
    const pipelineStep = stepCard(page, "Configure Pipeline");
    await pipelineStep.getByRole("button", { name: /choose a pipeline|change pipelines/i }).click();
    const pipelineDialog = page.getByRole("dialog");
    // The accessible name names the template ("Use Agentic SDLC"); the visible
    // label is just "Use".
    const use = pipelineDialog.getByRole("button", { name: /^Use / }).first();
    await expect(use).toBeVisible({ timeout: 20_000 });
    await use.click();
    await page.keyboard.press("Escape");
    // The selection has to survive the overlay closing, or "Use" meant nothing.
    await expect(pipelineStep.getByText("Done")).toBeVisible({ timeout: 30_000 });
    await expect(pipelineStep.getByRole("list", { name: "Selected pipelines" })).toBeVisible();

    // ── Step 4: Connect Bots ──────────────────────────────────────────────
    // Signing into Claude or Codex is an external account action, like step 1,
    // so the runner seeds the account row that sign-in would have recorded.
    // Creating the bot on top of it is done here, in the browser.
    const botsStep = stepCard(page, "Connect Bots");
    await expect(botsStep.getByText("Done")).toBeVisible();
    await botsStep.getByRole("button", { name: "Connect a bot" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Create Bot" }).click();
    const accountChoice = page.getByRole("dialog").last().getByRole("button", { name: /Fake Claude Account/ });
    await expect(accountChoice).toBeVisible({ timeout: 20_000 });
    await accountChoice.click();
    await expect(page.getByRole("dialog").last().getByText(/Active Bots/)).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("Escape");

    // ── Step 5: Assign Bots, through the Select → Configure → Review wizard ─
    const assignStep = stepCard(page, "Assign Bots to Project");
    await assignStep.getByRole("button", { name: "Assign bots" }).click();
    const roster = page.getByRole("dialog").last();
    await roster.getByRole("button", { name: "Assign Bots" }).click();
    const wizard = page.getByRole("dialog").last();
    const selectAll = wizard.getByRole("button", { name: "Select All" });
    await expect(selectAll).toBeVisible({ timeout: 20_000 });

    // The bot is selectable, which is the half this journey can prove: its
    // credential reference resolves on the server. Before the catalogue and
    // the allowlist were reconciled it read "Needs credential" and this
    // checkbox was disabled, so a bot made from a connected subscription
    // account could never be assigned at all.
    // Enablement is the functional gate: a disabled checkbox cannot be
    // assigned at all. (The card's readiness badge is a separate, persisted
    // signal recorded when the bot was registered, so it is not asserted here.)
    await expect(wizard.getByRole("checkbox", { name: /^Select / }).first()).toBeEnabled();
    await selectAll.click();
    await wizard.getByRole("button", { name: "Next" }).click();

    // ── Step 6: Configure Bot Settings, every field on the pane ───────────
    await expect(wizard.getByRole("combobox", { name: /^Role for / })).toBeVisible({ timeout: 20_000 });
    await wizard.getByRole("button", { name: "Reviewer" }).click();
    // The preset shapes responsibilities and access; the role is a separate
    // required choice, and the database refuses an assignment without one.
    const role = wizard.getByRole("combobox", { name: /^Role for / });
    const roleOptions = await role.locator("option").evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLOptionElement).value).filter(Boolean));

    if (roleOptions.length === 0) {
      // A workspace has no roles until somebody creates one, and the database
      // requires one on every assignment. The wizard cannot finish here — what
      // it must not do is leave Confirm dead with nothing said, which is what
      // it did before this journey found it.
      await expect(wizard.getByText(/No roles yet/)).toBeVisible();
      await expect(wizard.getByRole("link", { name: "Bot Manager" })).toBeVisible();
      await wizard.getByRole("button", { name: "Next" }).click();
      // Whatever Confirm does here, it must not silently look like success.
      await wizard.getByRole("button", { name: "Confirm" }).click();
      await page.waitForTimeout(2500);
      await page.keyboard.press("Escape");
      // With no role there can be no assignment, so the step stays open.
      await expect(assignStep.getByText("Done")).toHaveCount(0);
    } else {
      await role.selectOption(roleOptions[0]);
      await wizard.getByRole("combobox", { name: /^Repository access for / }).selectOption("write");
      await wizard.getByRole("combobox", { name: /^Branch strategy for / }).selectOption("per_task_branch");
      await wizard.getByRole("combobox", { name: /^Pipeline access for / }).selectOption("assigned");
      await wizard.getByRole("combobox", { name: /^Priority for / }).selectOption({ index: 1 });
      await wizard.getByRole("spinbutton", { name: /^Concurrent tasks for / }).fill("2");

      await wizard.getByRole("button", { name: "Next" }).click();
      const confirm = wizard.getByRole("button", { name: "Confirm" });
      await expect(confirm).toBeEnabled({ timeout: 20_000 });
      await confirm.click();
      await page.keyboard.press("Escape");


      await expect(assignStep.getByText("Done")).toBeVisible({ timeout: 30_000 });
      await expect(stepCard(page, "Configure Bot Settings").getByText("Done"))
        .toBeVisible({ timeout: 30_000 });
    }

    // ── Step 7: Issue a Command ───────────────────────────────────────────
    const commandStep = stepCard(page, "Issue a Command");
    await commandStep.getByRole("button", { name: "Give a bot work" }).click();
    const composer = page.getByRole("dialog").last();
    const prompt = composer.getByRole("textbox").first();
    await expect(prompt).toBeVisible({ timeout: 20_000 });
    await prompt.fill("Add a fake health endpoint and cover it with a test.");

    // Submit, then insist on an answer either way: the command is recorded, or
    // the composer says why not. Silence here is the failure mode that matters,
    // because the step would simply stay open with nothing explaining it.
    const submit = composer.getByRole("button", { name: /queue|submit|send|start|run/i }).last();
    await expect(submit).toBeVisible({ timeout: 10_000 });
    await submit.click();
    await page.waitForTimeout(3000);

    const composerStillOpen = await composer.isVisible().catch(() => false);
    if (composerStillOpen) {
      /*
       * The expected outcome here, and it is the right one.
       *
       * Before queueing, the server re-resolves the repository and its base
       * commit from the live GitHub API. The seeded repository does not exist
       * on github.com — nothing in this lane does — so the binding cannot be
       * verified and the command is refused. What matters is that the refusal
       * is stated rather than swallowed: the composer says so, and no command
       * row is written.
       */
      await expect(composer.getByText(/failed safely|cannot|could not|not verified/i).first())
        .toBeVisible({ timeout: 10_000 });
      await page.keyboard.press("Escape");
      await expect(commandStep.getByText("Done")).toHaveCount(0);
    } else {
      await expect(commandStep.getByText("Done")).toBeVisible({ timeout: 30_000 });
    }

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

  test("renders a live journey for a signed-in tenant, never a state it could not read", async ({ page }) => {
    /*
     * The half that holds against a deployed site as well as a local stack:
     * a real sign-in, then the page derived from eight live reads.
     *
     * Every failure this catches is one a deployment can cause on its own --
     * a read answering 503 behind a CDN, a session cookie the edge drops, a
     * gate that renders for a signed-in tenant. The step list is asserted to
     * exist, not to be complete: what is complete depends on the workspace,
     * and a test that demanded more would only be testing its own fixture.
     */
    test.setTimeout(180_000);

    await page.goto("/auth/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.waitForURL(/\/solutions(\/|$)/, { timeout: 60_000 });

    await page.goto("/solutions/ai-factory");

    // The page's own heading, in whatever state it renders.
    await expect(page.getByRole("heading", { level: 1, name: "AI Factory" }))
      .toBeVisible({ timeout: 45_000 });

    // Not the signed-out gate, and not the panel for a snapshot it could not
    // read: a signed-in tenant whose reads answer must get the journey.
    await expect(page.getByRole("heading", { name: "Your factory, step by step" }))
      .toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("Sign in to run your factory")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "AI Factory is unavailable" })).toHaveCount(0);

    // All eight steps present, and a completion count derived from the live
    // records rather than from a step the page assumed.
    for (const title of [
      "Connect Repository",
      "Create Project",
      "Configure Pipeline",
      "Connect Bots",
      "Assign Bots to Project",
      "Configure Bot Settings",
      "Issue a Command",
      "Watch It Ship",
    ]) {
      await expect(stepCard(page, title)).toBeVisible();
    }
    await expect(page.getByText(/\d of 8 complete/)).toBeVisible();
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
