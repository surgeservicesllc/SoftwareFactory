// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  captureUsageForAccounts,
  parseAnthropicUsage,
  probeAccountUsage,
  probeAnthropicUsage,
  type UsageRecorder,
} from "@/lib/worker/usage-probe";

/**
 * The usage probe's truthfulness contract: a number is stored only when the
 * provider returned it, a failure names itself, and an unproven provider says
 * "unsupported" instead of guessing. The sweep isolates accounts from each
 * other's failures and never lets a credential travel past the probe call.
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("parseAnthropicUsage", () => {
  it("maps the session and weekly windows with clamped percentages", () => {
    const result = parseAnthropicUsage({
      five_hour: { utilization: 37.25, resets_at: "2026-08-16T21:00:00Z" },
      seven_day: { utilization: 82, resets_at: "2026-08-20T00:00:00Z" },
      seven_day_opus: { utilization: 12.04 },
    });
    expect(result.status).toBe("measured");
    expect(result.windows).toEqual([
      {
        window_key: "session_5h",
        label: "Session (5h)",
        used_percent: 37.3,
        resets_at: "2026-08-16T21:00:00.000Z",
      },
      {
        window_key: "week_all_models",
        label: "Week (all models)",
        used_percent: 82,
        resets_at: "2026-08-20T00:00:00.000Z",
      },
      {
        window_key: "week_opus",
        label: "Week (Opus)",
        used_percent: 12,
        resets_at: null,
      },
    ]);
  });

  it("clamps out-of-range utilization into 0-100 instead of storing it raw", () => {
    const result = parseAnthropicUsage({
      five_hour: { utilization: 140 },
      seven_day: { utilization: -3 },
    });
    expect(result.status).toBe("measured");
    expect(result.windows.map((w) => w.used_percent)).toEqual([100, 0]);
  });

  it("reads seconds-since-epoch reset stamps", () => {
    const result = parseAnthropicUsage({
      five_hour: { utilization: 5, resets_at: 1786600800 },
    });
    expect(result.windows[0]?.resets_at).toBe(new Date(1786600800 * 1000).toISOString());
  });

  it("refuses to invent windows from an unrecognized payload", () => {
    for (const payload of [null, [], "usage", 42, { unrelated: true }, { five_hour: { utilization: "37" } }]) {
      const result = parseAnthropicUsage(payload);
      expect(result.status).toBe("unavailable");
      expect(result.windows).toHaveLength(0);
      expect(result.detail).toBeTruthy();
    }
  });
});

describe("probeAnthropicUsage", () => {
  it("sends the token as a bearer and parses a healthy payload", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer sk-ant-oat01-example");
      return jsonResponse(200, { five_hour: { utilization: 50 } });
    }) as unknown as typeof fetch;

    const result = await probeAnthropicUsage("sk-ant-oat01-example", fetchImpl);
    expect(result.status).toBe("measured");
    expect(result.windows[0]?.used_percent).toBe(50);
  });

  it("records a refused credential as unavailable, carrying only the status code", async () => {
    const fetchImpl = (async () =>
      new Response("secret-bearing provider text sk-ant-api03-realkey", { status: 401 })
    ) as unknown as typeof fetch;
    const result = await probeAnthropicUsage("sk-ant-oat01-example", fetchImpl);
    expect(result.status).toBe("unavailable");
    expect(result.detail).toBe("The provider refused the stored credential (HTTP 401).");
    expect(result.detail).not.toContain("sk-ant-api03");
  });

  it("records an unreachable endpoint as unavailable", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const result = await probeAnthropicUsage("sk-ant-oat01-example", fetchImpl);
    expect(result.status).toBe("unavailable");
    expect(result.detail).toBe("The usage endpoint could not be reached.");
  });
});

describe("probeAccountUsage", () => {
  it("says unsupported for providers with no proven usage endpoint", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await probeAccountUsage("openai", "{\"tokens\":{}}", fetchImpl);
    expect(result.status).toBe("unsupported");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("captureUsageForAccounts", () => {
  const account = {
    organizationId: "10000000-0000-4000-8000-000000000001",
    accountId: "20000000-0000-4000-8000-000000000001",
    provider: "anthropic",
    purpose: "claude",
  };

  function recorderSpy() {
    const calls: Array<Parameters<UsageRecorder["recordUsage"]>[0]> = [];
    const recorder: UsageRecorder = {
      recordUsage: async (input) => {
        calls.push(input);
      },
    };
    return { recorder, calls };
  }

  it("records a measured observation for a connected account", async () => {
    const { recorder, calls } = recorderSpy();
    const result = await captureUsageForAccounts(
      {
        listAccountsForVerification: async () => [account],
        readStoredCredential: async () => "sealed-envelope",
      },
      recorder,
      {
        open: () => "sk-ant-oat01-example",
        fetchImpl: (async () => jsonResponse(200, {
          five_hour: { utilization: 25 },
          seven_day: { utilization: 60 },
        })) as unknown as typeof fetch,
      },
    );
    expect(result).toEqual({ measured: 1, unavailable: 0, unsupported: 0, errors: 0 });
    expect(calls[0]).toMatchObject({
      organizationId: account.organizationId,
      accountId: account.accountId,
      status: "measured",
    });
    expect(calls[0]?.windows).toHaveLength(2);
  });

  it("records a missing or unopenable credential as unavailable without demoting", async () => {
    const { recorder, calls } = recorderSpy();
    const result = await captureUsageForAccounts(
      {
        listAccountsForVerification: async () => [
          account,
          { ...account, accountId: "20000000-0000-4000-8000-000000000002", purpose: "claude_2" },
        ],
        readStoredCredential: async (_org, purpose) =>
          purpose === "claude" ? null : "sealed-envelope",
      },
      recorder,
      {
        open: () => {
          throw new Error("wrong key");
        },
      },
    );
    expect(result).toEqual({ measured: 0, unavailable: 2, unsupported: 0, errors: 0 });
    expect(calls.map((call) => call.status)).toEqual(["unavailable", "unavailable"]);
  });

  it("keeps one account's recorder failure from hiding another's numbers", async () => {
    const seen: string[] = [];
    const recorder: UsageRecorder = {
      recordUsage: async (input) => {
        if (input.accountId === account.accountId) throw new Error("PGRST202");
        seen.push(input.accountId);
      },
    };
    const second = {
      ...account,
      accountId: "20000000-0000-4000-8000-000000000003",
      provider: "openai",
      purpose: "codex",
    };
    const result = await captureUsageForAccounts(
      {
        listAccountsForVerification: async () => [account, second],
        readStoredCredential: async () => "sealed-envelope",
      },
      recorder,
      {
        open: () => "{}",
        fetchImpl: (async () => jsonResponse(200, { five_hour: { utilization: 1 } })) as unknown as typeof fetch,
      },
    );
    expect(result.errors).toBe(1);
    expect(result.unsupported).toBe(1);
    expect(seen).toEqual([second.accountId]);
  });
});
