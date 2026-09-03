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
 * **What this lane can and cannot reach.** Steps 1 to 7 are performed here in
 * the browser. Step 8 is refused by the server on purpose — before queueing it
 * re-resolves the repository and its base commit from the live GitHub API, and
 * the seeded repository does not exist there — so what is asserted is that the
 * refusal is stated rather than swallowed. Step 9 is Not Connected, because
 * nothing executes commands in this phase, and the page must say so.
 *
 * The credential gate remains structural: a bot cannot be assigned unless its
 * credential reference resolves on the server (this is what caught the
 * catalogue/allowlist mismatch). A fresh workspace also has no authored bot
 * role; the browser now adopts a reviewed starter through the real audited role
 * API in the Configure pane, then completes and reads back the assignment.
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

  /**
   * What a completed sign-in looks like now.
   *
   * It used to be a landing on /solutions. Every signed-in person now lands on
   * the /decision chooser first, which is a product decision, not a fault --
   * so waiting for /solutions specifically made every case here fail at the
   * door, and the scheduled lane with them. What each case actually needs is
   * that the session landed and the form is behind us; each one navigates to
   * the page it is about immediately afterwards.
   */
  async function waitForSignedIn(page: import("@playwright/test").Page, timeout = 60_000) {
    await page.waitForURL(/\/(solutions|decision)(\/|$)/, { timeout });
  }

  /** The card for one step, found by its title. */
  function stepCard(page: import("@playwright/test").Page, title: string) {
    return page.getByRole("heading", { name: title, exact: true }).locator("xpath=ancestor::li[1]");
  }

  test("walks all nine steps with fake data and reads them back from Supabase", async ({ page }) => {
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
    await waitForSignedIn(page, 45_000);

    // ── The journey, with the seeded installation already behind step 1 ───
    await page.goto("/solutions/ai-factory");
    await expect(page.getByRole("heading", { name: "Your factory, step by step" }))
      .toBeVisible({ timeout: 45_000 });

    // Step 1 is the seeded half: assert it reads as done rather than doing it.
    await expect(stepCard(page, "Connect Repository").getByText("Done")).toBeVisible();

    // ── Step 2: Create Project, every field ───────────────────────────────
    const createStep = stepCard(page, "Create Project");
    const existingJourneyProject = createStep.getByText("This factory: Storefront Rebuild", {
      exact: true,
    });
    if (await existingJourneyProject.isVisible().catch(() => false)) {
      // Playwright retries reuse the local database. A prior attempt may have
      // committed the project before a later assertion failed, so verify that
      // exact durable project instead of trying to consume the same seeded
      // repository twice and then misreporting the missing picker as a UI bug.
      await expect(createStep.getByText("Done")).toBeVisible();
    } else {
      await createStep.getByRole("button", { name: "Create a project" }).click();
      const projectDialog = page.getByRole("dialog");
      const repository = projectDialog.getByLabel("Repository");
      const allRepositoriesBound = projectDialog.getByRole("heading", {
        name: "Add another project",
      });
      await expect.poll(async () => (
        await repository.isVisible() || await allRepositoriesBound.isVisible()
      ), {
        message: "the project dialog must expose an unbound repository or its honest all-bound gate",
        timeout: 20_000,
      }).toBe(true);
      if (await allRepositoriesBound.isVisible()) {
        throw new Error(
          "AI Factory journey precondition failed: Storefront Rebuild is absent, but every authorized repository is already bound to another project.",
        );
      }
      await projectDialog.getByLabel("Name it").fill("Storefront Rebuild");
      await projectDialog.getByLabel(/what is it/i).fill("A fake project created by the journey walk.");
      await projectDialog.getByRole("button", { name: "Add project" }).click();
      // The form's own confirmation is not the thing to wait for: creating a
      // project calls back into the page, which closes the overlay and re-reads,
      // so that message can be gone before an assertion sees it. What must be
      // true is the step itself, derived from the row the POST created.
      await expect(projectDialog).toBeHidden({ timeout: 30_000 });
      await expect(createStep.getByText("Done")).toBeVisible({ timeout: 30_000 });
    }

    // ── Step 3: Configure Pipeline ────────────────────────────────────────
    const pipelineStep = stepCard(page, "Configure Pipeline");
    if (!(await pipelineStep.getByText("Done").isVisible().catch(() => false))) {
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
    }
    await expect(pipelineStep.getByRole("list", { name: "Selected pipelines" })).toBeVisible();

    // ── Step 4: Select Agents ─────────────────────────────────────────────
    const agentsStep = stepCard(page, "Select Agents");
    if (!(await agentsStep.getByText("Done").isVisible().catch(() => false))) {
      await agentsStep.getByRole("button", { name: /choose agents|change agents/i }).click();
      const agentsDialog = page.getByRole("dialog", { name: "Select Agents" });
      const includeAgent = agentsDialog.getByRole("button", { name: "Include in AI Factory" }).first();
      await expect(includeAgent).toBeVisible({ timeout: 20_000 });
      await includeAgent.click();
      await expect(agentsDialog.getByText("Included").first()).toBeVisible({ timeout: 20_000 });
      await page.keyboard.press("Escape");
      await expect(agentsStep.getByText("Done")).toBeVisible({ timeout: 30_000 });
    }
    await expect(agentsStep.getByRole("list", { name: "Included agents" })).toBeVisible();

    // ── Step 5: Connect Bots ──────────────────────────────────────────────
    // Signing into Claude or Codex is an external account action, like step 1,
    // so the runner seeds the account row that sign-in would have recorded.
    // Creating the bot on top of it is done here, in the browser.
    const botsStep = stepCard(page, "Connect Bots");
    if (!(await botsStep.getByText("Done").isVisible().catch(() => false))) {
      await expect(botsStep.getByText(/no bot linked to those accounts yet/i)).toBeVisible();
      await botsStep.getByRole("button", { name: "Create a bot" }).click();
      const connectDialog = page.getByRole("dialog", { name: "Connect Bots" });
      await connectDialog.getByRole("button", { name: "Create Bot" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(1);
      const accountChoice = connectDialog.getByRole("button", { name: /Fake Claude Account/ });
      await expect(accountChoice).toBeVisible({ timeout: 20_000 });
      await accountChoice.click();
      // The bot manager renamed this persisted roster from "Active Bots" to
      // "Your AI Team". Assert the real current surface and the exact success
      // result; neither selector is allowed to stand in for readiness below.
      await expect(connectDialog.getByRole("heading", { name: "Your AI Team" }))
        .toBeVisible({ timeout: 20_000 });
      await expect(connectDialog.getByRole("status"))
        .toContainText(/Bot created|now linked|already has a bot/);
      await page.keyboard.press("Escape");
      await expect(botsStep.getByText("Done")).toBeVisible({ timeout: 30_000 });
    }
    await expect(botsStep.getByText(/ready bot.*linked to.*connected account/i)).toBeVisible();

    // ── Step 6: Assign Bots, through the Select → Configure → Review wizard ─
    // The group is serial, so a failure anywhere in this file replays the
    // whole walk over rows an earlier attempt already committed. The step is
    // therefore driven from the state the page reports: the wizard when no
    // route exists yet, the roster read-back when one does. Both paths end in
    // the same roster, which the posting-level checks below then exercise.
    const assignStep = stepCard(page, "Assign Bots to Project");
    const assignmentInstructions =
      "Review every fake journey change carefully and record the evidence before handoff.";
    const assignmentModel = "claude-fable-5";
    const assignmentEffort = "high";
    const assignmentDone = await assignStep.getByText("Done").isVisible().catch(() => false);
    await assignStep
      .getByRole("button", { name: assignmentDone ? "Change assignments" : "Assign bots" })
      .click();
    const roster = page.getByRole("dialog").last();
    let roleOptions: string[] = [];
    if (!assignmentDone) {
    await roster.getByRole("button", { name: "Assign Bots" }).click();
    const wizard = page.getByRole("dialog").last();
    // AI Factory owns the one modal/focus boundary. The shared project roster
    // renders its wizard inside it instead of stacking another dialog.
    await expect(page.getByRole("dialog")).toHaveCount(1);
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

    // ── Step 7: Configure Bot Settings, every field on the pane ───────────
    await expect(wizard.getByRole("combobox", { name: /^Role for / })).toBeVisible({ timeout: 20_000 });
    await wizard.getByRole("button", { name: "Reviewer" }).click();
    // The preset shapes responsibilities and access; the role is a separate
    // required choice, and the database refuses an assignment without one.
    const role = wizard.getByRole("combobox", { name: /^Role for / });
    roleOptions = await role.locator("option").evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLOptionElement).value).filter(Boolean));

    if (roleOptions.length === 0) {
      // Fresh organizations deliberately own their role definitions. Adopt a
      // reviewed starter through the audited role API without abandoning this
      // assignment or navigating away.
      await expect(wizard.getByText("Add your first bot role")).toBeVisible();
      await wizard.getByRole("button", { name: "Add starter role" }).click();
      await expect(role.locator("option")).not.toHaveCount(0, { timeout: 20_000 });
      roleOptions = await role.locator("option").evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLOptionElement).value).filter(Boolean));
    }

    await role.selectOption(roleOptions[0]);
    await wizard.getByRole("combobox", { name: /^Repository access for / }).selectOption("write");
    await wizard.getByRole("combobox", { name: /^Branch strategy for / }).selectOption("per_task_branch");
    await wizard.getByRole("combobox", { name: /^Pipeline access for / }).selectOption("assigned");
    // Preview is the widest safe environment in this execution-inert lane.
    // Production is deliberately not selected, and assignment remains routing
    // intent: this journey never connects or dispatches a worker.
    await wizard.getByRole("combobox", { name: /^Environment access for / }).selectOption("preview");
    await wizard.getByRole("combobox", { name: /^Priority for / }).selectOption({ index: 1 });
    await wizard.getByRole("spinbutton", { name: /^Concurrent tasks for / }).fill("2");

    const canOpenPullRequest = wizard.getByRole("checkbox", { name: /^Can open pull requests/ });
    const canMergePullRequest = wizard.getByRole("checkbox", { name: /^Can merge pull requests/ });
    const requiresHumanApproval = wizard.getByRole("checkbox", {
      name: /^Work needs a person to approve it before it lands/,
    });

    // Exercise the human-approval control itself before merge locks it on.
    // The saved posting always requires a person, preserving containment.
    await expect(requiresHumanApproval).toBeChecked();
    await requiresHumanApproval.uncheck();
    await expect(requiresHumanApproval).not.toBeChecked();
    await requiresHumanApproval.check();
    await canOpenPullRequest.check();
    await canMergePullRequest.check();
    await expect(canOpenPullRequest).toBeChecked();
    await expect(canMergePullRequest).toBeChecked();
    await expect(requiresHumanApproval).toBeChecked();
    await expect(requiresHumanApproval).toBeDisabled();

    const instructions = wizard.getByRole("textbox", { name: /^Instructions for / });
    await instructions.fill(assignmentInstructions);
    await expect(instructions).toHaveValue(assignmentInstructions);

    await wizard.getByRole("button", { name: "Next" }).click();
    await expect(wizard.getByText(/Write to the repository.*Assigned pipelines only.*Preview only/))
      .toBeVisible();
    await expect(wizard.getByText(/Can open pull requests.*Can merge pull requests, with approval/))
      .toBeVisible();
    await expect(wizard.getByText("1 of 1")).toBeVisible();
    // Write access, pull-request rights and preview reach are elevated grants,
    // and the wizard refuses to confirm them until a person says they reviewed
    // what each bot may do. That acknowledgement is the product working, so
    // the walk ticks it the way an owner would rather than bypassing it; the
    // scheduled lane sat on a disabled Confirm for a week because it did not.
    const acknowledgement = wizard.getByRole("checkbox", { name: /elevated permissions/i });
    await expect(acknowledgement).toBeVisible();
    await acknowledgement.check();
    await expect(acknowledgement).toBeChecked();
    const confirm = wizard.getByRole("button", { name: "Confirm" });
    await expect(confirm).toBeEnabled({ timeout: 20_000 });
    await confirm.click();
    }

    // Confirmation returns to the real project roster inside the same outer
    // AI Factory modal. Model and effort are posting-level controls, so drive
    // them here and wait for each database write plus roster read-back before
    // touching the next revision-checked field. A value an earlier attempt
    // already saved is asserted rather than re-selected: a select does not
    // fire for an unchanged value, so there would be no write to wait for.
    await expect(page.getByRole("dialog")).toHaveCount(1);
    const assignmentWrite = () => page.waitForResponse((response) =>
      response.request().method() === "PATCH"
      && /\/api\/bot-assignments\/[^/]+$/.test(new URL(response.url()).pathname));
    const postingWrite = () => page.waitForResponse((response) =>
      response.request().method() === "PATCH"
      && /\/api\/projects\/[^/]+\/bots\/[^/]+$/.test(new URL(response.url()).pathname));
    const rosterReadback = () => page.waitForResponse((response) =>
      response.request().method() === "GET"
      && /\/api\/projects\/[^/]+\/bots$/.test(new URL(response.url()).pathname));

    // A replay after the covered-roster walk finds a second posting on this
    // roster, so every posting-level read is scoped to the card of the bot
    // this walk created: the one whose model catalogue carries the model it
    // is about to choose.
    const posting = roster.getByRole("listitem").filter({
      has: page.locator(`option[value="${assignmentModel}"]`),
    });
    await expect(posting).toHaveCount(1, { timeout: 30_000 });
    const model = posting.getByLabel("Model");
    await expect(model).toBeVisible({ timeout: 30_000 });
    await expect(model.locator(`option[value="${assignmentModel}"]`)).toHaveCount(1);
    if ((await model.inputValue()) !== assignmentModel) {
      const modelWrite = assignmentWrite();
      const modelReadback = rosterReadback();
      await model.selectOption(assignmentModel);
      expect((await modelWrite).ok()).toBeTruthy();
      expect((await modelReadback).ok()).toBeTruthy();
    }
    await expect(model).toHaveValue(assignmentModel);
    await expect(model).toBeEnabled();

    const effort = posting.getByLabel("Work effort");
    if ((await effort.inputValue()) !== assignmentEffort) {
      const effortWrite = assignmentWrite();
      const effortReadback = rosterReadback();
      await effort.selectOption(assignmentEffort);
      expect((await effortWrite).ok()).toBeTruthy();
      expect((await effortReadback).ok()).toBeTruthy();
    }
    await expect(effort).toHaveValue(assignmentEffort);
    await expect(effort).toBeEnabled();

    // Pause and resume the same posting. Never remove it: the journey must end
    // with exactly the active route it created, and no worker is connected.
    // An attempt that stopped between the two leaves the posting paused, so
    // it is resumed first and the pair is then driven from the active state.
    const pause = posting.getByRole("button", { name: /^Pause / });
    const resume = posting.getByRole("button", { name: /^Resume / });
    if (await resume.isVisible().catch(() => false)) {
      const recoverWrite = postingWrite();
      const recoverReadback = rosterReadback();
      await resume.click();
      expect((await recoverWrite).ok()).toBeTruthy();
      expect((await recoverReadback).ok()).toBeTruthy();
    }
    await expect(pause).toBeVisible();
    const pauseWrite = postingWrite();
    const pauseReadback = rosterReadback();
    await pause.click();
    expect((await pauseWrite).ok()).toBeTruthy();
    expect((await pauseReadback).ok()).toBeTruthy();
    await expect(resume).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);

    const resumeWrite = postingWrite();
    const resumeReadback = rosterReadback();
    await resume.click();
    expect((await resumeWrite).ok()).toBeTruthy();
    expect((await resumeReadback).ok()).toBeTruthy();
    await expect(pause).toBeVisible();
    // The count the roster prints is the count of postings it lists: one on
    // a first attempt, two once the covered-roster walk has posted Codex.
    const postings = roster.getByRole("listitem").filter({
      has: page.getByRole("button", { name: /^(Pause|Resume) / }),
    });
    await expect(roster.getByText(new RegExp(`^${await postings.count()} bots? assigned$`)))
      .toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await roster.getByRole("button", { name: "Return to AI Factory" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await expect(assignStep.getByText("Done")).toBeVisible({ timeout: 30_000 });
    await expect(assignStep.getByText(/ready bot route.*on this factory/i)).toBeVisible();
    await expect(stepCard(page, "Configure Bot Settings").getByText("Done"))
      .toBeVisible({ timeout: 30_000 });

    // ── Step 8: Issue a Command ───────────────────────────────────────────
    const commandStep = stepCard(page, "Issue a Command");
    await commandStep.getByRole("button", { name: "Give a bot work" }).click();
    const composer = page.getByRole("dialog").last();
    const prompt = composer.getByRole("textbox").first();
    await expect(prompt).toBeVisible({ timeout: 20_000 });
    await prompt.fill("Add a fake health endpoint and cover it with a test.");

    // This local lane deliberately binds a nonexistent GitHub repository, so
    // immutable base-SHA verification must refuse the submission. The normal
    // browser lane separately requires the persisted record-only success path
    // to advance Step 8 and render the non-execution Step 9 contract.
    const submit = composer.getByRole("button", { name: /queue|submit|send|start|run/i }).last();
    await expect(submit).toBeVisible({ timeout: 10_000 });
    await submit.click();
    await page.waitForTimeout(3000);

    await expect(composer.getByText(/failed safely|cannot|could not|not verified/i).first())
      .toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(commandStep.getByText("Done")).toHaveCount(0);

    // ── Step 9: Watch It Ship says what actually executes ─────────────────
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
    await expect(stepCard(page, "Select Agents").getByText("Done")).toBeVisible();
    await expect(stepCard(page, "Connect Bots").getByText("Done")).toBeVisible();
    await expect(stepCard(page, "Assign Bots to Project").getByText("Done")).toBeVisible();
    await expect(stepCard(page, "Configure Bot Settings").getByText("Done")).toBeVisible();
    await expect(page.getByText("Storefront Rebuild").first()).toBeVisible();

    // Reopen the real roster after a whole-page reload. These values now come
    // from Supabase, not React state or the wizard draft that wrote them.
    const persistedConfigureStep = stepCard(page, "Configure Bot Settings");
    await persistedConfigureStep.getByRole("button", { name: "Configure", exact: true }).click();
    const persistedRoster = page.getByRole("dialog");
    await expect(persistedRoster).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    const persistedPosting = persistedRoster.getByRole("listitem").filter({
      has: page.locator(`option[value="${assignmentModel}"]`),
    });
    await expect(persistedPosting).toHaveCount(1);
    await expect(persistedRoster.getByText(/^\d+ bots? assigned$/)).toBeVisible();
    await expect(persistedPosting.getByLabel("Model")).toHaveValue(assignmentModel);
    await expect(persistedPosting.getByLabel("Work effort")).toHaveValue(assignmentEffort);
    await expect(persistedPosting.getByRole("button", { name: /^Pause / })).toBeVisible();

    await persistedPosting.getByRole("button", { name: /^Configure / }).click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    const persistedRole = persistedRoster.getByRole("combobox", { name: /^Role for / });
    if (roleOptions[0]) {
      await expect(persistedRole).toHaveValue(roleOptions[0]);
    } else {
      // The route was created by an earlier attempt; its role is read back
      // from Supabase rather than from a choice this attempt did not make.
      await expect(persistedRole).not.toHaveValue("");
    }
    await expect(persistedRoster.getByRole("combobox", { name: /^Repository access for / }))
      .toHaveValue("write");
    await expect(persistedRoster.getByRole("combobox", { name: /^Branch strategy for / }))
      .toHaveValue("per_task_branch");
    await expect(persistedRoster.getByRole("combobox", { name: /^Pipeline access for / }))
      .toHaveValue("assigned");
    await expect(persistedRoster.getByRole("combobox", { name: /^Environment access for / }))
      .toHaveValue("preview");
    await expect(persistedRoster.getByRole("combobox", { name: /^Priority for / }))
      .toHaveValue("1");
    await expect(persistedRoster.getByRole("spinbutton", { name: /^Concurrent tasks for / }))
      .toHaveValue("2");
    await expect(persistedRoster.getByRole("checkbox", { name: /^Can open pull requests/ }))
      .toBeChecked();
    await expect(persistedRoster.getByRole("checkbox", { name: /^Can merge pull requests/ }))
      .toBeChecked();
    const persistedApproval = persistedRoster.getByRole("checkbox", {
      name: /^Work needs a person to approve it before it lands/,
    });
    await expect(persistedApproval).toBeChecked();
    await expect(persistedApproval).toBeDisabled();
    await expect(persistedRoster.getByRole("textbox", { name: /^Instructions for / }))
      .toHaveValue(assignmentInstructions);

    // Returning from inline configuration keeps one modal and the sole active
    // assignment. Close only the outer surface after proving that read-back.
    await persistedRoster.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(persistedPosting.getByRole("button", { name: /^Pause / })).toBeVisible();
    await persistedRoster.getByRole("button", { name: "Return to AI Factory" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("renders a live journey for a signed-in tenant, never a state it could not read", async ({ page }) => {
    /*
     * The half that holds against a deployed site as well as a local stack:
     * a real sign-in, then the page derived from nine live reads.
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
    await waitForSignedIn(page);

    await page.goto("/solutions/ai-factory");

    // The page's own heading, in whatever state it renders.
    await expect(page.getByRole("heading", { level: 1, name: "01. Factory Setup" }))
      .toBeVisible({ timeout: 45_000 });

    // Not the signed-out gate, and not the panel for a snapshot it could not
    // read: a signed-in tenant whose reads answer must get the journey.
    await expect(page.getByRole("heading", { name: "Your factory, step by step" }))
      .toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("Sign in to run your factory")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "AI Factory is unavailable" })).toHaveCount(0);

    // All nine steps present, and a completion count derived from the live
    // records rather than from a step the page assumed.
    for (const title of [
      "Connect Repository",
      "Create Project",
      "Configure Pipeline",
      "Select Agents",
      "Connect Bots",
      "Assign Bots to Project",
      "Configure Bot Settings",
      "Issue a Command",
      "Watch It Ship",
    ]) {
      await expect(stepCard(page, title)).toBeVisible();
    }
    await expect(page.getByText(/\d of 9 complete/)).toBeVisible();
  });

  test("states every step honestly for a workspace with nothing connected", async ({ page }) => {
    /*
     * The first-run state, asserted on whatever target this lane points at --
     * and the one that matters most on a deployed site, because it is what a
     * new owner actually meets and the one place the page has been caught
     * lying twice: once claiming a completed-nothing factory from reads that
     * failed, once promising draft pull requests while nothing could run.
     *
     * It asserts refusals rather than progress, so it is honest on an empty
     * workspace and skips itself the moment the workspace has any, instead of
     * failing on a factory that legitimately got built.
     */
    test.setTimeout(180_000);

    await page.goto("/auth/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await waitForSignedIn(page);

    await page.goto("/solutions/ai-factory");
    /*
     * Count-agnostic on purpose: the journey was eight steps and is now nine.
     * What this test is about is whether the page tells the truth about an
     * empty workspace, which does not depend on how many steps there are.
     */
    const progress = page.getByText(/\d+ of \d+ complete/);
    await expect(progress).toBeVisible({ timeout: 45_000 });

    const complete = (await progress.textContent())?.trim() ?? "";
    test.skip(
      !/^0 of /.test(complete),
      `this workspace has progress (${complete}); the empty-state claims below would not apply`,
    );

    // Step 1 is the gate everything else waits on, and it must offer the real
    // way through rather than a dead end.
    const connect = stepCard(page, "Connect Repository");
    await expect(connect.getByText("No GitHub installation yet")).toBeVisible();

    // Step 2's evidence must not imply a project exists.
    await expect(stepCard(page, "Create Project").getByText("No project yet for this factory"))
      .toBeVisible();

    // Step 7 must not claim a command was issued.
    await expect(stepCard(page, "Issue a Command").getByText("No command yet for this factory"))
      .toBeVisible();

    /*
     * Step 8 is the one that used to promise what it could not deliver: with
     * no executor it described runs landing as draft pull requests, in the
     * present tense, on a workspace where nothing ships. The conditional
     * wording is the fix, and this asserts the honest branch is the one a
     * disconnected workspace sees.
     */
    const ship = stepCard(page, "Watch It Ship");
    await expect(ship.getByText(/When an executor is connected/)).toBeVisible();
    await expect(ship.getByText("Every run lands as a draft pull request with CI evidence; you review and merge."))
      .toHaveCount(0);
    await expect(ship.getByText("Nothing has run yet")).toBeVisible();

    // Nothing anywhere on the page may claim a live connection.
    await expect(page.getByText("Demo Data")).toHaveCount(0);
  });

  test("the factory step page offers New Request, and it opens the launcher", async ({ page }) => {
    /*
     * The New Request button, exercised where it actually ships.
     *
     * It renders on a step that already has a lifecycle run -- before it
     * existed, that state had no way to start another request. The button's
     * job is to disclose the launcher, so that is what this drives: closed,
     * open, closed. It stops before pressing Launch: recording a graph is
     * real work in a real workspace, and no test should start one nobody
     * asked for.
     */
    test.setTimeout(180_000);

    await page.goto("/auth/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await waitForSignedIn(page);

    await page.goto("/solutions/factory/requirement");
    await expect(page.getByRole("heading", { level: 1, name: /1\. Requirement/i }))
      .toBeVisible({ timeout: 45_000 });

    // The crumb that used to send you to Pipelines.
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("link", { name: "Runs" }))
      .toHaveAttribute("href", "/solutions/runs");

    const button = page.getByRole("button", { name: /new request/i });
    const launch = page.getByRole("button", { name: /^launch/i });
    const noRunYet = page.getByRole("heading", { name: "No lifecycle has run yet" });

    // Two honest states, decided by the workspace rather than assumed. A
    // workspace with lifecycle runs renders the step's ready state and the
    // button discloses the launcher. A fresh workspace -- every local-stack
    // run of this lane -- has none, and the page offers the launcher
    // outright under a heading that says so. Either way the launcher must be
    // reachable, and nothing here presses Launch: recording a graph is real
    // work in a real workspace, and no test should start one nobody asked for.
    await expect(button.or(noRunYet).first()).toBeVisible({ timeout: 45_000 });

    if (await noRunYet.isVisible()) {
      await expect(button).toHaveCount(0);
      await expect(launch).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("heading", { name: "Launch this graph" })).toBeVisible();
      await expect(page.getByLabel("Goal")).toBeVisible();
      return;
    }

    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(launch).toHaveCount(0);

    await button.click();

    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(launch).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/runs the whole ten-step lifecycle once/i)).toBeVisible();

    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(launch).toHaveCount(0);
  });

  test("Grok Bot records a durable goal with fake data and states exactly why it stops", async ({ page }) => {
    /*
     * The Grok Bot section, walked over the project the nine-step walk built.
     *
     * A goal is typed the way an owner would type it. What the product must
     * then do is record the request durably and say, in the boundary's own
     * words, exactly where it stops -- and nothing here may read as a run.
     * On a local stack that stopping point is honest by construction: the
     * roster the walk assigned is one Claude bot on a starter role, and GitHub
     * is Not Connected, so planning or release resolution refuses. Whichever
     * refusal fires, the session it names is reopened beside the reason,
     * survives a reload, and offers no live control.
     *
     * Only the seeded local stack submits a goal. A deployed target with a
     * real installation could resolve a release base and record a paused
     * graph in that workspace, which no test should start unasked; there the
     * signed-in read of the workspace is what runs.
     */
    test.skip(!stepOneReady, "needs step 1 satisfied, like the walk it follows");
    test.setTimeout(240_000);

    await page.goto("/auth/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await waitForSignedIn(page);

    await page.goto("/solutions/factory/grok");
    await expect(page.getByRole("heading", { level: 1, name: "Grok Bot" })).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('[aria-label="Loading Grok Bot"]')).toHaveCount(0, { timeout: 45_000 });
    await expect(page.getByRole("heading", { name: "Grok Bot is unavailable" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Sign in to use Grok Bot" })).toHaveCount(0);

    const sessions = page.getByRole("complementary", { name: "Grok sessions" });
    const project = sessions.getByLabel("Project");
    await expect(project).toBeVisible();
    await project.selectOption({ label: "Storefront Rebuild" });

    if (!seeded) return;

    const goal = "Research the fake storefront repository and report what a health endpoint needs.";
    await page.getByRole("textbox", { name: "Tell Grok Bot what you want done" }).fill(goal);
    await page.getByRole("button", { name: "Start goal" }).click();

    // The refusal is stated in words, never swallowed, and never reads as a
    // run. The request is durable regardless: the reply names the session
    // and the workspace reopens it in the address bar. (The framework's
    // empty route announcer also carries the alert role; only text counts.)
    const alert = page.getByRole("alert").filter({ hasText: /\S/ });
    await expect(alert).toBeVisible({ timeout: 30_000 });
    // Three boundaries can answer here, each stated in the product's own
    // words: planning coverage (a starter role cannot cover the planning
    // tasks), GitHub Not Connected, or — once a replay has covered the roster
    // — the research intent's missing runtime bridge, which says in so many
    // words that no graph or worker was started.
    await expect(alert).toHaveText(/Planning is blocked|Not Connected|No graph or worker was started\./);
    await expect.poll(() => new URL(page.url()).searchParams.get("sessionId"), { timeout: 30_000 })
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    const sessionId = new URL(page.url()).searchParams.get("sessionId")!;

    const conversation = page.getByRole("log", { name: "Recorded session messages" });
    await expect(conversation.getByRole("article", { name: "You message" })).toContainText(goal, {
      timeout: 30_000,
    });
    // A serial replay records a second session with the same title; the
    // newest is the one selected, and one listed is what this proves.
    await expect(sessions.getByRole("button", { name: goal }).first()).toBeVisible();

    // No live control is offered over a session with no graph: every control
    // names the state it is unavailable in, and every one is disabled.
    const controls = page.getByRole("button", { name: /^(pause|resume|stop) unavailable in / });
    await expect.poll(() => controls.count()).toBeGreaterThanOrEqual(2);
    for (const control of await controls.all()) await expect(control).toBeDisabled();
    await expect(page.getByRole("button", { name: /^(pause|resume|stop) session$/ })).toHaveCount(0);

    // What Supabase stored, not what React remembered.
    await page.goto(`/solutions/factory/grok?sessionId=${encodeURIComponent(sessionId)}`);
    await expect(page.locator('[aria-label="Loading Grok Bot"]')).toHaveCount(0, { timeout: 45_000 });
    await expect(conversation.getByRole("article", { name: "You message" })).toContainText(goal, {
      timeout: 30_000,
    });
    await expect(page.getByRole("status")).toBeVisible();
    const inspector = page.getByRole("complementary", { name: "Session inspector" });
    await inspector.getByRole("tab", { name: "Goal" }).click();
    await expect(inspector.getByText(goal)).toBeVisible();
    await inspector.getByRole("tab", { name: "Agents" }).click();
    await expect(inspector.getByText(/No routing plan recorded|Planned routing intent/)).toBeVisible();
    await expect(inspector.getByText("Observed node execution route")).toHaveCount(0);
    await inspector.getByRole("tab", { name: "Deployment" }).click();
    // The two badges, exactly: the pane's detail sentence also says "not
    // connected" in prose, and a loose match would count that too.
    await expect(inspector.getByText("Not Connected", { exact: true })).toHaveCount(2);
    await expect(page.getByText("Demo Data")).toHaveCount(0);
  });

  test("Grok Bot plans on a covered roster with fake data, and stops honestly at the release base", async ({ page }) => {
    /*
     * The walk above proves the honest refusal of an uncovered roster. This
     * one builds the roster the planner needs and proves the next boundary:
     * a role that covers every planning and verification task, made through
     * the Bot Manager's own role editor; a Codex bot from the seeded account,
     * assigned through the same wizard; the Claude posting moved onto that
     * role. Then "Build me…" must record a Chief-of-Staff plan and stop at
     * the release base, because GitHub is Not Connected -- with the durable
     * session named beside that reason, the plan and its routing intent
     * readable, no live control offered, and all of it there after a reload.
     */
    test.skip(!seeded, "builds the covered roster only on the seeded local stack");
    test.setTimeout(360_000);

    await page.goto("/auth/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await waitForSignedIn(page);

    // ── A generalist role, authored where roles are authored ──────────────
    // The role editor is technical detail, so the Bot Manager keeps it inside
    // the Developer Diagnostics disclosure, closed by default, and the console
    // in there opens on its Fleet tab; open the disclosure, then pick Roles.
    await page.goto("/solutions/bot-manager");
    const diagnostics = page.locator("#developer-diagnostics");
    await expect(diagnostics).toBeVisible({ timeout: 45_000 });
    if (!(await diagnostics.evaluate((node) => (node as HTMLDetailsElement).open))) {
      await diagnostics.locator("summary").click();
    }
    const rolesTab = diagnostics.getByRole("tab", { name: /^Roles\b/ });
    await expect(rolesTab).toBeVisible({ timeout: 45_000 });
    await rolesTab.click();
    await expect(rolesTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Your roles" })).toBeVisible({ timeout: 45_000 });
    if (!(await page.getByRole("heading", { name: "Generalist" }).isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "New role" }).click();
      await page.locator("#role-name").fill("Generalist");
      await page.locator("#role-slug").fill("generalist");
      await page.locator("#role-summary").fill("Covers every planning and verification task the journey asks for.");
      await page.locator("#role-instructions")
        .fill("Read the repository and report exactly what you find. Never claim a result you did not observe.");
      await page.locator("#role-capabilities").fill("*");
      await page.getByRole("button", { name: "Save role" }).click();
      await expect(page.getByRole("heading", { name: "Generalist" })).toBeVisible({ timeout: 30_000 });
    }

    // ── The Codex bot, from the seeded account, through Connect Bots ──────
    await page.goto("/solutions/ai-factory");
    await expect(page.getByRole("heading", { name: "Your factory, step by step" }))
      .toBeVisible({ timeout: 45_000 });
    // The journey reads its steps from live records after the page paints, so
    // wait for the route the nine-step walk posted before reading Connect Bots.
    const assignStep = stepCard(page, "Assign Bots to Project");
    await expect(assignStep.getByText("Done")).toBeVisible({ timeout: 30_000 });
    const botsStep = stepCard(page, "Connect Bots");
    if (!(await botsStep.getByRole("list", { name: "Ready connected bots" }).getByText("Codex").isVisible().catch(() => false))) {
      await botsStep.getByRole("button", { name: "Manage bots" }).click();
      const connectDialog = page.getByRole("dialog", { name: "Connect Bots" });
      await connectDialog.getByRole("button", { name: "Create Bot" }).click();
      const codexAccount = connectDialog.getByRole("button", { name: /Fake Codex Account/ });
      await expect(codexAccount).toBeVisible({ timeout: 20_000 });
      await codexAccount.click();
      await expect(connectDialog.getByRole("status"))
        .toContainText(/Bot created|now linked|already has a bot/, { timeout: 30_000 });
      await page.keyboard.press("Escape");
      await expect(botsStep.getByText(/2 ready bots linked to 2 connected accounts/))
        .toBeVisible({ timeout: 30_000 });
    }

    // ── The Codex posting through the wizard; the Claude posting onto the role
    await assignStep.getByRole("button", { name: /Change assignments|Assign bots/ }).click();
    const roster = page.getByRole("dialog").last();
    // The roster fetches its postings after it opens; decide from the count it
    // prints, never from the loading state.
    const assignedCount = roster.getByText(/^\d+ bots? assigned$/);
    await expect(assignedCount).toBeVisible({ timeout: 30_000 });
    if (!/^2 /.test((await assignedCount.textContent()) ?? "")) {
      // The roster's button reads "Assign Bots" when empty and "Assign More"
      // once a posting exists; the Claude route from the nine-step walk exists.
      await roster.getByRole("button", { name: /^Assign (Bots|More)$/ }).click();
      const wizard = page.getByRole("dialog").last();
      // Only the unassigned Codex bot is selectable; the Claude route exists.
      await wizard.getByRole("button", { name: "Select All" }).click();
      await expect(wizard.getByText("1 bot selected")).toBeVisible();
      await wizard.getByRole("button", { name: "Next" }).click();
      const role = wizard.getByRole("combobox", { name: /^Role for / });
      await expect(role).toBeVisible({ timeout: 20_000 });
      // A writing role for the writing bot: the starter the first walk
      // adopted covers implementation, which is the one task Codex is given.
      const writingRole = await role.locator("option").evaluateAll((nodes) =>
        (nodes as HTMLOptionElement[])
          .filter((node) => node.value && !/generalist/i.test(node.textContent ?? ""))
          .map((node) => node.value));
      await role.selectOption(writingRole[0]);
      await wizard.getByRole("button", { name: "Next" }).click();
      const acknowledgement = wizard.getByRole("checkbox", { name: /elevated permissions/i });
      if (await acknowledgement.isVisible().catch(() => false)) await acknowledgement.check();
      await wizard.getByRole("button", { name: "Confirm" }).click();
      await expect(roster.getByText("2 bots assigned")).toBeVisible({ timeout: 30_000 });
    }
    const claudeRole = roster.getByRole("combobox", { name: "Role for Claude" });
    await roster.getByRole("button", { name: "Configure Claude" }).click();
    await expect(claudeRole).toBeVisible({ timeout: 20_000 });
    if (!/generalist/i.test(await claudeRole.locator("option:checked").textContent() ?? "")) {
      // The Configure editor saves the whole posting through the project's
      // bots route; only the roster's inline model and effort selects go
      // through /api/bot-assignments.
      const saved = page.waitForResponse((response) =>
        response.request().method() === "PATCH"
        && /\/api\/projects\/[^/]+\/bots\/[^/]+$/.test(new URL(response.url()).pathname));
      await claudeRole.selectOption({ label: "Generalist" });
      await roster.getByRole("button", { name: "Save changes" }).click();
      expect((await saved).ok()).toBeTruthy();
    } else {
      await roster.getByRole("button", { name: "Cancel", exact: true }).click();
    }
    await expect(roster.getByText("2 bots assigned")).toBeVisible({ timeout: 30_000 });

    // The Codex posting names its model explicitly, the way the Claude one
    // did in the nine-step walk: a posting left on every default is not yet a
    // configured route, and the planner only routes to configured postings.
    const codexModel = "gpt-5.3-codex";
    const codexPosting = roster.getByRole("listitem").filter({
      has: page.locator(`option[value="${codexModel}"]`),
    });
    await expect(codexPosting).toHaveCount(1);
    const codexModelSelect = codexPosting.getByLabel("Model");
    if ((await codexModelSelect.inputValue()) !== codexModel) {
      const modelWrite = page.waitForResponse((response) =>
        response.request().method() === "PATCH"
        && /\/api\/bot-assignments\/[^/]+$/.test(new URL(response.url()).pathname));
      const modelReadback = page.waitForResponse((response) =>
        response.request().method() === "GET"
        && /\/api\/projects\/[^/]+\/bots$/.test(new URL(response.url()).pathname));
      await codexModelSelect.selectOption(codexModel);
      expect((await modelWrite).ok()).toBeTruthy();
      expect((await modelReadback).ok()).toBeTruthy();
    }
    await expect(codexModelSelect).toHaveValue(codexModel);
    await roster.getByRole("button", { name: "Return to AI Factory" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // ── "Build me…" plans, then stops at the release base ─────────────────
    await page.goto("/solutions/factory/grok");
    await expect(page.locator('[aria-label="Loading Grok Bot"]')).toHaveCount(0, { timeout: 45_000 });
    const sessions = page.getByRole("complementary", { name: "Grok sessions" });
    await sessions.getByLabel("Project").selectOption({ label: "Storefront Rebuild" });
    const goal = "Build me a fake health endpoint and prove it with a test.";
    await page.getByRole("textbox", { name: "Tell Grok Bot what you want done" }).fill(goal);
    await page.getByRole("button", { name: "Start goal" }).click();

    const alert = page.getByRole("alert").filter({ hasText: /\S/ });
    await expect(alert).toBeVisible({ timeout: 45_000 });
    await expect(alert).toContainText("Not Connected");
    await expect.poll(() => new URL(page.url()).searchParams.get("sessionId"), { timeout: 30_000 })
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    const sessionId = new URL(page.url()).searchParams.get("sessionId")!;

    const conversation = page.getByRole("log", { name: "Recorded session messages" });
    await expect(conversation.getByRole("article", { name: "Chief of Staff message" }))
      .toContainText(/recorded a deterministic build plan/, { timeout: 30_000 });
    // The saved plan is not evidence of execution, and the notice says so in
    // one of two wordings depending on whether the release-base refusal left
    // the session blocked or merely unlinked.
    await expect(page.getByRole("status"))
      .toContainText(/no graph or worker execution has started|This durable session has no linked graph/);
    const inspector = page.getByRole("complementary", { name: "Session inspector" });
    await inspector.getByRole("tab", { name: "Plan" }).click();
    await expect.poll(() => inspector.getByRole("listitem").count()).toBeGreaterThanOrEqual(5);
    await inspector.getByRole("tab", { name: "Agents" }).click();
    await expect(inspector.getByText("Planned routing intent")).toBeVisible();
    await expect(inspector.getByText(/Codex/).first()).toBeVisible();
    await expect(inspector.getByText("Observed node execution route")).toHaveCount(0);
    const controls = page.getByRole("button", { name: /^(pause|resume|stop) unavailable in / });
    await expect.poll(() => controls.count()).toBeGreaterThanOrEqual(2);
    for (const control of await controls.all()) await expect(control).toBeDisabled();

    // After a reload, the same durable plan and the same honest boundary.
    await page.goto(`/solutions/factory/grok?sessionId=${encodeURIComponent(sessionId)}`);
    await expect(page.locator('[aria-label="Loading Grok Bot"]')).toHaveCount(0, { timeout: 45_000 });
    await expect(conversation.getByRole("article", { name: "Chief of Staff message" }))
      .toContainText(/recorded a deterministic build plan/, { timeout: 30_000 });
    await inspector.getByRole("tab", { name: "Plan" }).click();
    await expect.poll(() => inspector.getByRole("listitem").count()).toBeGreaterThanOrEqual(5);
    await inspector.getByRole("tab", { name: "Deployment" }).click();
    await expect(inspector.getByText("Not Connected", { exact: true })).toHaveCount(2);
    await expect(page.getByText("Demo Data")).toHaveCount(0);
  });

  test("the ten-step launcher refuses honestly where GitHub is Not Connected, and records nothing", async ({ page }) => {
    /*
     * The one control that starts a lifecycle, pressed on the seeded stack.
     *
     * Recording a Full Lifecycle graph requires an exact release base from
     * GitHub, and the local stack has no App configured, so the launch must
     * refuse with that reason and must not leave a graph behind. A deployed
     * target with a real installation is different: Launch there would record
     * real work in a real workspace, so this presses nothing on it.
     */
    test.skip(!seeded, "presses Launch only on the seeded local stack");
    test.setTimeout(180_000);

    await page.goto("/auth/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await waitForSignedIn(page);

    await page.goto("/solutions/factory/requirement");
    await expect(page.getByRole("heading", { name: "No lifecycle has run yet" }))
      .toBeVisible({ timeout: 45_000 });
    await page.getByLabel("Goal").fill("Build me a fake health endpoint and prove it with a test.");
    await page.getByLabel("Project").selectOption({ label: "Storefront Rebuild" });
    await page.getByRole("button", { name: /^Launch Full Lifecycle/ }).click();

    const alert = page.getByRole("alert").filter({ hasText: /\S/ });
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(alert).toContainText("Not Connected");
    await expect(page.getByText("Recorded", { exact: true })).toHaveCount(0);

    // Nothing was recorded: the step still offers the launcher outright.
    await page.reload();
    await expect(page.getByRole("heading", { name: "No lifecycle has run yet" }))
      .toBeVisible({ timeout: 45_000 });
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
