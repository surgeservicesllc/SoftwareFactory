import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * The critical owner journey, end to end, in two honest lanes.
 *
 * Lane 1 (every CI run, all viewports): the journey's scaffolding while signed
 * out. Every step a new owner walks — dashboard guide, sign-in, connections,
 * the goal box, runs — must exist, be reachable, name its gate, and offer the
 * next action. No step may dead-end.
 *
 * Lane 2 (local Supabase stack only, like auth-lifecycle.spec.ts): the signed
 * -in journey walked in a real browser against real GoTrue and Postgres —
 * sign-up, confirmation, onboarding, the dashboard guide counting progress,
 * and the goal box gating honestly on a connected project. It stops at the
 * external-GitHub boundary: connecting a real GitHub App and submitting a
 * live command need the owner's accounts, which is exactly what the
 * production canary proves.
 */

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const usingLocalSupabase = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes("127.0.0.1");

test.describe("critical journey scaffolding (signed out)", () => {
  test("every step of the owner journey exists and names its next action", async ({ page }) => {
    // Step 0 — the Dashboard opens with the four-step guide, gated on sign-in.
    await page.goto("/solutions");
    await expect(page.getByRole("heading", { name: "Get started" })).toBeVisible();
    await expect(page.getByText("Connect GitHub", { exact: true })).toBeVisible();
    await expect(page.getByText("Add a project", { exact: true })).toBeVisible();
    await expect(page.getByText("Check your AI worker", { exact: true })).toBeVisible();
    await expect(page.getByText("Give your Factory a goal", { exact: true })).toBeVisible();
    // The attention area never cries wolf: absent entirely when there is
    // nothing only the owner can decide.
    await expect(page.getByText("Needs your attention")).toHaveCount(0);

    // Step 1 — sign-in offers the passwordless path.
    await page.goto("/auth/sign-in");
    await expect(page.getByLabel(/email/i).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: /email me a sign-in link instead/i }),
    ).toBeVisible();

    // Step 2 — connections gate names itself and offers a way forward. A
    // signed-out visitor sees the sign-in gate; a locally unconfigured stack
    // truthfully reports unavailability instead. Both are honest boundaries
    // with an action, never a dead end (same precedent as console.spec).
    await page.goto("/solutions/connections");
    await expect(
      page.getByRole("heading", { name: /sign in first|connections are unavailable/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /sign in|check connections/i })
        .or(page.getByRole("button", { name: /try again|retry/i }))
        .first(),
    ).toBeVisible();

    // Step 3 — the goal box exists and its submit is honestly gated.
    await page.goto("/solutions/bot-manager");
    await expect(page.getByLabel("What do you want done?")).toBeVisible();
    await expect(page.getByRole("button", { name: "Queue command" })).toBeDisabled();

    // Step 4 — run history names its gate rather than showing an empty shell.
    await page.goto("/solutions/runs");
    await expect(
      page.getByRole("heading", { name: /sign in to see your runs/i }),
    ).toBeVisible();
  });
});

test.describe("critical journey against a real Supabase", () => {
  test.skip(!usingLocalSupabase, "needs a local Supabase stack; see auth-lifecycle.spec.ts");

  test("a new owner reaches the guide and an honestly gated goal box", async ({ page, playwright }) => {
    const email = `journey-${Date.now()}@example.test`;
    const password = "Str0ng-Passw0rd-Journey!";
    const origin = test.info().project.use.baseURL!;
    const headers = { Origin: origin };

    // Sign up through the same route the form posts to; page.request shares
    // the browser's cookie jar, so the session lands in the page itself.
    const signUp = await page.request.post("/api/auth/sign-up", {
      data: { displayName: "Journey Owner", email, password },
      headers,
    });
    expect(signUp.status(), await signUp.text()).toBeLessThan(300);
    const { confirmationRequired } = await signUp.json() as { confirmationRequired?: boolean };

    if (confirmationRequired) {
      const mail = await playwright.request.newContext({ baseURL: MAILPIT });
      const link = await confirmationLinkFor(mail, email);
      expect(link, "no confirmation link reached the mailbox").toBeTruthy();
      await page.goto(link!);
      await mail.dispose();
    } else {
      const signIn = await page.request.post("/api/auth/sign-in", {
        data: { email, password },
        headers,
      });
      expect(signIn.status(), await signIn.text()).toBe(200);
    }

    // Onboarding makes this account the owner of a fresh workspace.
    const onboarding = await page.request.post("/api/onboarding", {
      data: { organizationName: `Journey Workspace ${Date.now()}` },
      headers,
    });
    expect(onboarding.status(), await onboarding.text()).toBeLessThan(300);

    // The Dashboard guide reads the fresh workspace truthfully: nothing done,
    // and the current step is connecting GitHub.
    await page.goto("/solutions");
    await expect(page.getByRole("heading", { name: "Get started" })).toBeVisible();
    await expect(page.getByText("0 of 4 done")).toBeVisible();
    const connectStep = page.getByText("Connect GitHub", { exact: true }).locator("..").locator("..");
    await expect(connectStep.getByRole("link", { name: /connect/i }))
      .toHaveAttribute("href", "/solutions/connections");

    // A fresh workspace has nothing only the owner can decide.
    await expect(page.getByText("Needs your attention")).toHaveCount(0);

    // The goal box renders, says why it cannot submit yet, and stays disabled
    // — the journey's next step is the real GitHub connection, which only the
    // owner's accounts can provide (the production canary's job).
    await page.goto("/solutions/bot-manager");
    await expect(page.getByLabel("What do you want done?")).toBeVisible();
    await expect(page.getByRole("option", { name: "No connected projects yet" })).toBeVisible();
    await page.getByLabel("What do you want done?").fill("Prove the journey end to end");
    await expect(page.getByRole("button", { name: "Queue command" })).toBeDisabled();
  });
});

/** Polls the mailbox: GoTrue sends the message just after the API responds. */
async function confirmationLinkFor(mail: APIRequestContext, email: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const listed = await mail.get("/api/v1/messages");
    if (listed.ok()) {
      const { messages = [] } = await listed.json() as {
        messages?: { ID: string; To?: { Address: string }[] }[];
      };
      const match = messages.find((message) =>
        message.To?.some((to) => to.Address.toLowerCase() === email.toLowerCase()));
      if (match) {
        const body = await (await mail.get(`/api/v1/message/${match.ID}`)).json() as {
          HTML?: string; Text?: string;
        };
        const found = `${body.HTML ?? ""}\n${body.Text ?? ""}`.match(/https?:\/\/[^"'\s<>)]+/g) ?? [];
        const link = found.find((candidate) => /token|verify|confirm|callback/.test(candidate));
        return link ? link.replace(/&amp;/g, "&") : null;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}
