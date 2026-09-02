// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
  recheckPosting: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization: harness.requireActiveOrganization,
}));
vi.mock("@/lib/job-seeker/board-search/recheck", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/job-seeker/board-search/recheck")>()),
  recheckPosting: harness.recheckPosting,
}));

import { POST } from "@/app/api/job-seeker/search/recheck/route";
import { postingUrlKey } from "@/lib/job-seeker/board-search/posting-key";

/**
 * The recheck route (ADR-249): the ledger is the allow-list, a recent check
 * is reused without a fetch, a new check is recorded through the definer
 * function and folded into the freshness verdict, and a URL outside the
 * public web is refused before anything is read.
 */

const url = "https://boards.example.com/jobs/77";
const key = postingUrlKey(url);

function request(body: unknown) {
  return new Request("https://factory.example/api/job-seeker/search/recheck", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://factory.example" },
    body: JSON.stringify(body),
  });
}

function sightingRow(overrides: Record<string, unknown> = {}) {
  return {
    url_key: key,
    first_seen_at: new Date(Date.now() - 60 * 86_400_000).toISOString(),
    last_seen_at: new Date().toISOString(),
    times_seen: 4,
    earliest_posted_on: new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10),
    latest_posted_on: null,
    reposts: 0,
    closes_on: null,
    last_checked_at: null,
    last_check_status: null,
    last_check_note: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/job-seeker/search/recheck", () => {
  it("rechecks a posting the ledger knows, records the outcome, and folds it into the verdict", async () => {
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (fn === "read_posting_sightings") return { data: [sightingRow()], error: null };
      if (fn === "record_posting_recheck") {
        expect(args).toEqual({ p_url_key: key, p_status: "gone", p_http_status: 404, p_note: "HTTP 404 — the page is gone." });
        return { data: [{ url_key: key, last_checked_at: new Date().toISOString(), last_check_status: "gone", last_check_http_status: 404, last_check_note: "HTTP 404 — the page is gone.", checks: 1 }], error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    });
    harness.requireActiveOrganization.mockResolvedValue({ activeOrganization: { id: "org" }, user: { id: "user-1" }, client: { rpc } });
    harness.recheckPosting.mockResolvedValue({ status: "gone", httpStatus: 404, note: "HTTP 404 — the page is gone." });

    const response = await POST(request({ url, publishedOn: "2026-08-25", closesOn: null }));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      reused: boolean; recheck: { status: string; note: string; minutesAgo: number };
      freshness: { level: string; reasons: string[]; recheck: { status: string } | null };
    };
    expect(payload.reused).toBe(false);
    expect(payload.recheck).toMatchObject({ status: "gone", note: "HTTP 404 — the page is gone.", minutesAgo: 0 });
    expect(payload.freshness.level).toBe("stale");
    expect(payload.freshness.reasons.at(-1)).toBe("Rechecked today: HTTP 404 — the page is gone.");
    expect(payload.freshness.recheck?.status).toBe("gone");
    expect(harness.recheckPosting).toHaveBeenCalledWith(url);
  });

  it("reuses a check under ten minutes old without reading the page again", async () => {
    const checkedAt = new Date(Date.now() - 3 * 60_000).toISOString();
    const rpc = vi.fn(async (fn: string) => {
      if (fn === "read_posting_sightings") {
        return { data: [sightingRow({ last_checked_at: checkedAt, last_check_status: "open", last_check_note: "HTTP 200 — the page is up and does not say the position is closed." })], error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    });
    harness.requireActiveOrganization.mockResolvedValue({ activeOrganization: { id: "org" }, user: { id: "user-1" }, client: { rpc } });
    const payload = (await (await POST(request({ url, publishedOn: "2026-06-01" }))).json()) as {
      reused: boolean; recheck: { minutesAgo: number }; freshness: { level: string };
    };
    expect(payload.reused).toBe(true);
    expect(payload.recheck.minutesAgo).toBe(3);
    // Sixty-plus days old would be stale; a page that answered is at most aging.
    expect(payload.freshness.level).toBe("aging");
    expect(harness.recheckPosting).not.toHaveBeenCalled();
  });

  it("refuses a posting the ledger has never seen, and a URL outside the public web, before any read", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    harness.requireActiveOrganization.mockResolvedValue({ activeOrganization: { id: "org" }, user: { id: "user-1" }, client: { rpc } });
    expect((await POST(request({ url }))).status).toBe(404);
    expect((await POST(request({ url: "https://169.254.169.254/latest" }))).status).toBe(400);
    expect((await POST(request({ url: "http://boards.example.com/jobs/77" }))).status).toBe(400);
    expect(harness.recheckPosting).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request", async () => {
    const response = await POST(new Request("https://factory.example/api/job-seeker/search/recheck", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ url }),
    }));
    expect(response.ok).toBe(false);
  });
});
