// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization } = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
}));
const { requireAuthenticatedUser } = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));
vi.mock("@/lib/supabase/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/auth")>()),
  requireAuthenticatedUser,
}));

import { GET as listWdo, POST as createWdo } from "@/app/api/services/wdo/route";
import { PATCH as patchWdo } from "@/app/api/services/wdo/[inspectionId]/route";
import { GET as listFindings } from "@/app/api/services/wdo/[inspectionId]/findings/route";
import { GET as portalWdo } from "@/app/api/customer-portal/wdo/route";

/**
 * The WDO boundary.
 *
 * The behavior suite proves the database refuses a report that contradicts
 * its own findings. This file pins what the ROUTES must not undo: the
 * refusal has to reach the inspector as the database's own sentence, a
 * workspace with no reports must not render as a page of zeroes, and
 * `visibleEvidence` must have no default anywhere on the way in.
 */

const organizationId = "10000000-0000-4000-8000-0000000f0001";
const userId = "00000000-0000-4000-8000-0000000f0001";
const inspectionId = "20000000-0000-4000-8000-0000000f0001";

let rpc: ReturnType<typeof vi.fn>;
let from: ReturnType<typeof vi.fn>;

function table(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "insert", "update"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (value: unknown) => unknown) => resolve(result);
  return builder;
}

function client(options: {
  rows?: unknown[];
  single?: { data: unknown; error: unknown };
  rpcBook?: Record<string, { data: unknown; error: unknown }>;
}) {
  const result = options.single ?? { data: options.rows ?? [], error: null };
  from = vi.fn(() => table(result));
  rpc = vi.fn((name: string) =>
    Promise.resolve(options.rpcBook?.[name] ?? { data: [], error: null }),
  );
  const supabase = { from, rpc };
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    user: { id: userId },
    client: supabase,
  });
  requireAuthenticatedUser.mockResolvedValue({ user: { id: userId }, client: supabase });
}

const params = { params: Promise.resolve({ inspectionId }) };

function post(body: unknown, path = "https://factory.example/api/services/wdo") {
  return new Request(path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://factory.example" },
    body: JSON.stringify(body),
  });
}

