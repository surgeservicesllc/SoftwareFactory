import { describe, expect, it } from "vitest";

import {
  GSM_SAFE_REPLACEMENTS,
  NOTICE_PLACEHOLDERS,
  NoticeTemplateError,
  renderNoticeTemplate,
  smsCost,
  toGsmSafe,
} from "../../lib/services/notices";

describe("notice templates", () => {
  const values = {
    customer_name: "Marisol Vance",
    service_date: "Tuesday 10 March",
    arrival_window: "9am to 11am",
    company_name: "Acme Pest",
  };

  it("fills what it is given", () => {
    expect(
      renderNoticeTemplate(
        "visit_reminder",
        "Hi {{customer_name}}, {{company_name}} arrives {{service_date}}, {{arrival_window}}.",
        values,
      ),
    ).toBe("Hi Marisol Vance, Acme Pest arrives Tuesday 10 March, 9am to 11am.");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderNoticeTemplate("visit_reminder", "Hi {{ customer_name }}.", values))
      .toBe("Hi Marisol Vance.");
  });

  it("refuses a placeholder the kind does not have, and says what it may use", () => {
    expect(() =>
      renderNoticeTemplate("technician_en_route", "You owe {{amount_due}}.", {
        customer_name: "Marisol Vance", technician_name: "Ada",
        eta: "20 minutes", company_name: "Acme Pest",
      }),
    ).toThrow(/no placeholder \{\{amount_due\}\}[\s\S]*may use[\s\S]*\{\{technician_name\}\}/);
  });

  it("refuses a gap rather than sending one", () => {
    // The whole reason this function can throw: an empty substitution is
    // invisible to code and reads as "Hi , Acme Pest arrives ." to a person.
    expect(() =>
      renderNoticeTemplate("visit_reminder", "Hi {{customer_name}}, on {{service_date}}.", {
        ...values, service_date: "   ",
      }),
    ).toThrow(NoticeTemplateError);
    expect(() =>
      renderNoticeTemplate("visit_reminder", "Hi {{customer_name}}.", {}),
    ).toThrow(/would reach the customer with a gap/i);
  });

  it("names every problem at once rather than one per attempt", () => {
    expect(() =>
      renderNoticeTemplate("visit_reminder", "{{customer_name}} {{service_date}}", {}),
    ).toThrow(/\{\{customer_name\}\}, \{\{service_date\}\}/);
  });

  it("gives every kind at least a name and the company", () => {
    for (const [kind, placeholders] of Object.entries(NOTICE_PLACEHOLDERS)) {
      expect(placeholders, kind).toContain("customer_name");
      expect(placeholders, kind).toContain("company_name");
    }
  });
});

describe("what an SMS would cost", () => {
  it("counts plain text as GSM-7", () => {
    const cost = smsCost("Your quarterly service is tomorrow, 9am to 11am.");
    expect(cost.encoding).toBe("GSM-7");
    expect(cost.units).toBe(48);
    expect(cost.segments).toBe(1);
  });

  it("turns over to a second segment at 161, not 160", () => {
    expect(smsCost("a".repeat(160)).segments).toBe(1);
    expect(smsCost("a".repeat(161)).segments).toBe(2);
    // Concatenated segments carry a header, so they hold 153 each.
    expect(smsCost("a".repeat(306)).segments).toBe(2);
    expect(smsCost("a".repeat(307)).segments).toBe(3);
  });

  it("charges two septets for an escaped character", () => {
    expect(smsCost("€").units).toBe(2);
    expect(smsCost("[]").units).toBe(4);
  });

  it("names the one character that re-encodes the whole message", () => {
    // The trap: a curly apostrophe out of a word processor. Nothing looks
    // different, and every send from this template now costs triple.
    const straight = smsCost("Your technician is on the way, it's about 20 minutes.");
    const curly = smsCost("Your technician is on the way, it’s about 20 minutes.");

    expect(straight.encoding).toBe("GSM-7");
    expect(curly.encoding).toBe("UCS-2");
    expect(curly.forcedBy).toEqual(["’"]);
  });

  it("collapses the limit to 70 once it is UCS-2", () => {
    expect(smsCost("’".repeat(70)).segments).toBe(1);
    expect(smsCost("’".repeat(71)).segments).toBe(2);
    expect(smsCost("’".repeat(134)).segments).toBe(2);
    expect(smsCost("’".repeat(135)).segments).toBe(3);
  });

  it("counts an emoji as the two code units it really is", () => {
    const cost = smsCost("\u{1F41C}");
    expect(cost.encoding).toBe("UCS-2");
    expect(cost.units).toBe(2);
  });

  it("treats an empty message as one segment, not zero", () => {
    expect(smsCost("").segments).toBe(1);
  });

  it("replaces the typographic characters and leaves names alone", () => {
    expect(toGsmSafe("it’s “done” — fine…")).toBe('it\'s "done" - fine...');
    // An accented name also forces UCS-2, and rewriting it to save a
    // fraction of a penny would be the wrong trade.
    expect(toGsmSafe("Björn Škoda")).toBe("Björn Škoda");
    expect(smsCost(toGsmSafe("it’s here")).encoding).toBe("GSM-7");
  });

  it("offers a replacement for every character it claims to fix", () => {
    for (const [from, to] of Object.entries(GSM_SAFE_REPLACEMENTS)) {
      expect(smsCost(from).encoding, `${from} should need fixing`).toBe("UCS-2");
      expect(smsCost(to).encoding, `${to} should be safe`).toBe("GSM-7");
    }
  });
});
