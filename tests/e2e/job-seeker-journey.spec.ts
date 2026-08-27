import { expect, test, type Locator } from "@playwright/test";

/**
 * The whole Job Seeker experience, driven in a real browser against a real
 * Supabase stack: real GoTrue sign-in, real PostgREST, real Postgres with
 * the production migration chain, the production Next build in front.
 *
 * Guarded by JOB_SEEKER_E2E because it needs that stack (supabase start +
 * next start with the local keys) — the ordinary suites run without it.
 * Every field on every section is filled with fake data; every capability
 * is exercised; persistence is proven by reloading and reading back what
 * Supabase stored.
 *
 * Running it locally:
 *   1. `supabase start` (sandboxes that forbid rlimit syscalls need
 *      `-x realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor`
 *      — the journey only needs db, auth, rest, and kong).
 *   2. Create a confirmed user via GoTrue's admin API (POST
 *      /auth/v1/admin/users with the local service key and
 *      `email_confirm: true`), or export JOB_SEEKER_E2E_EMAIL/_PASSWORD
 *      for an existing one.
 *   3. Point `.env.local` at the local stack, `npm run build`, `next start`.
 *   4. Between runs, TRUNCATE the job_seeker_* tables — generated documents
 *      refuse row deletes by design, so DELETE aborts midway.
 *   5. `JOB_SEEKER_E2E=1 PLAYWRIGHT_BASE_URL=http://localhost:3000
 *      npx playwright test tests/e2e/job-seeker-journey.spec.ts
 *      --project=desktop-chromium`
 */

