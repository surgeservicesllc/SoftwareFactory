/**
 * Stored payment instruments — the browser-side half (ADR-218).
 *
 * The schema refuses a card number in any field a person types into. This
 * file refuses it EARLIER, and the difference is not redundancy: a PAN
 * caught here never crosses the network, never reaches a request log, a
 * proxy trace or an error report. The constraint keeps it out of the
 * database; this keeps it out of everything on the way there.
 */

/**
 * The same rule the database enforces: any run of 12 to 19 digits once the
 * spaces and dashes people type between groups are removed.
 *
 * Deliberately identical to `text_has_likely_pan`, and pinned to it by a
 * parity test. A browser check that is STRICTER would refuse values the
 * database accepts, which is merely annoying; one that is LOOSER would
 * wave a card number through to a server round-trip, which is the thing
 * this exists to prevent. Neither is acceptable, so they match.
 */
export function looksLikePan(text: string | null | undefined): boolean {
  if (text === null || text === undefined) return false;
  return /[0-9]{12,19}/.test(text.replace(/[ -]/g, ""));
}

/**
 * Whether a digit string satisfies the Luhn checksum.
 *
 * Not used to decide whether to REFUSE — the refusal is the blunt rule
 * above, matching the database. This only sharpens the message: a Luhn-
 * valid run is almost certainly a real card, and telling somebody that is
 * more useful than "too many digits".
 */
export function passesLuhn(text: string): boolean {
  const digits = text.replace(/[^0-9]/g, "");
  if (digits.length < 12 || digits.length > 19) return false;

  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = digits.charCodeAt(index) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

export class PanRefused extends Error {}

/**
 * Guard a field before it is sent. Throws rather than returning a flag,
 * because the one thing that must not happen is a caller forgetting to
 * check the result.
 */
export function refusePan(fieldLabel: string, value: string | null | undefined): void {
  if (!looksLikePan(value)) return;
  const likely = passesLuhn(value ?? "");
  throw new PanRefused(
    likely
      ? `That looks like a card number, and ${fieldLabel} is stored in plain text. `
        + `Card numbers are held by the payment provider, never here — enter only the `
        + `last four digits.`
      : `${fieldLabel} cannot contain a long run of digits, because a card number `
        + `would be indistinguishable from one. If this is a reference, shorten it or `
        + `break it up.`,
  );
}

export type InstrumentKind = "card" | "bank_account";

export interface Instrument {
  kind: InstrumentKind;
  displayBrand: string;
  lastFour: string;
  expiresMonth?: number | null;
  expiresYear?: number | null;
}

/** How an instrument reads on screen. */
export function describeInstrument(instrument: Instrument): string {
  const tail = `${instrument.displayBrand} ending ${instrument.lastFour}`;
  if (instrument.kind !== "card") return tail;
  if (
    instrument.expiresMonth === null || instrument.expiresMonth === undefined
    || instrument.expiresYear === null || instrument.expiresYear === undefined
  ) {
    return tail;
  }
  return `${tail}, expires ${String(instrument.expiresMonth).padStart(2, "0")}/${instrument.expiresYear}`;
}

/**
 * A card is good through the LAST day of its expiry month, not the first.
 *
 * Off-by-one here is not cosmetic: treating a card as dead on the 1st
 * cancels a month of autopay that would have worked, and treating it as
 * alive in the following month schedules a charge that is certain to
 * fail. Both are visible to the customer.
 */
export function cardExpiredOn(instrument: Instrument, asOf: Date): boolean {
  if (instrument.kind !== "card") return false;
  const month = instrument.expiresMonth;
  const year = instrument.expiresYear;
  if (month === null || month === undefined || year === null || year === undefined) return false;

  // The first instant of the month AFTER the expiry month, in UTC.
  const deadAt = Date.UTC(year + (month === 12 ? 1 : 0), month === 12 ? 0 : month, 1);
  return asOf.getTime() >= deadAt;
}

/**
 * Cards that will lapse within `days`, so somebody can ask for a new one
 * BEFORE a charge fails.
 *
 * A failed autopay costs a payment cycle and a phone call; an expiring
 * card is knowable weeks ahead, which is the whole reason to store the
 * expiry rather than only the last four.
 */
export function expiringSoon<T extends Instrument>(
  instruments: readonly T[],
  asOf: Date,
  days = 45,
): T[] {
  const horizon = new Date(asOf.getTime() + days * 24 * 60 * 60 * 1000);
  return instruments.filter(
    (instrument) => !cardExpiredOn(instrument, asOf) && cardExpiredOn(instrument, horizon),
  );
}

/**
 * The values `looksLikePan` and the database's `text_has_likely_pan` must
 * agree about, exported so the behaviour suite can run both over the same
 * table and compare.
 *
 * A browser rule that has drifted from the schema is worse than no browser
 * rule: it either refuses what the database would accept, or — the one
 * that matters — lets a card number reach the wire believing the server
 * will catch it.
 */
export const PAN_PARITY_CASES: readonly string[] = [
  "4111111111111111",
  "4111 1111 1111 1111",
  "4111-1111-1111-1111",
  "5500 0000 0000 0004",
  "123456789012",
  "12345678901",
  "4242",
  "M. Vance",
  "Visa",
  "Cascadia Credit Union",
  "ch_3Abc0Def0Ghi",
  "Invoice 2026-03 ref 88213",
  "  4111111111111111  ",
  "card ending 4242 expires 12/2030",
];