function patch(body: unknown) {
  return new Request(`https://factory.example/api/services/wdo/${inspectionId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: "https://factory.example" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the WDO routes", () => {
  it("returns a null summary for a workspace that has inspected nothing", async () => {
    client({ rows: [], rpcBook: { crm_wdo_summary: { data: [], error: null } } });
    const body = (await (
      await listWdo(new Request("https://factory.example/api/services/wdo"))
    ).json()) as { summary: unknown; inspections: unknown[]; storage: { connected: boolean } };

    // Not a row of zeroes. "We inspected nothing and found nothing" is a
    // different claim from "nobody has inspected anything yet", and the
    // page has to be able to say the second one.
    expect(body.summary).toBeNull();
    expect(body.inspections).toEqual([]);
    // And uploading a plan is labelled, never implied.
    expect(body.storage.connected).toBe(false);
  });

  it("keeps a draft out of both the evidence and the clean column", async () => {
    client({
      rows: [],
      rpcBook: {
        crm_wdo_summary: {
          data: [
            {
              inspections: 6,
              issued: 4,
              drafts: 2,
              with_evidence: 2,
              clean: 2,
              reports_with_obstructions: 1,
              findings: 9,
              unplaced_findings: 3,
              latest_inspected_on: "2026-08-30",
            },
          ],
          error: null,
        },
      },
    });
    const body = (await (
      await listWdo(new Request("https://factory.example/api/services/wdo"))
    ).json()) as { summary: Record<string, number> };

    expect(body.summary.withEvidence + body.summary.clean).toBe(body.summary.issued);
    expect(body.summary.drafts).toBe(2);
    expect(body.summary.unplacedFindings).toBe(3);
  });

  it("will not take a report that has not answered the headline question", async () => {
    client({ single: { data: null, error: null } });
    const response = await createWdo(
      post({
        accountId: "30000000-0000-4000-8000-0000000f0001",
        propertyId: "40000000-0000-4000-8000-0000000f0001",
        inspectorTechnicianId: "50000000-0000-4000-8000-0000000f0001",
        reportNumber: "WDO-2001",
        structuresInspected: "Main dwelling",
        // visibleEvidence deliberately absent — there is no default, here
        // or in the schema. A default would be this route answering a
        // legal question on the inspector's behalf.
      }),
    );
    expect(response.status).toBe(422);
    expect(from).not.toHaveBeenCalled();
  });

  it("hands the database's contradiction refusal back as the inspector's answer", async () => {
    client({
      rpcBook: {
        crm_wdo_issue_report: {
          data: null,
          error: {
            code: "23514",
            message:
              "this report says no visible evidence was observed while 1 adverse finding(s) are recorded against it",
          },
        },
      },
    });
    const response = await patchWdo(patch({ action: "issue" }), params);
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("report_contradicts_findings");
    // The database's own sentence says exactly what is wrong. Flattening it
    // into "something went wrong" throws away the only useful part.
    expect(body.error.message).toMatch(/no visible evidence was observed while 1 adverse finding/);
  });

  it("answers 409, not 500, when the report is already issued", async () => {
    client({
      rpcBook: {
        crm_wdo_issue_report: {
          data: null,
          error: { code: "55000", message: "report WDO-1003 was already issued on 2026-08-30" },
        },
      },
    });
    const response = await patchWdo(patch({ action: "issue" }), params);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("report_already_issued");
  });

  it("refuses to let the route set status or issued_at as if they were fields", async () => {
    client({ single: { data: null, error: null } });
    for (const forbidden of [{ status: "issued" }, { issuedAt: "2026-08-30T00:00:00Z" }]) {
      const response = await patchWdo(patch(forbidden), params);
      // Issuing runs a check across two tables. It is an action, not a
      // column somebody can write.
      expect(response.status).toBe(422);
    }
  });

  it("counts what the diagram cannot draw, and uses the database's own adverse set", async () => {
    client({
      rows: [
        {
          id: "60000000-0000-4000-8000-0000000f0001",
          inspection_id: inspectionId,
          kind: "live_infestation",
          organism: "Eastern subterranean termite",
          area: "Crawlspace",
          position_x: "0.3125",
          position_y: "0.7500",
          note: null,
          treatment_note: null,
          created_at: "2026-08-30T00:00:00Z",
          updated_at: "2026-08-30T00:00:00Z",
        },
        {
          id: "60000000-0000-4000-8000-0000000f0002",
          inspection_id: inspectionId,
          kind: "conducive_condition",
          organism: null,
          area: "South foundation",
          position_x: null,
          position_y: null,
          note: null,
          treatment_note: null,
          created_at: "2026-08-30T00:00:00Z",
          updated_at: "2026-08-30T00:00:00Z",
        },
      ],
    });
    const body = (await (
      await listFindings(new Request("https://factory.example/x"), params)
    ).json()) as {
      findings: { placed: boolean; adverse: boolean; positionX: number | null }[];
      counts: Record<string, number>;
    };

    expect(body.counts.total).toBe(2);
    // A conducive condition is worth recording and is NOT evidence of an
    // organism, so it must not count as adverse or an honest clean report
    // becomes unissuable.
    expect(body.counts.adverse).toBe(1);
    expect(body.counts.placed).toBe(1);
    expect(body.counts.unplaced).toBe(1);
    expect(body.findings[0].positionX).toBeCloseTo(0.3125, 4);
    expect(body.findings[1].placed).toBe(false);
    expect(body.findings[1].adverse).toBe(false);
  });

  it("gives the customer issued reports and counts the ones that name a limitation", async () => {
    client({
      rpcBook: {
        crm_portal_me: {
          data: [
            {
              organization_id: organizationId,
              account_id: "30000000-0000-4000-8000-0000000f0001",
              portal_user_id: "70000000-0000-4000-8000-0000000f0001",
              role: "viewer",
            },
          ],
          error: null,
        },
        crm_portal_wdo_reports: {
          data: [
            {
              id: inspectionId,
              report_number: "WDO-1003",
              property_id: "40000000-0000-4000-8000-0000000f0001",
              property_label: "Harborview Plant",
              inspected_on: "2026-08-30",
              issued_at: "2026-08-30T00:00:00Z",
              structures_inspected: "Main dwelling",
              visible_evidence: false,
              obstructions: "Stored pallets against the south wall.",
              inaccessible_areas: null,
              recommendation: null,
              findings: 1,
              superseded: true,
            },
            {
              id: "20000000-0000-4000-8000-0000000f0002",
              report_number: "WDO-1001",
              property_id: "40000000-0000-4000-8000-0000000f0001",
              property_label: "Harborview Plant",
              inspected_on: "2026-08-20",
              issued_at: "2026-08-20T00:00:00Z",
              structures_inspected: "Main dwelling",
              visible_evidence: true,
              obstructions: null,
              inaccessible_areas: null,
              recommendation: "Treat the north dock line.",
              findings: 2,
              superseded: false,
            },
          ],
          error: null,
        },
      },
    });

    const body = (await (
      await portalWdo(new Request("https://factory.example/api/customer-portal/wdo"))
    ).json()) as { reports: { superseded: boolean }[]; counts: Record<string, number> };

    expect(body.counts.total).toBe(2);
    expect(body.counts.withEvidence).toBe(1);
    expect(body.counts.clean).toBe(1);
    // A customer reading the older report needs to know a newer one
    // replaced it.
    expect(body.counts.superseded).toBe(1);
    // The number a buyer's surveyor asks about first.
    expect(body.counts.withLimitations).toBe(1);
    expect(body.reports[0].superseded).toBe(true);
  });

  it("gives a caller with no portal link nothing", async () => {
    client({ rpcBook: { crm_portal_me: { data: [], error: null } } });
    const response = await portalWdo(
      new Request("https://factory.example/api/customer-portal/wdo"),
    );
    expect(response.status).toBe(403);
  });
});
