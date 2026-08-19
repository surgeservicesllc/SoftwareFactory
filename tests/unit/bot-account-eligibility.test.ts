import { describe, expect, it } from "vitest";

import {
  accountCanBackABot,
  accountNeedsSignInAgain,
  whyAccountCannotBackABot,
} from "@/lib/bots/accounts";

describe("which accounts can back a bot", () => {
  it("counts an account whose last verification failed", () => {
    /*
     * The rule this pins. `mark_ai_account_needs_reauth` sets `status` and
     * `last_error` and nothing else, so the credential is still there — and a
     * bot's readiness is resolved from credential presence, which is the same
     * test the assign endpoint applies. Excluding these accounts left a
     * workspace whose accounts had all 403'd with no way to create or assign
     * anything, enforcing a rule the server does not have.
     */
    expect(accountCanBackABot("needs_reauth")).toBe(true);
    expect(accountCanBackABot("connected")).toBe(true);
  });

  it("excludes the three states that have no credential material", () => {
    expect(accountCanBackABot("pending")).toBe(false);
    expect(accountCanBackABot("disconnected")).toBe(false);
    expect(accountCanBackABot("revoked")).toBe(false);
  });

  it("treats an unknown status as unusable rather than guessing", () => {
    expect(accountCanBackABot("something_new")).toBe(false);
  });

  it("separates 'cannot' from 'can, but not yet running'", () => {
    expect(accountNeedsSignInAgain("needs_reauth")).toBe(true);
    expect(accountNeedsSignInAgain("connected")).toBe(false);
    expect(whyAccountCannotBackABot("needs_reauth")).toBeNull();
    expect(whyAccountCannotBackABot("pending")).toBe("not signed in yet");
    expect(whyAccountCannotBackABot("disconnected")).toBe("its credential was removed");
    expect(whyAccountCannotBackABot("revoked")).toBe("its credential was revoked");
  });
});
