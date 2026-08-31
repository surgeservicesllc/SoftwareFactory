/**
 * Transactional service notices — the browser-side half (ADR-217).
 *
 * The database decides whether a notice may be composed and whether it may
 * ever be recorded as sent. What is left over, and what this file is for,
 * is the part a person actually reads: turning a stored template into the
 * words a customer receives, and saying honestly what sending them would
 * cost.
 *
 * Both halves exist because both have a failure mode that looks fine in
 * code and wrong on a phone.
 */

export type NoticeKind =
  | "visit_reminder"
  | "visit_confirmation"
  | "technician_en_route"
  | "visit_completed"
  | "invoice_due"
  | "invoice_overdue"
  | "plan_renewal";

export type NoticeChannel = "email" | "sms";

/**
 * Which placeholders each kind of notice may use.
 *
 * Deliberately per-kind rather than one shared list: `{{amount_due}}` has
 * no meaning in an en-route text, and a template that uses it there is a
 * mistake worth catching when the template is written rather than when
 * three hundred customers receive the word "undefined".
 */
export const NOTICE_PLACEHOLDERS: Readonly<Record<NoticeKind, readonly string[]>> = {
  visit_reminder: ["customer_name", "service_date", "arrival_window", "company_name"],
  visit_confirmation: ["customer_name", "service_date", "arrival_window", "company_name"],
  technician_en_route: ["customer_name", "technician_name", "eta", "company_name"],
  visit_completed: ["customer_name", "service_date", "technician_name", "company_name"],
  invoice_due: ["customer_name", "invoice_number", "amount_due", "due_date", "company_name"],
  invoice_overdue: [
    "customer_name", "invoice_number", "amount_due", "due_date", "days_overdue", "company_name",
  ],
  plan_renewal: ["customer_name", "plan_name", "renewal_date", "company_name"],
};

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

export class NoticeTemplateError extends Error {}

/**
 * Fill a template, or refuse.
 *
 * THE POINT OF THE REFUSALS: the default behaviour of every naive
 * substitution — leave unknown placeholders alone, replace missing values
 * with an empty string — produces a message that is syntactically perfect
 * and reads, to the customer, as "Hello , your visit is on ." Code cannot
 * tell that apart from success, so the only place to catch it is here, at
 * the moment the template is used.
 */
export function renderNoticeTemplate(
  kind: NoticeKind,
  template: string,
  values: Readonly<Record<string, string | undefined>>,
): string {
  const allowed = new Set(NOTICE_PLACEHOLDERS[kind]);
  const unknown: string[] = [];
  const missing: string[] = [];

  const rendered = template.replace(PLACEHOLDER, (_match, name: string) => {
    if (!allowed.has(name)) {
      unknown.push(name);
      return "";
    }
    const value = values[name];
    if (value === undefined || value.trim() === "") {
      missing.push(name);
      return "";
    }
    return value;
  });

  if (unknown.length > 0) {
    throw new NoticeTemplateError(
      `A ${kind} notice has no ${unknown.length === 1 ? "placeholder" : "placeholders"} `
      + `${[...new Set(unknown)].map((name) => `{{${name}}}`).join(", ")}. `
      + `It may use: ${NOTICE_PLACEHOLDERS[kind].map((name) => `{{${name}}}`).join(", ")}.`,
    );
  }
  if (missing.length > 0) {
    throw new NoticeTemplateError(
      `Nothing was supplied for ${[...new Set(missing)].map((name) => `{{${name}}}`).join(", ")}, `
      + `so this notice would reach the customer with a gap where that should be. `
      + `Supply the value or change the template.`,
    );
  }

  return rendered;
}

/**
 * The GSM 03.38 basic alphabet — one septet each.
 */
const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?"
  + "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);

/**
 * Characters GSM can carry, but only as an escape pair — two septets each.
 */
const GSM_EXTENDED = new Set("^{}\\[~]|€");

export type SmsEncoding = "GSM-7" | "UCS-2";

export interface SmsCost {
  encoding: SmsEncoding;
  /** Septets for GSM-7, UTF-16 code units for UCS-2. */
  units: number;
  segments: number;
  /** The characters that forced UCS-2, if any. Empty for a GSM-7 message. */
  forcedBy: readonly string[];
}

/**
 * What an SMS would actually cost to send.
 *
 * THE TRAP THIS EXISTS FOR: a single character outside the GSM alphabet
 * re-encodes the WHOLE message as UCS-2, and the segment limit collapses
 * from 160 characters to 70. One curly apostrophe pasted out of a word
 * processor — the kind every template picks up eventually — can therefore
 * turn a one-segment reminder into a three-segment one, tripling the cost
 * of every send for the life of the template, with nothing on screen
 * looking any different.
 *
 * So the offending characters are named, not just counted.
 */
export function smsCost(text: string): SmsCost {
  const forcedBy: string[] = [];
  let septets = 0;

  for (const character of text) {
    if (GSM_BASIC.has(character)) {
      septets += 1;
    } else if (GSM_EXTENDED.has(character)) {
      septets += 2;
    } else if (!forcedBy.includes(character)) {
      forcedBy.push(character);
    }
  }

  if (forcedBy.length > 0) {
    // UCS-2 counts UTF-16 code units, so an emoji outside the BMP is two.
    const units = [...text].reduce(
      (total, character) => total + (character.codePointAt(0)! > 0xffff ? 2 : 1),
      0,
    );
    return {
      encoding: "UCS-2",
      units,
      // 70 in a single segment; 67 each once a header is needed.
      segments: units === 0 ? 1 : units <= 70 ? 1 : Math.ceil(units / 67),
      forcedBy,
    };
  }

  return {
    encoding: "GSM-7",
    units: septets,
    // 160 in a single segment; 153 each once a header is needed.
    segments: septets === 0 ? 1 : septets <= 160 ? 1 : Math.ceil(septets / 153),
    forcedBy: [],
  };
}

/**
 * The characters a word processor substitutes, and what to use instead.
 * Every one of these is invisible at a glance and doubles the cost of a
 * text message.
 */
export const GSM_SAFE_REPLACEMENTS: Readonly<Record<string, string>> = {
  "‘": "'", "’": "'", "“": '"', "”": '"',
  "–": "-", "—": "-", "…": "...", " ": " ",
};

/**
 * Replace the typographic characters that force UCS-2, and leave
 * everything else alone.
 *
 * This is offered, never applied automatically: an accented name is also
 * outside GSM in places, and silently rewriting somebody's name to save a
 * fraction of a penny would be the wrong trade.
 */
export function toGsmSafe(text: string): string {
  return [...text]
    .map((character) => GSM_SAFE_REPLACEMENTS[character] ?? character)
    .join("");
}
