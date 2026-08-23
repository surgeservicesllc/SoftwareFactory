// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The one field the AI Factory's Assign and Configure steps fail closed on.
 *
 * `AiFactoryConsole` reads `botsBody.assignmentsComplete === true` and uses it
 * in both `done` derivations: step 6 is `assignmentsComplete &&
 * routedAssignments.length > 0`, and step 7's `allScopedAssignmentsConfigured`
 * requires it too. That is deliberate — a truncated projection can carry
 * plausible assignment rows, and completing a step from them would state a
 * roster the server never confirmed.
 *
 * The consequence is that this key is load-bearing in a way its neighbours are
 * not. Rename it, drop it, or let it fall out of the spread, and the console
 * reads `undefined`, `=== true` yields false, and **steps 6 and 7 can never be
 * completed by any user action**. The page shows "Assignment roster is
 * incomplete · reload before trusting this step" forever.
 *
 * Nothing pinned it at the HTTP boundary. `bot-service.test.ts` asserts
 * `snapshot.assignmentsComplete`, which is one layer down — the route maps
 * that onto its own output key separately, and the console never sees the
 * snapshot. So the rename that breaks the journey is exactly the one the
 * existing tests cannot see.
 */

const requireActiveOrganization = vi.fn();
const loadBotFabric = vi.fn();

vi.mock("@/lib/supabase/tenant", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/tenant")>(
    "@/lib/supabase/tenant",
  );
  return { ...actual, requireActiveOrganization };
});

vi.mock("@/lib/bots/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/bots/service")>(
    "@/lib/bots/service",
  );
  return { ...actual, loadBotFabric };
});

const { GET } = await import("@/app/api/bots/route");

function snapshot(assignmentsComplete: unknown) {
  return {
    bots: [],
    roles: [],
    assignments: [],
    accounts: [],
    assignmentsComplete,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: "11111111-1111-4111-8111-111111111111", role: "owner" },
    client: {},
  });
});

describe("GET /api/bots — the assignment completeness contract", () => {
  it("emits assignmentsComplete under exactly that name", async () => {
    loadBotFabric.mockResolvedValue(snapshot(true));

    const body = (await (await GET()).json()) as Record<string, unknown>;

    // The name itself, because the console reads this exact key.
    expect(Object.keys(body)).toContain("assignmentsComplete");
    expect(body.assignmentsComplete).toBe(true);
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["the string \"true\"", "true"],
    ["1", 1],
  ])("reports %s as not complete rather than as truthy", async (_label, value) => {
    /*
     * `=== true` at the boundary, not coercion. A rolling deployment can serve
     * an older shape, and every one of these values would satisfy a truthiness
     * check while proving nothing about the roster.
     */
    loadBotFabric.mockResolvedValue(snapshot(value));

    const body = (await (await GET()).json()) as Record<string, unknown>;

    expect(body.assignmentsComplete).toBe(false);
  });

  it("keeps the key present even when the snapshot omits it entirely", async () => {
    // The spread cannot supply what the snapshot does not have, so the
    // explicit line after it is what guarantees the key exists at all.
    const { assignmentsComplete: _omitted, ...withoutTheField } = snapshot(true);
    loadBotFabric.mockResolvedValue(withoutTheField);

    const body = (await (await GET()).json()) as Record<string, unknown>;

    expect(Object.keys(body)).toContain("assignmentsComplete");
    expect(body.assignmentsComplete).toBe(false);
  });
});
