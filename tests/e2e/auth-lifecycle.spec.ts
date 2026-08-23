import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * The whole account lifecycle against a real Supabase:
 * sign-up → confirmation email → confirmation link → onboarding → sign-in.
 *
 * The emailed link is the one step production cannot prove, because checking it
 * needs a mailbox. A local stack has one — `supabase start` runs Mailpit and
 * every confirmation message lands there — so the chain can be walked exactly
 * as a visitor walks it, against real GoTrue and real Postgres rather than a
 * mock.
 *
 * Skipped unless a local stack is pointed at, so the ordinary suite is
 * unaffected:
 *
 *   npx supabase start -x studio,imgproxy,edge-runtime,pooler,realtime,storage,logflare,vector,pg-meta
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key> \
 *   npx playwright test auth-lifecycle --project=desktop-chromium
 */

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const usingLocalSupabase = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes("127.0.0.1");

test.describe("account lifecycle against a real Supabase", () => {
  test.skip(!usingLocalSupabase, "needs a local Supabase stack; see the comment above");

  test("signs up, confirms by email, onboards, and signs in", async ({ request, playwright }) => {
    const email = `verify-${Date.now()}@example.test`;
    const password = "Str0ng-Passw0rd-Verify!";
    // These routes are same-origin only, which is the point; send the header a
    // browser would send rather than relaxing the guard for a test.
    const origin = test.info().project.use.baseURL!;
    const headers = { Origin: origin };

    // 1. Sign up.
    const signUp = await request.post("/api/auth/sign-up", {
      data: { displayName: "Verify User", email, password },
      headers,
    });
    expect(signUp.status(), await signUp.text()).toBeLessThan(300);
    const signUpBody = await signUp.json() as { confirmationRequired?: boolean };

    if (signUpBody.confirmationRequired) {
      // 2. The confirmation email must actually exist.
      const mail = await playwright.request.newContext({ baseURL: MAILPIT });
      const link = await confirmationLinkFor(mail, email);
      expect(link, "no confirmation link reached the mailbox").toBeTruthy();

      /*
       * 3. Following it must land on onboarding, not the sign-in error page.
       *
       * The callback now sends everyone to `/decision`; a brand-new account
       * has no workspace, so that page forwards to onboarding and asks to be
       * returned. Following the redirects proves the whole chain, and the
       * destination it must end on is unchanged.
       */
      const confirmed = await request.get(link!, { maxRedirects: 5 });
      expect(confirmed.url(), "the confirmation link did not reach onboarding")
        .toContain("/auth/onboarding");
      await mail.dispose();
    }

    // 4. Onboarding makes the caller the owner of a new workspace.
    const onboarding = await request.post("/api/onboarding", {
      data: { organizationName: `Verify Workspace ${Date.now()}` },
      headers,
    });
    expect(onboarding.status(), await onboarding.text()).toBeLessThan(300);
    expect(await onboarding.json()).toMatchObject({ organization: { role: "owner" } });

    // 5. A fresh session can sign in and lands on the chooser (owner request,
    //    2026-08-23) rather than a console page picked for them.
    const clean = await playwright.request.newContext({ baseURL: origin });
    const signIn = await clean.post("/api/auth/sign-in", { data: { email, password }, headers });
    expect(signIn.status(), await signIn.text()).toBe(200);
    expect(await signIn.json()).toMatchObject({ authenticated: true, next: "/decision" });
    await clean.dispose();
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
        // The HTML part encodes separators, so the raw match carries &amp;
        // and every parameter after the first collapses into the token.
        return link ? link.replace(/&amp;/g, "&") : null;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}
