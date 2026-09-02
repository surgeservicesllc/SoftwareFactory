import { describe, expect, it } from "vitest";

import { parseCsv, planImport } from "@/lib/services/data-import";

/**
 * The importer's promise is that it invents nothing: an unmapped column
 * stops the whole import, a required field must be mapped, every invalid
 * row is named with its reason, and a row that repeats an earlier row of
 * the same file is held back rather than doubled.
 */

describe("parseCsv", () => {
  it("reads quoted fields, escaped quotes, CRLF, and a byte-order mark", () => {
    const text = '﻿name,address\r\n"Ridgeway, Bakery","1 ""Loaf"" Lane"\r\nMaple Homes,12 Maple St\n';
    expect(parseCsv(text)).toEqual([
      ["name", "address"],
      ["Ridgeway, Bakery", '1 "Loaf" Lane'],
      ["Maple Homes", "12 Maple St"],
    ]);
  });

  it("drops blank lines and keeps empty trailing cells", () => {
    expect(parseCsv("a,b\n1,\n\n2,3")).toEqual([["a", "b"], ["1", ""], ["2", "3"]]);
  });
});

describe("planImport", () => {
  const csv = [
    "Company,Kind,Email,Phone,Service Address,First,Last,Extra",
    "Ridgeway Bakery,commercial,owner@ridgeway.example,555-0100,1 Loaf Lane,Rita,Ridge,x",
    "Maple Homes,residential,,555-0101,12 Maple St,,,y",
    "Ridgeway Bakery,commercial,other@ridgeway.example,555-0199,2 Loaf Lane,,,z",
    ",residential,nobody@example.test,,,,,w",
    "Bad Phone Ltd,commercial,,not-a-phone,,,,v",
  ].join("\n");

  const mapping = {
    Company: "account.name",
    Kind: "account.kind",
    Email: "account.email",
    Phone: "account.phone",
    "Service Address": "property.address",
    First: "contact.first_name",
    Last: "contact.last_name",
  } as const;

  it("refuses when a column is neither mapped nor ignored", () => {
    const plan = planImport(csv, mapping);
    expect(plan.unmapped).toEqual(["Extra"]);
    expect(plan.rows).toEqual([]);
  });

  it("refuses when the account name is not mapped", () => {
    const plan = planImport(csv, { ...mapping, Company: "ignore", Extra: "ignore" });
    expect(plan.missingRequired).toEqual(["account.name"]);
  });

  it("names every invalid row with its reason and holds back an in-file repeat", () => {
    const plan = planImport(csv, { ...mapping, Extra: "ignore" });
    expect(plan.unmapped).toEqual([]);
    expect(plan.rows.map((row) => row.account.name)).toEqual(["Ridgeway Bakery", "Maple Homes"]);
    expect(plan.rows[0]).toMatchObject({
      line: 2,
      account: { kind: "commercial", status: "lead", email: "owner@ridgeway.example" },
      property: { label: "Service address", address: "1 Loaf Lane" },
      contact: { first_name: "Rita", last_name: "Ridge" },
    });
    expect(plan.rows[1].contact).toBeNull();
    expect(plan.duplicatesInFile).toEqual([{ line: 4, ofLine: 2, on: "name" }]);
    expect(plan.invalid).toEqual([
      { line: 5, reason: "the account name is empty" },
      { line: 6, reason: '"not-a-phone" is not a phone number' },
    ]);
  });

  it("refuses a contact with no first name and a location label with no address", () => {
    const plan = planImport(
      "name,last,label\nAcme,Smith,Front office\n",
      { name: "account.name", last: "contact.last_name", label: "property.label" },
    );
    expect(plan.invalid[0].reason).toContain("a location label was given without an address");
    expect(plan.invalid[0].reason).toContain("a contact was given without a first name");
  });
});
