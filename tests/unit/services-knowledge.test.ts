import { describe, expect, it } from "vitest";

import { buildCalendar, calendarEnd, calendarFilename, calendarMoment, escapeText, foldLine } from "@/lib/services/ics";
import { composeKnowledgeAnswer, explainRank, slugify, toKbSearchHit } from "@/lib/services/knowledge";

describe("the calendar file", () => {
  it("escapes the five characters, folds at 75 octets, and prints moments in UTC", () => {
    expect(escapeText("Plant; 1 Loaf Lane, Harbor\nCity \\ end")).toBe("Plant\\; 1 Loaf Lane\\, Harbor\\nCity \\\\ end");
    expect(calendarMoment("2026-10-05T14:00:00.000Z")).toBe("20261005T140000Z");
    expect(calendarMoment("2026-10-05T09:00:00-05:00")).toBe("20261005T140000Z");
    const long = `DESCRIPTION:${"x".repeat(100)}`;
    const folded = foldLine(long);
    expect(folded.split("\r\n ").every((part, index) => Buffer.byteLength(part, "utf8") <= (index === 0 ? 75 : 74))).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
    // A multi-byte character is never split.
    const accented = `SUMMARY:${"é".repeat(60)}`;
    expect(foldLine(accented).replace(/\r\n /g, "")).toBe(accented);
  });

  it("assumes an hour when no end was recorded, and says so in the entry", () => {
    expect(calendarEnd("2026-10-05T14:00:00Z", "2026-10-05T15:30:00Z")).toEqual({ end: "2026-10-05T15:30:00Z", assumed: false });
    expect(calendarEnd("2026-10-05T14:00:00Z", null)).toEqual({ end: "2026-10-05T15:00:00.000Z", assumed: true });
    expect(calendarEnd("2026-10-05T14:00:00Z", "2026-10-05T13:00:00Z").assumed).toBe(true);
    const text = buildCalendar({
      uid: "visit-1@acme", start: "2026-10-05T14:00:00Z", end: null, summary: "General pest — Acme Pest",
      description: "Technician: Rosa Vega", location: "Plant, 1 Loaf Lane", organizer: "Acme Pest", stamp: "2026-09-02T03:00:00Z",
    });
    expect(text.split("\r\n")).toEqual([
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Acme Pest//SoftwareFactory Services//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      "BEGIN:VEVENT", "UID:visit-1@acme", "DTSTAMP:20260902T030000Z", "DTSTART:20261005T140000Z", "DTEND:20261005T150000Z",
      "SUMMARY:General pest — Acme Pest",
      "DESCRIPTION:Technician: Rosa Vega\\nNo end time was recorded for this visit\\",
      " \; one hour is shown.",
      "LOCATION:Plant\\, 1 Loaf Lane", "END:VEVENT", "END:VCALENDAR", "",
    ]);
    expect(calendarFilename("General pest", "2026-10-05T14:00:00Z")).toBe("general-pest-2026-10-05.ics");
    expect(calendarFilename("///", "2026-10-05T14:00:00Z")).toBe("visit-2026-10-05.ics");
  });
});

describe("the knowledge base's pure side", () => {
  it("derives a slug the schema accepts, or none", () => {
    expect(slugify("Ant treatment: what to expect")).toBe("ant-treatment-what-to-expect");
    expect(slugify("  Café — règles  ")).toBe("cafe-regles");
    expect(slugify("!!")).toBeNull();
    expect(slugify("a")).toBeNull();
    expect(slugify("x".repeat(100))).toHaveLength(80);
  });

  it("explains a rank as the arithmetic behind it", () => {
    expect(explainRank({ rank: 0, titleHits: 0, bodyHits: 0 })).toBe("no search words");
    expect(explainRank({ rank: 7, titleHits: 2, bodyHits: 1 })).toBe("7: 2 in the title ×3 + 1 in the body");
    expect(explainRank({ rank: 1, titleHits: 0, bodyHits: 1 })).toBe("1: 1 in the body");
    expect(toKbSearchHit({ id: "a", slug: "s", title: "t", category: null, audience: "staff", published_at: null, updated_at: "u", rank: 7, title_hits: 2, body_hits: 1, excerpt: "e" }))
      .toMatchObject({ rank: 7, titleHits: 2, bodyHits: 1, publishedAt: null });
  });

  it("composes the copilot's answer from counts, and says when nothing matched or nothing is written", () => {
    expect(composeKnowledgeAnswer({ terms: ["bait"], total: 0, hits: [] }))
      .toBe("Nothing has been written in the knowledge base yet. The first article goes on the Knowledge page.");
    expect(composeKnowledgeAnswer({ terms: [], total: 4, hits: [] }))
      .toMatch(/^4 articles are in the knowledge base\. Ask with a word from the topic/);
    expect(composeKnowledgeAnswer({ terms: ["bait", "ants"], total: 4, hits: [] }))
      .toBe('No article mentions "bait", "ants". 4 articles are written; the gap is on the Knowledge page.');
    expect(composeKnowledgeAnswer({
      terms: ["bait"], total: 4,
      hits: [
        { title: "Rodent stations on commercial sites", audience: "customer", published: true, excerpt: "Stations are numbered.  Bait is locked inside.", rank: 1 },
        { title: "Calling back a complaint", audience: "staff", published: true, excerpt: "Call within two hours.", rank: 1 },
        { title: "Termite pretreatment", audience: "customer", published: false, excerpt: "Draft.", rank: 1 },
      ],
    })).toBe('3 articles mention "bait". "Rodent stations on commercial sites" (published to customers, rank 1): Stations are numbered. Bait is locked inside. "Calling back a complaint" (published, staff only, rank 1): Call within two hours. "Termite pretreatment" (draft, rank 1): Draft. The full text is on the Knowledge page.');
  });
});
