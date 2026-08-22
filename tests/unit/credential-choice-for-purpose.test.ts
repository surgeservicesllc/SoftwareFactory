import { describe, expect, it } from "vitest";

import {
  BROKER_PROVIDERS,
  credentialChoiceForPurpose,
  purposeForSlot,
  type BrokerProviderId,
} from "@/lib/ai-accounts/purposes";

/**
 * Two vocabularies for one credential slot, and the seam between them.
 *
 * An account row names its vault slot in the broker's words -- `claude`,
 * `claude_2`, `codex_47`. `/api/bots/connect/provision` names it in the
 * catalogue's -- `subscription`, `subscription_2` -- so the environment
 * variable itself can never be chosen by the browser. The route's schema
 * rejects anything else, so a console that sends a purpose where a choice
 * belongs cannot create a bot at all.
 *
 * Measured on 2026-08-22 against a real stack: the Bot Manager's account
 * chooser sent `claude` and got `400 invalid_request`, surfacing as "The bot
 * could not be created. Try again from the accounts list." -- from the very
 * list that had just failed. This test is the seam, so the two cannot drift
 * apart again.
 */
const ROUTE_PATTERN = /^(default|subscription(?:_(?:[2-9]|[1-9][0-9]{1,3}))?)$/;

describe("credentialChoiceForPurpose", () => {
  it("translates slot 1 to the base subscription choice", () => {
    expect(credentialChoiceForPurpose("claude")).toBe("subscription");
    expect(credentialChoiceForPurpose("codex")).toBe("subscription");
  });

  it("keeps a numbered slot's number", () => {
    expect(credentialChoiceForPurpose("claude_2")).toBe("subscription_2");
    expect(credentialChoiceForPurpose("codex_47")).toBe("subscription_47");
  });

  it("falls back to slot 1 for a missing purpose", () => {
    expect(credentialChoiceForPurpose(null)).toBe("subscription");
    expect(credentialChoiceForPurpose(undefined)).toBe("subscription");
    expect(credentialChoiceForPurpose("")).toBe("subscription");
  });

  it("answers something the provisioning route accepts for every real slot", () => {
    for (const providerId of Object.keys(BROKER_PROVIDERS) as BrokerProviderId[]) {
      for (let slot = 0; slot < 60; slot += 1) {
        const purpose = purposeForSlot(providerId, slot);
        const choice = credentialChoiceForPurpose(purpose);
        expect(ROUTE_PATTERN.test(choice), `${purpose} -> ${choice}`).toBe(true);
      }
    }
  });

  it("shows why the purpose itself cannot be sent", () => {
    // The regression this seam exists to prevent, stated as the route sees it.
    expect(ROUTE_PATTERN.test("claude")).toBe(false);
    expect(ROUTE_PATTERN.test("claude_2")).toBe(false);
  });
});