test.describe("job seeker live journey", () => {
  test.skip(!process.env.JOB_SEEKER_E2E, "needs the local Supabase stack (JOB_SEEKER_E2E=1)");
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1440, height: 900 } });

  const email = process.env.JOB_SEEKER_E2E_EMAIL ?? "jordan.seeker@example.com";
  const password = process.env.JOB_SEEKER_E2E_PASSWORD ?? "fake-data-journey-2026!";

  test("signs in, onboards, and completes every section with fake data", async ({ page }) => {
    test.setTimeout(300_000);

    // ── The gate, from outside ─────────────────────────────────────────────
    await page.goto("/job-seeker");
    await expect(page).toHaveURL(/\/auth\/sign-in\?next=%2Fjob-seeker/);

    // ── Sign in (user admin-created and pre-confirmed by the runner) ───────
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    // A first visit is redirected to workspace onboarding; a later run of the
    // same journey already has the workspace and lands straight on the
    // profile. Race the two destinations by element rather than by URL — the
    // redirect passes through /job-seeker on its way to onboarding, so URL
    // matching here is a coin flip.
    const workspaceName = page.getByLabel(/workspace name/i);
    const saveProfile = page.getByRole("button", { name: /save profile/i });
    await expect(workspaceName.or(saveProfile).first()).toBeVisible({ timeout: 30_000 });
    if (await workspaceName.isVisible()) {
      await workspaceName.fill("Jordan Job Search");
      await page.getByRole("button", { name: /create workspace/i }).click();
      // Onboarding honors ?next= and returns to the job-seeker console.
    }

    // ── Career Profile: every field ────────────────────────────────────────
    await expect(saveProfile).toBeVisible({ timeout: 30_000 });
    // The pathname itself, not the ?next= query of the onboarding URL.
    expect(new URL(page.url()).pathname).toBe("/job-seeker");
    await page.getByLabel("Full name").fill("Jordan Seeker");
    await page.getByLabel("Email").fill("jordan.seeker@example.com");
    await page.getByLabel("Phone").fill("+1 555 0100");
    await page.getByLabel(/LinkedIn URL/).fill("https://www.linkedin.com/in/jordan-seeker");
    await page.getByLabel("Location", { exact: true }).fill("Austin, TX");
    await page.getByLabel(/Salary target/).fill("210000");
    await page.getByLabel("Work arrangement").selectOption("remote");
    await page.getByLabel("Open to travel").check();
    await page.getByLabel("Open to relocation").check();
    await page.getByLabel("Professional summary").fill("Platform engineer who ships end to end.");

    await page.getByRole("button", { name: /add employment history entry/i }).click();
    const employment = page.locator("div.rounded-md.border").first();
    await employment.getByLabel("Organization").fill("Surge Services");
    await employment.getByLabel("Title").fill("Staff Engineer");
    await employment.getByLabel(/Started/).fill("2020");
    await employment.getByLabel(/Ended/).fill("");
    await employment.getByLabel("Summary").fill("Led platform work end to end.");
    await employment.getByLabel(/Highlights/).fill("Shipped a production graph execution engine\nMentored four engineers");

    await page.getByRole("button", { name: /add education entry/i }).click();
    const education = page.locator("div.rounded-md.border").nth(1);
    await education.getByLabel("Organization").fill("State University");
    await education.getByLabel("Title").fill("BSc Computer Science");
    await education.getByLabel(/Started/).fill("2012");
    await education.getByLabel(/Ended/).fill("2016");

    await page.getByLabel(/^Skills/).fill("TypeScript\nPostgreSQL");
    await page.getByLabel(/^Technologies/).fill("Next.js\nSupabase");
    await page.getByLabel(/^Accomplishments/).fill("Took a control plane from zero to production");
    await page.getByLabel(/^Certifications/).fill("AWS Solutions Architect");
    await page.getByLabel(/^Industries/).fill("Software");

    // Resume upload: a real file through the real endpoint. Uploading now also
    // reads it, so the assertions below cover the whole path — store, extract,
    // propose, apply — against the real database rather than a mocked one.
    await page.getByLabel(/Resume file/).setInputFiles({
      name: "jordan-resume.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        [
          "Avery Lin",
          "avery.lin@example.com | +1 (206) 555-0177 | Seattle, WA",
          "https://www.linkedin.com/in/averylin",
          "SUMMARY",
          "Staff engineer focused on developer platforms.",
          "EXPERIENCE",
          "Staff Engineer — Contoso Cloud (2019 - Present)",
          "Halved deploy times across sixty services.",
          "SKILLS",
          "Rust, Kubernetes",
        ].join("\n"),
      ),
    });
    await expect(page.getByText(/Uploaded jordan-resume\.txt/)).toBeVisible({ timeout: 20_000 });

    // ── The reading of that resume ─────────────────────────────────────────
    // The local stack has no provider credential, so this must report pattern
    // extraction and must NOT claim a model read the document.
    await expect(page.getByText(/Found \d+ fields? in your resume/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Pattern extraction only — Not Connected/)).toBeVisible();
    await expect(page.getByText("avery.lin@example.com")).toBeVisible();
    await expect(page.getByText(/Staff Engineer — Contoso Cloud/)).toBeVisible();

    // Untick one field to prove the selection is honoured rather than ignored:
    // the summary written by hand above must survive an apply that excludes it.
    await page.locator("#resume-field-summary").uncheck();
    await page.getByRole("button", { name: /Apply \d+ selected/ }).click();
    await expect(page.getByRole("status")).toContainText(/Filled in \d+ fields? from your resume/, {
      timeout: 30_000,
    });

    // Applied fields are in the editor; the unticked one kept what was typed.
    await expect(page.getByLabel("Email")).toHaveValue("avery.lin@example.com");
    await expect(page.getByLabel("Full name")).toHaveValue("Avery Lin");
    await expect(page.getByLabel(/^Skills/)).toHaveValue(/Rust/);
    await expect(page.getByLabel("Professional summary")).toHaveValue(
      "Platform engineer who ships end to end.",
    );

    // Re-applying the same reading is refused by the database, not by the UI.
    await expect(page.getByRole("button", { name: /Apply \d+ selected/ })).toHaveCount(0);

    // Put the hand-written identity back before the rest of the journey, which
    // asserts against Jordan Seeker throughout.
    await page.getByLabel("Full name").fill("Jordan Seeker");
    await page.getByLabel("Email").fill("jordan.seeker@example.com");
    await page.getByLabel(/^Skills/).fill("TypeScript\nPostgreSQL");

    await page.getByRole("button", { name: /save profile/i }).click();
    await expect(page.getByRole("status")).toHaveText("Profile saved.", { timeout: 20_000 });

    // Persistence is Supabase's answer, not the component's memory.
    await page.reload();
    await expect(page.getByLabel("Full name")).toHaveValue("Jordan Seeker", { timeout: 20_000 });
    await expect(page.getByLabel(/^Skills/)).toHaveValue("TypeScript\nPostgreSQL");
    await expect(page.getByLabel("Work arrangement")).toHaveValue("remote");
    await expect(page.getByLabel("Open to travel")).toBeChecked();

    // ── Preferences: every field ───────────────────────────────────────────
    await page.getByRole("link", { name: "Job Preferences" }).click();
    await expect(page.getByRole("button", { name: /save preferences/i })).toBeVisible({ timeout: 20_000 });
    await page.getByLabel(/Target titles/).fill("Staff Engineer\nPlatform Lead");
    await page.getByLabel(/^Locations/).fill("Remote — US\nAustin");
    await page.getByLabel("Seniority").fill("Staff");
    await page.getByLabel(/Compensation minimum/).fill("200000");
    await page.getByLabel("Remote", { exact: true }).check();
    await page.getByLabel("Hybrid", { exact: true }).check();
    await page.getByLabel(/^Industries/).fill("Software");
    await page.getByLabel(/Qualification threshold/).fill("80");
    await page.getByLabel(/Required criteria/).fill("Remote-first");
    await page.getByLabel(/Preferred criteria/).fill("Small team");
    await page.getByLabel(/^Exclusions/).fill("gambling");
    await page.getByRole("button", { name: /save preferences/i }).click();
    await expect(page.getByRole("status")).toHaveText("Preferences saved.", { timeout: 20_000 });
    await page.reload();
    await expect(page.getByLabel(/Target titles/)).toHaveValue("Staff Engineer\nPlatform Lead", { timeout: 20_000 });
    await expect(page.getByLabel(/Qualification threshold/)).toHaveValue("80");

    // ── Discovery: record, score, duplicate-protect ────────────────────────
    await page.getByRole("link", { name: "Job Discovery" }).click();
    await expect(page.getByText(/import sources|No source|Greenhouse/i).first()).toBeVisible({ timeout: 20_000 });
    // The registry is honest in both directions: public-API adapters carry
    // real import controls, and the credentialed one stays Not Connected
    // with its needs named.
    await expect(page.getByText("Public API").first()).toBeVisible();
    await expect(page.getByText("Not Connected")).toBeVisible();
    await expect(page.getByText(/Needs: SOFTWAREFACTORY_LINKEDIN_CLIENT_ID/)).toBeVisible();

    await page.getByRole("button", { name: /record a job/i }).click();
    await page.getByLabel("Job title").fill("Staff Engineer");
    await page.getByLabel("Company").fill("Meridian Software");
    await page.getByLabel("Job URL").fill("https://jobs.meridian.example/42");
    await page.getByLabel("Job ID").fill("mer-42");
    await page.getByLabel(/Salary/).fill("$220k – $250k");
    await page.getByLabel("Location", { exact: true }).fill("Remote — US");
    await page.getByLabel("Work model").selectOption("remote");
    await page.getByLabel("Full description").fill(
      "Remote platform role. TypeScript, PostgreSQL and Next.js daily; Kubernetes a plus.",
    );
    await page.getByRole("button", { name: /record and score/i }).click();
    await expect(page.getByRole("status")).toHaveText(/Recorded and scored \d+\/100 — qualified\./, { timeout: 20_000 });
    await expect(page.getByText("Qualified", { exact: true })).toBeVisible();

    await page.getByText(/Score breakdown/).click();
    await expect(page.getByText("experience", { exact: true })).toBeVisible();
    await expect(page.getByText(/names TypeScript|TypeScript.*from your profile/).first()).toBeVisible();

    // Duplicate: the same company+title+id is refused with the index's truth.
    await page.getByRole("button", { name: /record a job/i }).click();
    await page.getByLabel("Job title").fill("staff engineer");
    await page.getByLabel("Company").fill("MERIDIAN SOFTWARE");
    await page.getByLabel("Job ID").fill("mer-42");
    await page.getByRole("button", { name: /record and score/i }).click();
    // Next's route announcer is also role="alert"; filter to the message.
    await expect(
      page.getByRole("alert").filter({ hasText: /already recorded/ }),
    ).toBeVisible({ timeout: 20_000 });

    // ── Applications: prepare → review → approve → apply ───────────────────
    await page.getByRole("link", { name: "Applications" }).click();
    await expect(page.getByText(/Qualified · 1/i)).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /prepare application/i }).click();
    await expect(page.getByText(/Ready For Review · 1/i)).toBeVisible({ timeout: 30_000 });

    await page.getByText(/generated documents/i).click();
    await expect(page.getByText(/resume · v1/i)).toBeVisible({ timeout: 20_000 });
    // The anti-fabrication contract, visible in the live document: the
    // posting demands Kubernetes; the profile does not record it.
    const documents = page.locator("details", { hasText: "Generated documents" });
    await expect(documents.getByText(/TypeScript/).first()).toBeVisible();
    await expect(documents.locator("pre", { hasText: "Kubernetes" })).toHaveCount(0);

    // No post-approval move exists before the decision.
    await expect(page.getByRole("button", { name: /move to applied/i })).toHaveCount(0);
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("button", { name: /move to applied/i })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /move to applied/i }).click();
    await expect(page.getByText(/Applied · 1/i)).toBeVisible({ timeout: 20_000 });

    // ── Follow-Up: contact + outreach draft ────────────────────────────────
    await page.getByRole("link", { name: "Follow-Up" }).click();
    await expect(page.getByRole("button", { name: /save contact/i })).toBeVisible({ timeout: 20_000 });
    await page.getByLabel("Contact name").fill("Riley Recruiter");
    await page.getByLabel("Role").fill("Technical Recruiter");
    await page.getByLabel(/Where you found them/).fill("company careers page");
    await page.getByLabel(/LinkedIn URL/).fill("https://www.linkedin.com/in/riley-recruiter");
    await page.getByLabel("Application").selectOption({ index: 1 });
    await page.getByRole("button", { name: /save contact/i }).click();
    await expect(page.getByText("Riley Recruiter").first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /draft outreach/i }).click();
    await expect(page.getByText(/Staff Engineer application — Jordan Seeker/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/no send integration and will never claim a message was sent/)).toBeVisible();

    // ── Analytics: the counts are the rows ─────────────────────────────────
    await page.getByRole("link", { name: "Analytics" }).click();
    // The section nav also carries these words as links; scope to the cards.
    const stat = (label: string) =>
      page.locator("section.card").filter({ has: page.getByText(label, { exact: true }) });
    await expect(stat("Jobs found")).toContainText("1", { timeout: 20_000 });
    await expect(stat("Qualified")).toContainText("1");
    await expect(stat("Applications")).toContainText("1");
    // One application, zero responses: 0% is measured, not estimated. The
    // "—" no-data case (zero applications) is pinned by the unit suite.
    await expect(stat("Response rate")).toContainText("0%");
    await expect(page.getByText(/never an\s+estimate/)).toBeVisible();

    // ── CRM details persist: notes, submitted URL, follow-up date ──────────
    await page.getByRole("link", { name: "Applications" }).click();
    await expect(page.getByRole("heading", { name: "Applied · 1" })).toBeVisible({ timeout: 20_000 });
    await page.getByText("Notes & follow-up").click();
    await page.getByLabel("Notes").fill("Recruiter screen booked; send thank-you after.");
    await page.getByLabel("Application URL").fill("https://jobs.meridian.example/apply/42");
    await page.getByLabel("Follow-up date").fill("2026-09-01T09:00");
    await page.getByRole("button", { name: "Save details" }).click();
    // The saved answer must come back from Supabase, not component memory.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Applied · 1" })).toBeVisible({ timeout: 20_000 });
    await page.getByText("Notes & follow-up").click();
    await expect(page.getByLabel("Notes")).toHaveValue(/Recruiter screen booked/, { timeout: 20_000 });
    await expect(page.getByLabel("Application URL")).toHaveValue("https://jobs.meridian.example/apply/42");

    // ── The rest of the pipeline: every remaining stage, walked ────────────
    for (const stage of ["Follow Up", "Recruiter Response", "Interview", "Final Interview", "Offer"]) {
      await page.getByRole("button", { name: `Move to ${stage}` }).click();
      await expect(page.getByRole("heading", { name: `${stage} · 1` })).toBeVisible({ timeout: 20_000 });
    }

    // ── A second job walks the other side of the gate: reject, then close ──
    await page.getByRole("link", { name: "Job Discovery" }).click();
    await page.getByRole("button", { name: /record a job/i }).click();
    await page.getByLabel("Job title").fill("Platform Lead");
    await page.getByLabel("Company").fill("Northwind Data");
    await page.getByLabel("Job ID").fill("nw-7");
    await page.getByLabel("Full description").fill(
      "Remote platform leadership. TypeScript and PostgreSQL every day.",
    );
    await page.getByRole("button", { name: /record and score/i }).click();
    await expect(page.getByRole("status")).toHaveText(/Recorded and scored \d+\/100/, { timeout: 20_000 });

    await page.getByRole("link", { name: "Applications" }).click();
    // Meridian sits at Offer, so the only Prepare button is Northwind's.
    await page.getByRole("button", { name: /prepare application/i }).click();
    await expect(page.getByRole("heading", { name: "Ready For Review · 1" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByText("rejected", { exact: true })).toBeVisible({ timeout: 20_000 });
    // A rejected application has no forward moves anywhere — the gate holds
    // (and Meridian at Offer has none left either).
    await expect(page.getByRole("button", { name: /move to/i })).toHaveCount(0);
    await page
      .locator('section[aria-label="Ready For Review"]')
      .getByRole("button", { name: "Close" })
      .click();
    await expect(page.getByRole("heading", { name: "Closed · 1" })).toBeVisible({ timeout: 20_000 });

    // ── Back on the profile: the stored resume is visible from load ────────
    await page.getByRole("link", { name: "Career Profile" }).click();
    const resumeLink = page.getByRole("link", { name: "jordan-resume.txt" });
    await expect(resumeLink).toBeVisible({ timeout: 20_000 });
    const resumeHref = await resumeLink.getAttribute("href");
    const download = await page.request.get(resumeHref!);
    expect(download.status()).toBe(200);
    expect(await download.text()).toContain("Jordan Seeker — Staff Engineer.");

    // ── Remove entry: add a throwaway entry, persist it, remove it ─────────
    await page.getByRole("button", { name: /add employment history entry/i }).click();
    const temp = page.locator("div.rounded-md.border").nth(1);
    await temp.getByLabel("Organization").fill("Temp Co");
    await temp.getByLabel("Title").fill("Temp Role");
    await page.getByRole("button", { name: /save profile/i }).click();
    await expect(page.getByRole("status")).toHaveText("Profile saved.", { timeout: 20_000 });
    await page.reload();
    // Entries render employment-first: [Surge, Temp], then education [State].
    const tempAfterReload = page.locator("div.rounded-md.border").nth(1);
    await expect(tempAfterReload.getByLabel("Organization")).toHaveValue("Temp Co", { timeout: 20_000 });
    await tempAfterReload.getByRole("button", { name: /remove entry/i }).click();
    await page.getByRole("button", { name: /save profile/i }).click();
    await expect(page.getByRole("status")).toHaveText("Profile saved.", { timeout: 20_000 });
    await page.reload();
    await expect(page.getByLabel("Full name")).toHaveValue("Jordan Seeker", { timeout: 20_000 });
    // The removal persisted: what follows Surge Services is education again.
    await expect(page.locator("div.rounded-md.border").nth(0).getByLabel("Organization"))
      .toHaveValue("Surge Services");
    await expect(page.locator("div.rounded-md.border").nth(1).getByLabel("Organization"))
      .toHaveValue("State University");

    // ── Analytics again: the walked pipeline shows up as counted rows ──────
    await page.getByRole("link", { name: "Analytics" }).click();
    await expect(stat("Jobs found")).toContainText("2", { timeout: 20_000 });
    await expect(stat("Applications")).toContainText("1");
    await expect(stat("Response rate")).toContainText("100%");
    await expect(stat("Interviews")).toContainText("1");
    await expect(stat("Offers")).toContainText("1");

    // ── Discovery imports from a real public board ─────────────────────────
    // These two checks call the live Greenhouse boards API through the real
    // import route — the one external dependency in this journey, accepted
    // because live import is exactly the capability under proof.
    await page.getByRole("link", { name: "Job Discovery" }).click();
    const greenhouseCard = page
      .locator("div.rounded-md.border")
      .filter({ hasText: "Greenhouse job boards" });
    await expect(greenhouseCard).toBeVisible({ timeout: 20_000 });

    // A missing board is the provider's refusal, surfaced verbatim.
    await greenhouseCard.getByLabel("Board token").fill("this-board-does-not-exist-2026");
    await greenhouseCard.getByRole("button", { name: /import postings/i }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: /No public Greenhouse board/ }),
    ).toBeVisible({ timeout: 30_000 });

    // A real board imports, scores, and lands in the recorded list.
    await greenhouseCard.getByLabel("Board token").fill("stripe");
    await greenhouseCard.getByRole("button", { name: /import postings/i }).click();
    await expect(page.getByRole("status")).toHaveText(/Imported \d+ of \d+ postings from /, {
      timeout: 60_000,
    });
    // The list now carries provider-attributed rows scored by the same
    // engine as manual entries.
    await expect(page.getByText(/via greenhouse/).first()).toBeVisible();
  });

  test("searches live job boards, saves a result, and finds it again after a reload", async ({ page }) => {
    /*
     * The Search workflow end to end, in the same live-stack spirit as the
     * Greenhouse import above: the search really contacts the boards.
     *
     * That makes this the one test in the repository that can fail because
     * somebody else's website changed, which is exactly why it is here and
     * not in the ordinary suite. The parsers are pinned against fixtures in
     * `tests/unit/board-search-*.test.ts`; this proves the whole path is
     * connected, and its failure is a real signal that a board moved.
     *
     * It asserts a shape rather than a specific posting. Which jobs a board
     * returns for "engineer" on any given day is not this repository's fact,
     * and asserting one would be asserting somebody else's content.
     */
    test.setTimeout(180_000);

    // Every Playwright test owns a fresh browser context. Exercise the exact
    // canonical gate and return path instead of depending on the prior test's
    // cookies or accepting only the compatibility route.
    await page.goto("/JobSearch");
    await expect(page).toHaveURL(/\/auth\/sign-in\?next=%2FJobSearch/);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("heading", { name: "Job Search", level: 1 })).toBeVisible();

    // The page names the boards it will contact before contacting any.
    await expect(page.getByText(/Searching \d+ boards?:/)).toBeVisible({ timeout: 20_000 });

    await page.getByPlaceholder("Job title, skill or keyword").fill("engineer");
    await page.getByRole("button", { name: /^search$/i }).click();

    /*
     * Either outcome is a pass, and the distinction matters. A board that
     * answers with nothing is a legitimate empty result; a board that fails is
     * reported by name. What must never appear is a result card with no
     * postings behind it.
     */
    const anyOutcome = page
      .locator("[data-testid='search-result-card'], [role='alert']")
      .first();
    await expect(anyOutcome).toBeVisible({ timeout: 90_000 });

    const saveButtons = page.getByRole("button", { name: /^save$/i });
    const savable = await saveButtons.count();
    test.skip(savable === 0, "no board returned a posting to save on this run");

    type RecordedJob = {
      application: { stage: string } | null;
      discoveredAt: string;
      id: string;
      match: { qualified: boolean; score: number } | null;
      source: string;
      title: string;
      url: string | null;
    };
    type ActivityEvent = {
      entity: { id: string | null; type: string };
      eventType: string;
      id: string;
    };
    const [jobsBeforeResponse, activityBeforeResponse] = await Promise.all([
      page.request.get("/api/job-seeker/jobs"),
      page.request.get("/api/activity?limit=100"),
    ]);
    expect(jobsBeforeResponse.ok()).toBeTruthy();
    expect(activityBeforeResponse.ok()).toBeTruthy();
    const jobsBefore = await jobsBeforeResponse.json() as { jobs?: RecordedJob[] };
    const activityBefore = await activityBeforeResponse.json() as { events?: ActivityEvent[] };
    const existingUrls = new Set(
      (jobsBefore.jobs ?? []).flatMap((job) => job.url === null ? [] : [job.url]),
    );
    const previousEventIds = new Set((activityBefore.events ?? []).map((event) => event.id));

    // A stable board result can be the same on successive production runs.
    // Select a URL this synthetic account has not saved before so this walk
    // proves the recorded transaction instead of accepting a duplicate no-op.
    const resultRows = page.locator("[data-testid='search-result-card'] li");
    let candidateRow: Locator | null = null;
    let candidateUrl: string | null = null;
    for (let index = 0; index < await resultRows.count(); index += 1) {
      const row = resultRows.nth(index);
      const link = row.locator("a[href^='http']").first();
      const url = await link.getAttribute("href");
      if (url !== null && !existingUrls.has(url)) {
        candidateRow = row;
        candidateUrl = url;
        break;
      }
    }
    expect(candidateRow, "live boards returned no previously-unsaved linked posting").not.toBeNull();
    expect(candidateUrl).not.toBeNull();

    await candidateRow!.getByRole("button", { name: /^save$/i }).click();
    await expect(candidateRow!.getByRole("button", { name: /saved to your jobs/i })).toBeVisible({
      timeout: 30_000,
    });

    const [jobsAfterResponse, activityAfterResponse] = await Promise.all([
      page.request.get("/api/job-seeker/jobs"),
      page.request.get("/api/activity?limit=100"),
    ]);
    expect(jobsAfterResponse.ok()).toBeTruthy();
    expect(activityAfterResponse.ok()).toBeTruthy();
    const jobsAfter = await jobsAfterResponse.json() as { jobs?: RecordedJob[] };
    const activityAfter = await activityAfterResponse.json() as { events?: ActivityEvent[] };
    const savedJob = (jobsAfter.jobs ?? []).find((job) => job.url === candidateUrl);
    expect(savedJob).toBeDefined();
    expect(savedJob!.source).toMatch(/^(jobnet|jobindex|jobdanmark|freehire)$/);
    expect(savedJob!.match).not.toBeNull();
    expect(savedJob!.match!.score).toEqual(expect.any(Number));
    expect(savedJob!.application).not.toBeNull();
    expect(savedJob!.application!.stage).toBe(
      savedJob!.match!.qualified ? "QUALIFIED" : "FOUND",
    );
    const newRecordingEvents = (activityAfter.events ?? []).filter((event) =>
      !previousEventIds.has(event.id)
      && event.eventType === "job_seeker.job_recorded"
      && event.entity.type === "job_seeker_job"
      && event.entity.id === savedJob!.id,
    );
    expect(newRecordingEvents).toHaveLength(1);

    // Persistence: the saved posting is in the job list, attributed to the
    // board rather than to manual entry, and survives a full reload.
    await page.goto("/job-seeker/discovery");
    await page.reload();
    await expect(
      page.getByText(/via (jobnet|jobindex|freehire)/).first(),
    ).toBeVisible({ timeout: 30_000 });
  });
});
