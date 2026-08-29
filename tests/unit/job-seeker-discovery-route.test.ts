import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization } = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));

import { GET } from "@/app/api/job-seeker/discovery/route";

/**
 * The discovery read, against a database that is behind the code.
 *
 * This file exists because of a production incident. `20260828000400` adds
 * `saved_at` and three metric tables, and a hosted apply is a separately gated
 * step — so between a deploy and that apply the code selected a column the
 * database did not have, every request 500'd, and the page read "Job discovery
 * could not be loaded". The postings were all there; a bookmark column nobody
 * had yet took the whole page down.
 *
 * The property is therefore: the postings are the page, and every addition to
 * them degrades on its own. A missing column costs the bookmark. A missing
 * metric table costs that figure and nothing else.
 */

const organizationId = "44444444-4444-4444-8444-444444444444";

const POSTING = {
  id: "job-1",
  source: "greenhouse",
  url: null,
  title: "VP of Marketing",
  company: "Adobe",
  salary_text: "$220K – $280K",
  location: "Remote (US)",
  work_model: "remote",
  description: null,
  discovered_at: "2026-08-28T10:00:00.000Z",
  saved_at: null,
  job_seeker_matches: [],
  job_seeker_applications: [],
};

const missingColumn = { code: "42703", message: 'column "saved_at" does not exist' };
const missingTable = { code: "42P01", message: 'relation "job_seeker_search_events" does not exist' };

/**
 * A Supabase stub shaped like the builder: every filter returns `this`, and the
 * terminal shape is decided per table by the scenario.
 */
function stubClient(scenario: {
  jobsWithSaved?: { data?: unknown; error?: unknown };
  jobsBase?: { data?: unknown; error?: unknown };
  counts?: Record<string, { count?: number | null; error?: unknown }>;
  preferences?: { data?: unknown; error?: unknown };
}) {
  return {
    from(table: string) {
      let selected = "";
      const builder: Record<string, unknown> = {
        select(columns: string) { selected = columns; return builder; },
        eq() { return builder; },
        gte() { return builder; },
        order() { return builder; },
        limit() {
          return Promise.resolve(
            selected.includes("saved_at")
              ? scenario.jobsWithSaved ?? { data: [POSTING], error: null }
              : scenario.jobsBase ?? { data: [POSTING], error: null },
          );
        },
        maybeSingle() {
          return Promise.resolve(scenario.preferences ?? { data: null, error: null });
        },
        then(resolve: (value: unknown) => unknown) {
          // Count queries await the builder itself.
          return Promise.resolve(
            scenario.counts?.[table] ?? { count: 0, error: null },
          ).then(resolve);
        },
      };
      return builder;
    },
  };
}

function useClient(client: unknown) {
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    client,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/job-seeker/discovery", () => {
  it("returns the postings when the database has every new column", async () => {
    useClient(stubClient({}));
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json() as { jobs: unknown[]; savedJobsSupported: boolean };
    expect(body.jobs).toHaveLength(1);
    expect(body.savedJobsSupported).toBe(true);
  });

  it("still returns the postings when the bookmark column is missing", async () => {
    // The incident. Before the fallback this was a 500 and an empty page.
    useClient(stubClient({ jobsWithSaved: { data: null, error: missingColumn } }));

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json() as {
      jobs: { savedAt: string | null }[];
      savedJobsSupported: boolean;
    };
    expect(body.jobs).toHaveLength(1);
    expect(body.savedJobsSupported).toBe(false);
    expect(body.jobs[0].savedAt).toBeNull();
  });

  it("reports a missing metric table as an absent figure, not a zero", async () => {
    // Null, not 0: the page omits a figure it could not measure, and a zero
    // would read as "no alerts" rather than "not measured".
    useClient(stubClient({
      counts: { job_seeker_search_events: { count: null, error: missingTable } },
    }));

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json() as { searchesThisWeek: number | null; jobs: unknown[] };
    expect(body.searchesThisWeek).toBeNull();
    expect(body.jobs).toHaveLength(1);
  });

  it("omits the allowance when the column is missing, so no meter is drawn", async () => {
    useClient(stubClient({ preferences: { data: null, error: missingColumn } }));

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json() as { weeklySearchAllowance: number | null };
    expect(body.weeklySearchAllowance).toBeNull();
  });

  it("survives every optional read failing at once", async () => {
    // The state a database that has taken none of 20260828000400 is actually in.
    useClient(stubClient({
      jobsWithSaved: { data: null, error: missingColumn },
      preferences: { data: null, error: missingColumn },
      counts: {
        job_seeker_search_events: { count: null, error: missingTable },
        job_seeker_search_alerts: { count: null, error: missingTable },
      },
    }));

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json() as {
      jobs: unknown[]; savedJobsSupported: boolean;
      activeAlerts: number | null; searchesThisWeek: number | null;
      weeklySearchAllowance: number | null;
    };
    expect(body.jobs).toHaveLength(1);
    expect(body.savedJobsSupported).toBe(false);
    expect(body.activeAlerts).toBeNull();
    expect(body.searchesThisWeek).toBeNull();
    expect(body.weeklySearchAllowance).toBeNull();
  });

  it("still fails loudly when the postings themselves cannot be read", async () => {
    // Degrading is for additions. A page with no postings is not the page, and
    // a 200 with an empty list would hide a real outage.
    useClient(stubClient({
      jobsWithSaved: { data: null, error: { code: "42501", message: "permission denied" } },
      jobsBase: { data: null, error: { code: "42501", message: "permission denied" } },
    }));

    const response = await GET();

    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
