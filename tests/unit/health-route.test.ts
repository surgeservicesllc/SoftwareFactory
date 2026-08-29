// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const from = vi.fn();
const createSupabaseAnonClient = vi.fn(() => ({ from }));

vi.mock("@/lib/supabase/anon", () => ({ createSupabaseAnonClient }));

const healthRequest = (url = "https://www.theagoras.com/api/health") => new Request(url);

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.VERCEL_GIT_COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
    process.env.VERCEL_GIT_COMMIT_REF = "main";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://qpuofpmagrmyamahqwxw.supabase.co";
    process.env.SOFTWAREFACTORY_EXPECTED_SUPABASE_PROJECT_REF = "qpuofpmagrmyamahqwxw";
    process.env.SOFTWAREFACTORY_EXPECTED_VERCEL_PROJECT_ID = "prj_expected123";
    process.env.SOFTWAREFACTORY_EXPECTED_PRODUCTION_HOST = "www.theagoras.com";
    process.env.VERCEL_PROJECT_ID = "prj_expected123";
    process.env.VERCEL_DEPLOYMENT_ID = "dpl_deployment123";
    process.env.VERCEL_URL = "softwarefactory-release123-surgeservices-projects.vercel.app";
    process.env.VERCEL_TARGET_ENV = "production";
  });

  afterEach(() => {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.VERCEL_GIT_COMMIT_REF;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SOFTWAREFACTORY_EXPECTED_SUPABASE_PROJECT_REF;
    delete process.env.SOFTWAREFACTORY_EXPECTED_VERCEL_PROJECT_ID;
    delete process.env.SOFTWAREFACTORY_EXPECTED_PRODUCTION_HOST;
    delete process.env.VERCEL_PROJECT_ID;
    delete process.env.VERCEL_DEPLOYMENT_ID;
    delete process.env.VERCEL_URL;
    delete process.env.VERCEL_TARGET_ENV;
  });

  it("reports the exact release and a successful anonymous Supabase read", async () => {
    const limit = vi.fn().mockResolvedValue({ data: [{ slug: "home" }], error: null });
    const select = vi.fn(() => ({ limit }));
    from.mockReturnValue({ select });
    const { GET } = await import("@/app/api/health/route");

    const response = await GET(healthRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "SoftwareFactory",
      database: "reachable",
      databaseProject: "matched",
      databaseProjectRef: "qpuofpmagrmyamahqwxw",
      deployment: "matched",
      deploymentUrl: "https://softwarefactory-release123-surgeservices-projects.vercel.app",
      vercelDeploymentId: "dpl_deployment123",
      vercelProjectId: "prj_expected123",
      release: "matched",
      releaseSha: "0123456789abcdef0123456789abcdef01234567",
      releaseRef: "main",
    });
    expect(createSupabaseAnonClient).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledWith("marketing_pages");
  });

  it("fails closed without exposing database diagnostics", async () => {
    const limit = vi.fn().mockResolvedValue({ data: null, error: { message: "secret detail" } });
    const select = vi.fn(() => ({ limit }));
    from.mockReturnValue({ select });
    const { GET } = await import("@/app/api/health/route");

    const response = await GET(healthRequest());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ status: "degraded", database: "unreachable" });
    expect(JSON.stringify(body)).not.toContain("secret detail");
  });

  it("refuses a reachable-looking but wrong Supabase project without disclosing either ref", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://aaaaaaaaaaaaaaaaaaaa.supabase.co";
    const { GET } = await import("@/app/api/health/route");

    const response = await GET(healthRequest());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({
      status: "degraded",
      database: "identity_mismatch",
      databaseProject: "mismatched",
    });
    expect(JSON.stringify(body)).not.toContain("qpuofpmagrmyamahqwxw");
    expect(JSON.stringify(body)).not.toContain("aaaaaaaaaaaaaaaaaaaa");
    expect(createSupabaseAnonClient).not.toHaveBeenCalled();
  });

  it.each([
    "http://qpuofpmagrmyamahqwxw.supabase.co",
    "https://qpuofpmagrmyamahqwxw.supabase.co:444",
    "https://qpuofpmagrmyamahqwxw.supabase.co/rest",
    "https://qpuofpmagrmyamahqwxw.supabase.co?redirect=1",
    "https://user:password@qpuofpmagrmyamahqwxw.supabase.co",
  ])("rejects the noncanonical Supabase URL %s", async (url) => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    const { GET } = await import("@/app/api/health/route");

    const response = await GET(healthRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      database: "identity_mismatch",
      databaseProject: "mismatched",
      databaseProjectRef: null,
    });
    expect(createSupabaseAnonClient).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, "main"],
    ["not-a-commit", "main"],
    ["0123456789abcdef0123456789abcdef01234567", undefined],
    ["0123456789abcdef0123456789abcdef01234567", "feature/unsafe"],
  ])("fails closed for release SHA %s and ref %s", async (sha, ref) => {
    if (sha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = sha;
    if (ref === undefined) delete process.env.VERCEL_GIT_COMMIT_REF;
    else process.env.VERCEL_GIT_COMMIT_REF = ref;
    const { GET } = await import("@/app/api/health/route");

    const response = await GET(healthRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "degraded",
      database: "not_checked",
      databaseProject: "matched",
      databaseProjectRef: "qpuofpmagrmyamahqwxw",
      release: "identity_mismatch",
    });
    expect(createSupabaseAnonClient).not.toHaveBeenCalled();
  });

  it.each([
    ["SOFTWAREFACTORY_EXPECTED_VERCEL_PROJECT_ID", undefined],
    ["VERCEL_PROJECT_ID", "prj_wrong123"],
    ["VERCEL_DEPLOYMENT_ID", "not-a-deployment"],
    ["VERCEL_URL", "other-project-release123.vercel.app"],
    ["VERCEL_TARGET_ENV", "preview"],
  ])("fails closed for invalid Vercel identity field %s", async (name, value) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    const { GET } = await import("@/app/api/health/route");

    const response = await GET(healthRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "degraded",
      deployment: "identity_mismatch",
      release: "matched",
    });
    expect(createSupabaseAnonClient).not.toHaveBeenCalled();
  });

  it.each([
    "https://theagoras.com/api/health",
    "http://www.theagoras.com/api/health",
    "https://www.theagoras.com:444/api/health",
    "https://www.theagoras.com/api/health?probe=1",
  ])("fails closed when the probe did not reach the exact production alias: %s", async (url) => {
    const { GET } = await import("@/app/api/health/route");

    const response = await GET(healthRequest(url));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      deployment: "identity_mismatch",
      vercelProjectId: "prj_expected123",
    });
    expect(createSupabaseAnonClient).not.toHaveBeenCalled();
  });

  it("fails closed when no expected Supabase project identity is configured", async () => {
    delete process.env.SOFTWAREFACTORY_EXPECTED_SUPABASE_PROJECT_REF;
    const { GET } = await import("@/app/api/health/route");

    const response = await GET(healthRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      database: "identity_mismatch",
      databaseProject: "mismatched",
    });
    expect(createSupabaseAnonClient).not.toHaveBeenCalled();
  });
});
