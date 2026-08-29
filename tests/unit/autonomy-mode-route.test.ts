import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization } = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));

import { GET, POST } from "@/app/api/autonomy/controls/route";

/**
 * The mode control on the safety-controls boundary.
 *
 * A mode is a preset the *server* expands, and that is the whole point worth
 * testing here: a client sends one word, and the eleven values that reach the
 * database are the ones the preset defines rather than eleven booleans the
 * caller composed. The route carries no authority of its own — the RPC is
 * still owner-only and reason-carrying — so what matters is that the
 * expansion is faithful, that no mode ever asks for merge, deploy or
 * rollback, and that a stored combination outside every preset is reported as
 * custom rather than mislabelled.
 */

const organizationId = "55555555-5555-4555-8555-555555555555";
const rpc = vi.fn();

function row(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: organizationId,
    kill_switch_active: false,
    autonomous_mode: false,
    maximum_autonomous_risk: "green",
    auto_plan: false,
    auto_code: false,
    auto_test: false,
    auto_repair: false,
    auto_review: false,
    auto_approve: false,
    auto_merge: false,
    auto_deploy: false,
    auto_rollback: false,
    ...overrides,
  };
}

function request(body: unknown, origin: string | null = "https://factory.example") {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin) headers.set("Origin", origin);
  return new Request("https://factory.example/api/autonomy/controls", {
    body: JSON.stringify(body),
    headers,
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockReturnValue({ single: async () => ({ data: row(), error: null }) });
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    client: { rpc },
  });
});

describe("POST /api/autonomy/controls with a mode", () => {
  it("expands Balanced into the build actions and nothing that accepts them", async () => {
    const response = await POST(request({ control: "mode", mode: "balanced" }));
    expect(response.status).toBe(200);

    const [name, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe("set_organization_autonomy_controls");
    expect(args.p_organization_id).toBe(organizationId);
    expect(args.p_autonomous_mode).toBe(true);
    expect(args.p_maximum_autonomous_risk).toBe("green");
    expect(args.p_auto_code).toBe(true);
    expect(args.p_auto_test).toBe(true);
    expect(args.p_auto_review).toBe(true);
    expect(args.p_auto_approve).toBe(false);
  });

  it("expands Autonomous up to approval, and no further", async () => {
    await POST(request({ control: "mode", mode: "autonomous" }));
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args.p_auto_approve).toBe(true);
    expect(args.p_maximum_autonomous_risk).toBe("yellow");
    expect(args.p_auto_merge).toBe(false);
    expect(args.p_auto_deploy).toBe(false);
    expect(args.p_auto_rollback).toBe(false);
  });

  it("turns everything off for Ask Me", async () => {
    await POST(request({ control: "mode", mode: "ask_me" }));
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args.p_autonomous_mode).toBe(false);
    for (const key of [
      "p_auto_plan",
      "p_auto_code",
      "p_auto_test",
      "p_auto_repair",
      "p_auto_review",
      "p_auto_approve",
      "p_auto_merge",
      "p_auto_deploy",
      "p_auto_rollback",
    ]) {
      expect(args[key], key).toBe(false);
    }
  });

  /*
   * The rule AGENTS.md sets and the goal repeats: a preset is a default, not
   * the explicit configuration that authorises a release. No mode may ask the
   * database for one.
   */
  it("never asks the database to enable merge, deploy or rollback", async () => {
    for (const mode of ["ask_me", "balanced", "autonomous"] as const) {
      rpc.mockClear();
      await POST(request({ control: "mode", mode }));
      const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
      expect(args.p_auto_merge, mode).toBe(false);
      expect(args.p_auto_deploy, mode).toBe(false);
      expect(args.p_auto_rollback, mode).toBe(false);
    }
  });

  it("carries the operator's reason to the audited function", async () => {
    await POST(request({ control: "mode", mode: "balanced", reason: "starting the build" }));
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args.p_reason).toBe("starting the build");
  });

  it("refuses a mode it does not define", async () => {
    const response = await POST(request({ control: "mode", mode: "full_send" }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a mode change from another origin", async () => {
    const response = await POST(
      request({ control: "mode", mode: "autonomous" }, "https://attacker.example"),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("GET /api/autonomy/controls names the active mode", () => {
  it("reports the mode a stored combination corresponds to", async () => {
    rpc.mockReturnValue({
      single: async () => ({
        data: row({
          autonomous_mode: true,
          auto_plan: true,
          auto_code: true,
          auto_test: true,
          auto_repair: true,
          auto_review: true,
        }),
        error: null,
      }),
    });
    const body = (await (await GET()).json()) as { controls: { mode: string | null } };
    expect(body.controls.mode).toBe("balanced");
  });

  it("reports a hand-widened configuration as custom, not as a mode", async () => {
    rpc.mockReturnValue({
      single: async () => ({
        data: row({
          autonomous_mode: true,
          auto_plan: true,
          auto_code: true,
          auto_test: true,
          auto_repair: true,
          auto_review: true,
          auto_deploy: true,
        }),
        error: null,
      }),
    });
    const body = (await (await GET()).json()) as { controls: { mode: string | null } };
    expect(body.controls.mode).toBeNull();
  });

  it("reports a fresh organization as Ask Me", async () => {
    const body = (await (await GET()).json()) as { controls: { mode: string | null } };
    expect(body.controls.mode).toBe("ask_me");
  });
});
