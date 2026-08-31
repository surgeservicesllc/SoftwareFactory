import { describe, expect, it } from "vitest";

import {
  PAN_PARITY_CASES,
  PanRefused,
  cardExpiredOn,
  describeInstrument,
  expiringSoon,
  looksLikePan,
  passesLuhn,
  refusePan,
} from "../../lib/services/payment-instruments";

describe("refusing a card number in the browser", () => {
  it("catches a number however it was typed", () => {
    expect(looksLikePan("4111111111111111")).toBe(true);
    expect(looksLikePan("4111 1111 1111 1111")).toBe(true);
    expect(looksLikePan("4111-1111-1111-1111")).toBe(true);
    // Twelve digits is the shortest card number in circulation.
    expect(looksLikePan("123456789012")).toBe(true);
  });

  it("leaves ordinary text alone", () => {
    expect(looksLikePan("M. Vance")).toBe(false);
    expect(looksLikePan("Visa")).toBe(false);
    expect(looksLikePan("4242")).toBe(false);
    expect(looksLikePan("12345678901")).toBe(false);
    expect(looksLikePan(null)).toBe(false);
    expect(looksLikePan(undefined)).toBe(false);
  });

  it("uses Luhn to sharpen the message, never to decide", () => {
    expect(passesLuhn("4111111111111111")).toBe(true);
    expect(passesLuhn("4111111111111112")).toBe(false);
    // Refused either way — the blunt rule decides, matching the database.
    expect(() => refusePan("The name on the card", "4111111111111112")).toThrow(PanRefused);
    expect(() => refusePan("The name on the card", "4111111111111111"))
      .toThrow(/looks like a card number/i);
    expect(() => refusePan("The reference", "4111111111111112"))
      .toThrow(/cannot contain a long run of digits/i);
  });

  it("lets a legitimate value through untouched", () => {
    expect(() => refusePan("The name on the card", "Marisol Vance")).not.toThrow();
    expect(() => refusePan("The reference", "ch_3Abc0Def0Ghi")).not.toThrow();
  });
});

describe("how an instrument reads and when it dies", () => {
  const card = {
    kind: "card" as const,
    displayBrand: "Visa",
    lastFour: "4242",
    expiresMonth: 6,
    expiresYear: 2026,
  };

  it("describes a card and a bank account differently", () => {
    expect(describeInstrument(card)).toBe("Visa ending 4242, expires 06/2026");
    expect(describeInstrument({
      kind: "bank_account", displayBrand: "Cascadia Credit Union", lastFour: "0199",
    })).toBe("Cascadia Credit Union ending 0199");
  });

  it("keeps the card alive through the last day of its month", () => {
    // The off-by-one that matters: dying on the 1st cancels a month of
    // autopay that would have worked.
    expect(cardExpiredOn(card, new Date("2026-06-01T00:00:00Z"))).toBe(false);
    expect(cardExpiredOn(card, new Date("2026-06-30T23:59:59Z"))).toBe(false);
    expect(cardExpiredOn(card, new Date("2026-07-01T00:00:00Z"))).toBe(true);
  });

  it("rolls the year over correctly in December", () => {
    const december = { ...card, expiresMonth: 12, expiresYear: 2030 };
    expect(cardExpiredOn(december, new Date("2030-12-31T23:59:59Z"))).toBe(false);
    expect(cardExpiredOn(december, new Date("2031-01-01T00:00:00Z"))).toBe(true);
  });

  it("names the cards that will lapse before the next charge, not the dead ones", () => {
    const asOf = new Date("2026-05-20T00:00:00Z");
    const alreadyDead = { ...card, expiresMonth: 3, expiresYear: 2026 };
    const soon = card; // dies 2026-07-01
    const distant = { ...card, expiresMonth: 12, expiresYear: 2030 };

    const lapsing = expiringSoon([alreadyDead, soon, distant], asOf, 45);
    // An expired card is a different problem with a different message; this
    // list is the one somebody can still act on ahead of time.
    expect(lapsing).toEqual([soon]);
  });

  it("never calls a bank account expired", () => {
    expect(cardExpiredOn({
      kind: "bank_account", displayBrand: "Cascadia", lastFour: "0199",
      expiresMonth: 1, expiresYear: 2000,
    }, new Date("2026-05-20T00:00:00Z"))).toBe(false);
  });
});

describe("the shared parity table", () => {
  it("covers both answers, so the database comparison means something", () => {
    // Consumed by services-autopay.behavior, which runs every case through
    // text_has_likely_pan and requires the same answer. A table that was
    // all-true or all-false would make that comparison vacuous.
    expect(PAN_PARITY_CASES.some((value) => looksLikePan(value))).toBe(true);
    expect(PAN_PARITY_CASES.some((value) => !looksLikePan(value))).toBe(true);
    expect(PAN_PARITY_CASES.length).toBeGreaterThanOrEqual(10);
  });
});
