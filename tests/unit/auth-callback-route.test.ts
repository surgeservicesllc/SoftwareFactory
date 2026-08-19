// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const takeAuthReturnPath = vi.fn(async (fallback: string) => fallback);
vi.mock("@/lib/supabase/auth-return", () => ({ takeAuthReturnPath }));

const verifyOtp = vi.fn();
const exchangeCodeForSession = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { exchangeCodeForSession, getUser, verifyOtp },
  }),
}));

const { GET } = await import("@/app/auth/callback/route");

const ORIGIN = "https://factory.test";
const TOKEN_HASH = "pkce_0123456789abcdef0123456789abcdef";

function callback(query: string) {
  return GET(new Request(`${ORIGIN}/auth/callback${query}`));
}

beforeEach(() => {
  verifyOtp.mockResolvedValue({ data: {}, error: null });
  exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("GET /auth/callback", () => {
  it("verifies an emailed token hash server-side and signs the visitor in", async () => {
    // The emailed lane must not depend on any cookie from the requesting
    // browser — mail apps open links in their own embedded browser.
    const response = await callback(`?token_hash=${TOKEN_HASH}&type=email`);

    expect(verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: TOKEN_HASH });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    const location = response.headers.get("location") ?? "";
    expect(location).toBe(`${ORIGIN}/auth/onboarding`);
    // The one-time material never travels onward.
    expect(location).not.toContain(TOKEN_HASH);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("honors a survivable next parameter but only as a safe internal path", async () => {
    const onSite = await callback(`?token_hash=${TOKEN_HASH}&type=magiclink&next=%2Fsolutions`);
    expect(onSite.headers.get("location")).toBe(`${ORIGIN}/solutions`);

    const offSite = await callback(`?token_hash=${TOKEN_HASH}&type=magiclink&next=https%3A%2F%2Fevil.test%2F`);
    expect(offSite.headers.get("location")).toBe(`${ORIGIN}/auth/onboarding`);
  });

  it("refuses an unsupported verification type without calling the provider", async () => {
    const response = await callback(`?token_hash=${TOKEN_HASH}&type=sms`);

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(`${ORIGIN}/auth/sign-in?error=callback_failed`);
  });

  it("lands a failed token verification on the retryable sign-in notice, logging shape only", async () => {
    verifyOtp.mockResolvedValue({
      data: {},
      error: Object.assign(new Error("Token has expired or is invalid"), {
        code: "otp_expired",
        status: 403,
      }),
    });

    const response = await callback(`?token_hash=${TOKEN_HASH}&type=email`);

    expect(response.headers.get("location")).toBe(`${ORIGIN}/auth/sign-in?error=callback_failed`);
    const logged = vi.mocked(console.error).mock.calls
      .map((args) => args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "))
      .join(" ");
    expect(logged).toContain("token_hash verification failed");
    expect(logged).toContain("otp_expired");
    // Never the secret material itself.
    expect(logged).not.toContain(TOKEN_HASH);
  });

  it("keeps the PKCE code lane working for same-browser and OAuth returns", async () => {
    const response = await callback("?code=one-time-code");

    expect(exchangeCodeForSession).toHaveBeenCalledWith("one-time-code");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(`${ORIGIN}/auth/onboarding`);
  });

  it("treats a callback with neither token nor code as a failed sign-in", async () => {
    const response = await callback("");

    expect(response.headers.get("location")).toBe(`${ORIGIN}/auth/sign-in?error=callback_failed`);
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("refuses a verified token whose session yields no user", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await callback(`?token_hash=${TOKEN_HASH}&type=email`);

    expect(response.headers.get("location")).toBe(`${ORIGIN}/auth/sign-in?error=callback_failed`);
  });
});
