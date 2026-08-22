// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { BOT_PROVIDERS } from "@/lib/bots/catalog";
import { listSelectableCredentialRefs, normalizeCredentialRef } from "@/lib/bots/credentials";

/**
 * The allowlist is built from the catalogue, so it must admit everything the
 * catalogue declares.
 *
 * It was built from `defaultCredentialRef` alone. The catalogue's other
 * reference field, `subscriptionCredentialRef`, names exactly the two
 * variables the account-login path uses — and the product recommends that path
 * over API keys. A bot created from a connected subscription account therefore
 * carried a reference its own allowlist rejected: permanently "Needs
 * credential", disabled in the assignment wizard, and the AI Factory's Assign
 * Bots step unreachable by that route.
 */
describe("every credential reference the catalogue declares is usable", () => {
  const declared = BOT_PROVIDERS.flatMap((provider) => [
    { provider: provider.id, field: "defaultCredentialRef", ref: provider.defaultCredentialRef },
    { provider: provider.id, field: "subscriptionCredentialRef", ref: provider.subscriptionCredentialRef },
  ]).flatMap((entry) => (entry.ref ? [{ ...entry, ref: entry.ref }] : []));

  it("declares at least one subscription reference, or this test proves nothing", () => {
    expect(declared.filter((entry) => entry.field === "subscriptionCredentialRef").length)
      .toBeGreaterThan(0);
  });

  it.each(declared)("accepts $provider's $field ($ref)", ({ ref }) => {
    expect(() => normalizeCredentialRef(ref)).not.toThrow();
    expect(listSelectableCredentialRefs()).toContain(ref);
  });

  it("still refuses a reference the catalogue does not declare", () => {
    // The allowlist widening must not become "anything goes".
    expect(() => normalizeCredentialRef("SOME_OTHER_SERVICE_TOKEN")).toThrow();
  });

  it("still refuses a control-plane credential", () => {
    expect(() => normalizeCredentialRef("SUPABASE_SERVICE_ROLE_KEY")).toThrow();
  });
});
