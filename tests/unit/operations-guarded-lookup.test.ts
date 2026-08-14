// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { guardedLookup, BlockedAddressError } = await import("@/lib/operations/guarded-lookup");

/**
 * The lookup runs against the real system resolver. `localhost` resolving to a
 * loopback address is the one DNS fact that holds on every machine this could
 * run on, which is what makes it usable as a real assertion rather than a mock.
 */

function lookupOnce(hostname: string, options: Record<string, unknown> = {}) {
  return new Promise<{ error: Error | null; address: unknown }>((resolve) => {
    guardedLookup(hostname, options, (error, address) => resolve({ error, address }));
  });
}

describe("guarded DNS lookup", () => {
  it("refuses a name that resolves to loopback", async () => {
    const { error } = await lookupOnce("localhost");
    expect(error).toBeInstanceOf(BlockedAddressError);
    expect((error as NodeJS.ErrnoException).code).toBe("EBLOCKEDADDRESS");
    // The message names the address, so an operator can see what it resolved to
    // rather than guessing why the monitor will not run.
    expect(error?.message).toMatch(/localhost resolved to/);
    expect(error?.message).toMatch(/loopback/i);
  });

  it("returns an address for a public name", async () => {
    const { error, address } = await lookupOnce("example.com");
    if (error) {
      // No outbound DNS in this environment is a legitimate outcome; it must
      // not be a blocked-address failure, which would be a real defect.
      expect(error).not.toBeInstanceOf(BlockedAddressError);
      return;
    }
    expect(typeof address).toBe("string");
    expect(address).not.toBe("");
  });

  it("reports a name that does not resolve as not found, not as blocked", async () => {
    const { error } = await lookupOnce("this-name-should-not-exist.invalid");
    expect(error).not.toBeNull();
    expect(error).not.toBeInstanceOf(BlockedAddressError);
  });

  it("checks every answer even when the caller asked for one", async () => {
    // `all: false` must not mean "check only the first". The implementation
    // always resolves with `all` and inspects the whole set.
    const { error } = await lookupOnce("localhost", { all: false });
    expect(error).toBeInstanceOf(BlockedAddressError);
  });

  it("accepts the numeric-family calling convention", async () => {
    const { error } = await new Promise<{ error: Error | null }>((resolve) => {
      guardedLookup("localhost", 4, (lookupError) => resolve({ error: lookupError }));
    });
    expect(error).toBeInstanceOf(BlockedAddressError);
  });
});
