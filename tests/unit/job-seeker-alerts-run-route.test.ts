// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  rpc: vi.fn(),
  sendAlertEmail: vi.fn(),
  alertEmailConnected: vi.fn(),
  search: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ rpc: harness.rpc })),
}));
vi.mock("@/lib/job-seeker/alert-email", () => ({
  alertEmailConnected: harness.alertEmailConnected,
  sendAlertEmail: harness.sendAlertEmail,
}));
vi.mock("@/lib/job-seeker/board-search/registry", () => {
  const adapter = {
    key: "remotive",
    name: "Remotive",
    summary: "",
    coverage: "",
    supportsLocation: false,
    search: harness.search,
  };
  return {
    BOARD_SEARCH_ADAPTERS: [adapter],
    boardSearchAdapter: (key: string) => (key === "remotive" ? adapter : null),
    boardSearchKeys: () => ["remotive"],
  };
});

import { GET } from "@/app/api/job-seeker/alerts/run/route";

const dueAlert = {
  alert_id: "aaaaaaaa-1111-4222-8333-444444444444",
  saved_search_id: "bbbbbbbb-1111-4222-8333-444444444444",
  organization_id: "cccccccc-1111-4222-8333-444444444444",
  user_id: "dddddddd-1111-4222-8333-444444444444",
  recipient_email: "seeker@example.org",
  search_name: "Remote marketing",
  search_query: { text: "marketing", boards: ["remotive"] },
  cadence: "daily",
  profile: {
    skills: ["marketing"],
    technologies: [],
    industries: [],
    employment_history: [{ title: "Growth Marketing Manager" }],
    salary_target: null,
    location: "USA",
    work_arrangement: "remote",
    open_to_relocation: false,
  },
  preferences: {
    target_titles: [],
    compensation_minimum: null,
    locations: [],
    work_arrangements: ["remote"],
    industries: [],
    exclusions: [],
    qualification_threshold: 80,
  },
  profile_recorded: true,
  delivered_urls: [],
};

const boardHit = {
  job: {
    externalId: "r-1",
    url: "https://remotive.com/remote-jobs/1",
    title: "Growth Marketing Manager",
    company: "Contra",
    salaryText: "$120,000",
    location: "USA",
    workModel: "remote",
    description: "Own paid acquisition.",
  },
  publishedOn: "2026-08-29",
  closesOn: null,
};

function cronRequest(secret: string | null = "cron-secret-value") {
  return new Request("https://factory.example/api/job-seeker/alerts/run", {
    headers: secret === null ? {} : { authorization: `Bearer ${secret}` },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "cron-secret-value");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "servicekeyForTestsOnly");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  harness.alertEmailConnected.mockReturnValue(true);
  harness.sendAlertEmail.mockResolvedValue({ sent: true, detail: null });
  harness.search.mockResolvedValue({ board: "remotive", hits: [boardHit], totalAvailable: 1 });
  harness.rpc.mockImplementation(async (fn: string) =>
    fn === "list_due_job_seeker_alerts"
      ? { data: [dueAlert], error: null }
      : { data: [], error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the alert runner", () => {
  it("fails closed while CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await GET(cronRequest());
    expect(response.status).toBe(503);
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("refuses a caller without the scheduler's bearer", async () => {
    expect((await GET(cronRequest("wrong"))).status).toBe(401);
    expect((await GET(cronRequest(null))).status).toBe(401);
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("does not scan while email is Not Connected, and says why", async () => {
    harness.alertEmailConnected.mockReturnValue(false);
    const response = await GET(cronRequest());
    const payload = (await response.json()) as { ran: boolean; reason?: string };
    expect(payload.ran).toBe(false);
    expect(payload.reason).toMatch(/Not Connected/);
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("scans a due alert, emails the new jobs, and records the scan", async () => {
    const response = await GET(cronRequest());
    const payload = (await response.json()) as { ran: boolean; scanned: number; emailed: number; failures: unknown[] };

    expect(payload).toMatchObject({ ran: true, scanned: 1, emailed: 1, failures: [] });
    expect(harness.search).toHaveBeenCalledWith(
      expect.objectContaining({ text: "marketing", limit: 25 }),
    );
    const email = harness.sendAlertEmail.mock.calls[0]![0] as { to: string; subject: string; text: string };
    expect(email.to).toBe("seeker@example.org");
    expect(email.text).toContain("Contra — Growth Marketing Manager");
    expect(email.text).toContain("match score");

    const record = harness.rpc.mock.calls.find(([fn]) => fn === "record_job_seeker_alert_scan");
    const args = record?.[1] as { p_alert_id: string; p_deliveries: Array<{ jobUrl: string; emailStatus: string }> };
    expect(args.p_alert_id).toBe(dueAlert.alert_id);
    expect(args.p_deliveries).toHaveLength(1);
    expect(args.p_deliveries[0]).toMatchObject({
      jobUrl: "https://remotive.com/remote-jobs/1",
      emailStatus: "sent",
    });
  });

  it("sends nothing when every job was already delivered, and still records the scan", async () => {
    harness.rpc.mockImplementation(async (fn: string) =>
      fn === "list_due_job_seeker_alerts"
        ? { data: [{ ...dueAlert, delivered_urls: ["https://remotive.com/remote-jobs/1"] }], error: null }
        : { data: [], error: null });

    const response = await GET(cronRequest());
    const payload = (await response.json()) as { scanned: number; emailed: number };

    expect(payload).toMatchObject({ scanned: 1, emailed: 0 });
    expect(harness.sendAlertEmail).not.toHaveBeenCalled();
    const record = harness.rpc.mock.calls.find(([fn]) => fn === "record_job_seeker_alert_scan");
    expect((record?.[1] as { p_deliveries: unknown[] }).p_deliveries).toEqual([]);
  });

  it("records a failed send as failed, so the ledger still blocks a retry storm", async () => {
    harness.sendAlertEmail.mockResolvedValue({ sent: false, detail: "Resend answered 403: domain not verified" });

    const response = await GET(cronRequest());
    const payload = (await response.json()) as { emailed: number; failures: Array<{ detail: string }> };

    expect(payload.emailed).toBe(0);
    expect(payload.failures[0]?.detail).toMatch(/domain not verified/);
    const record = harness.rpc.mock.calls.find(([fn]) => fn === "record_job_seeker_alert_scan");
    expect((record?.[1] as { p_deliveries: Array<{ emailStatus: string }> }).p_deliveries[0]?.emailStatus).toBe("failed");
  });

  it("reports a stored query that no longer parses instead of guessing at it", async () => {
    harness.rpc.mockImplementation(async (fn: string) =>
      fn === "list_due_job_seeker_alerts"
        ? { data: [{ ...dueAlert, search_query: { text: "x", surprise: true } }], error: null }
        : { data: [], error: null });

    const response = await GET(cronRequest());
    const payload = (await response.json()) as { scanned: number; failures: Array<{ detail: string }> };

    expect(payload.scanned).toBe(0);
    expect(payload.failures[0]?.detail).toMatch(/did not parse/);
    expect(harness.search).not.toHaveBeenCalled();
  });
});
