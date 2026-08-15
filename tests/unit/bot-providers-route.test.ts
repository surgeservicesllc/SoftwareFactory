// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireActiveOrganization = vi.fn();

// Only the entry point is replaced. Mocking the whole module would remove
// `SupabaseTenantError`, which the shared error handler needs to classify.
vi.mock("@/lib/supabase/tenant", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/tenant")>(
    "@/lib/supabase/tenant",
  );
  return { ...actual, requireActiveOrganization };
});

const { GET } = await import("@/app/api/bots/providers/route");

/**
 * The setup-detection endpoint exists so nobody has to remember that the Claude
 * variable is spelled `ANTHROPIC_API_KEY`. It reads secrets to answer a
 * yes/no question, which makes "what it does not return" the interesting part.
 */

beforeEach(() => {
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: "org_1", role: "owner" },
    client: {},
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

async function readProviders() {
  const response = await GET();
  const body = (await response.json()) as {
    providers: Array<Record<string, unknown>>;
  };
  return { response, body };
}

describe("what it reports", () => {
  it("reports a populated variable as ready", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-real-looking-value");
    const { body } = await readProviders();

    const claude = body.providers.find((entry) => entry.id === "anthropic");
    expect(claude).toMatchObject({
      credentialRef: "ANTHROPIC_API_KEY",
      credentialReady: true,
      label: "Claude",
    });
  });

  it("reports an unset variable as not ready", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { body } = await readProviders();

    expect(body.providers.find((entry) => entry.id === "anthropic"))
      .toMatchObject({ credentialReady: false });
  });

  it("treats a whitespace-only variable as unset", async () => {
    // A variable set to blank in a dashboard is the classic "I configured it"
    // that configures nothing.
    vi.stubEnv("ANTHROPIC_API_KEY", "   ");
    const { body } = await readProviders();

    expect(body.providers.find((entry) => entry.id === "anthropic"))
      .toMatchObject({ credentialReady: false });
  });

  it("marks a provider that needs no credential as optional rather than missing", async () => {
    const { body } = await readProviders();
    const selfHosted = body.providers.find((entry) => entry.id === "selfhosted");

    // Rendering this as "needs a key" would send someone to find a key that
    // does not exist.
    expect(selfHosted).toMatchObject({ credentialOptional: true, credentialRef: null });
  });

  it("carries the key-issuing page so setup is a link, not a hunt", async () => {
    const { body } = await readProviders();

    const claude = body.providers.find((entry) => entry.id === "anthropic");
    expect(claude?.apiKeyUrl).toMatch(/^https:\/\//);
    // A provider that issues no key must not invent a page.
    expect(body.providers.find((entry) => entry.id === "selfhosted")?.apiKeyUrl).toBeNull();
  });

  it("pre-fills a default model so nothing has to be typed", async () => {
    const { body } = await readProviders();

    expect(body.providers.find((entry) => entry.id === "anthropic")?.defaultModel)
      .toBe("claude-opus-5");
  });
});

describe("what it must never return", () => {
  it("never returns a credential value, prefix, length or hash", async () => {
    const secret = "sk-ant-super-secret-value-9876543210";
    vi.stubEnv("ANTHROPIC_API_KEY", secret);
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-also-secret-0123456789");

    const { body } = await readProviders();
    const serialized = JSON.stringify(body);

    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("sk-ant");
    expect(serialized).not.toContain("sk-openai");
    // A length narrows which key it is; a prefix identifies the account.
    // Presence is the only field, so neither can leak by accident.
    const claude = body.providers.find((entry) => entry.id === "anthropic") ?? {};
    expect(Object.keys(claude)).not.toContain("credentialValue");
    expect(Object.keys(claude)).not.toContain("credentialLength");
    expect(Object.keys(claude)).not.toContain("credentialPrefix");
  });

  it("reports readiness as a boolean, never as a truthy string", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-value");
    const { body } = await readProviders();

    expect(body.providers.find((entry) => entry.id === "anthropic")?.credentialReady)
      .toBe(true);
  });

  it("does not expose a privileged control-plane variable as a bot credential", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-value");
    const { body } = await readProviders();

    const refs = body.providers.map((entry) => entry.credentialRef);
    expect(refs).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(JSON.stringify(body)).not.toContain("service-role-value");
  });
});

describe("who may ask", () => {
  it("refuses a caller with no active organization", async () => {
    // Which providers an organization has configured is information about that
    // organization, so this is not public.
    requireActiveOrganization.mockRejectedValue(
      Object.assign(new Error("unauthorized"), { status: 401 }),
    );

    const response = await GET();
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("never caches the answer", async () => {
    const { response } = await readProviders();

    // Setup state changes the moment an operator sets a variable; a cached
    // "needs a key" would outlive the fix.
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
