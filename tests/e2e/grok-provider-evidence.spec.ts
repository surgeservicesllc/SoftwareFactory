import { expect, test } from "@playwright/test";

/**
 * Read-only acceptance of one already-authorized provider-backed Grok run.
 *
 * This lane never creates a session, resumes a graph, enables a worker, or
 * changes autonomy. It is intentionally skipped until an operator supplies a
 * real signed-in account and the UUID of an existing session whose provider
 * work was admitted and recorded. Unlike the component harness, every claim
 * here comes from the production application and Supabase projection.
 *
 *   GROK_PROVIDER_E2E=1
 *   GROK_PROVIDER_E2E_EMAIL=...
 *   GROK_PROVIDER_E2E_PASSWORD=...
 *   GROK_PROVIDER_E2E_SESSION_ID=...
 *   PLAYWRIGHT_BASE_URL=https://...
 *   npx playwright test tests/e2e/grok-provider-evidence.spec.ts \
 *     --project=desktop-chromium
 */
test.describe("Grok provider-backed recorded evidence", () => {
  test.skip(
    process.env.GROK_PROVIDER_E2E !== "1",
    "needs an existing admitted provider-backed session (GROK_PROVIDER_E2E=1)",
  );
  test.describe.configure({ mode: "serial" });

  test("reads the complete workspace without manufacturing provider success", async ({ page }) => {
    test.setTimeout(180_000);

    const email = process.env.GROK_PROVIDER_E2E_EMAIL;
    const password = process.env.GROK_PROVIDER_E2E_PASSWORD;
    const sessionId = process.env.GROK_PROVIDER_E2E_SESSION_ID;
    expect(email, "GROK_PROVIDER_E2E_EMAIL is required").toBeTruthy();
    expect(password, "GROK_PROVIDER_E2E_PASSWORD is required").toBeTruthy();
    expect(sessionId, "GROK_PROVIDER_E2E_SESSION_ID is required").toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    await page.goto("/auth/sign-in");
    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Password").fill(password!);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.waitForURL(/\/(solutions|decision)(\/|$)/, { timeout: 60_000 });

    await page.goto(`/solutions/factory/grok?sessionId=${encodeURIComponent(sessionId!)}`);
    await expect(page.getByRole("heading", { level: 1, name: "Grok Bot" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[aria-label="Loading Grok Bot"]')).toHaveCount(0, {
      timeout: 60_000,
    });
    expect(new URL(page.url()).searchParams.get("sessionId")).toBe(sessionId);

    const conversation = page.getByRole("log", { name: "Recorded session messages" });
    await expect(conversation).toBeVisible();
    await expect.poll(() => conversation.getByRole("article").count()).toBeGreaterThanOrEqual(2);

    const inspector = page.getByRole("complementary", { name: "Session inspector" });
    await inspector.getByRole("tab", { name: "Goal" }).click();
    await expect(inspector.getByText("Outcome")).toBeVisible();

    await inspector.getByRole("tab", { name: "Plan" }).click();
    await expect.poll(() => inspector.getByRole("listitem").count()).toBeGreaterThan(0);

    await inspector.getByRole("tab", { name: "Agents" }).click();
    await expect(inspector.getByText("Observed node execution route")).toBeVisible();
    await expect(inspector.getByText(/anthropic|openai/i).first()).toBeVisible();

    await inspector.getByRole("tab", { name: "Progress" }).click();
    await expect(inspector.getByText(/\d+ of \d+ nodes complete/)).toBeVisible();
    await expect(inspector.getByText(/node\./i).first()).toBeVisible();

    await inspector.getByRole("tab", { name: "Files / Diffs" }).click();
    await expect(inspector.getByRole("link", { name: "Open files and diffs" })).toBeVisible();

    await inspector.getByRole("tab", { name: "Tests" }).click();
    await expect.poll(() => inspector.getByRole("link").count()).toBeGreaterThan(0);

    await inspector.getByRole("tab", { name: "Preview" }).click();
    await expect(inspector.getByRole("link")).toHaveAttribute("href", /^https?:\/\//);

    await inspector.getByRole("tab", { name: "Artifacts" }).click();
    await expect.poll(() => inspector.getByRole("listitem").count()).toBeGreaterThan(0);

    await inspector.getByRole("tab", { name: "Deployment" }).click();
    await expect(inspector.getByText("Production health")).toBeVisible();
    await expect(inspector.getByText("healthy", { exact: true })).toBeVisible();

    // These are current, explicit product limits. Their presence prevents this
    // evidence-reader from being mistaken for full autonomous-loop acceptance.
    await expect(inspector.getByText("Rollback")).toBeVisible();
    await expect(inspector.getByText("Automatic continuation")).toBeVisible();
    // The two badges, exactly: the pane's detail sentence also says "not
    // connected" in prose, and a loose match would count that too.
    await expect(inspector.getByText("Not Connected", { exact: true })).toHaveCount(2);
  });
});
