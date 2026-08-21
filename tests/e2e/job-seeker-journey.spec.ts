import { expect, test } from "@playwright/test";

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

    // Resume upload: a real file through the real endpoint.
    await page.getByLabel(/Resume file/).setInputFiles({
      name: "jordan-resume.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Jordan Seeker — Staff Engineer.\nTypeScript, PostgreSQL, Next.js."),
    });
    await expect(page.getByText(/Uploaded jordan-resume\.txt/)).toBeVisible({ timeout: 20_000 });

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
    // The registry is honest: adapters are Not Connected with needs named.
    await expect(page.getByText("Not Connected").first()).toBeVisible();
    await expect(page.getByText(/Needs: SOFTWAREFACTORY_GREENHOUSE_BOARDS/)).toBeVisible();

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
  });
});
