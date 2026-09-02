/**
 * A calendar file for one booked visit (ADR-237).
 *
 * HubSpot's "meeting scheduling with calendar sync" is a two-way sync with a
 * provider the owner has not opened. What a customer actually does with a
 * booking is put it in their calendar, and every calendar on earth opens a
 * .ics. So the portal hands one over, built here from the visit's own row:
 * no provider, no token, nothing to connect.
 *
 * RFC 5545 in the small: CRLF line ends, lines folded at 75 octets, the
 * five characters that must be escaped in TEXT values, and moments in UTC
 * with a trailing Z. A visit without an end is given one hour — the
 * DTEND is a property the file must carry, and an hour is what a visit
 * window is when nobody wrote one down; DESCRIPTION says so.
 */

export type CalendarVisit = {
  /** Stable identity: the same visit must produce the same UID so a re-download updates, not duplicates. */
  uid: string;
  start: string;
  end: string | null;
  summary: string;
  description: string;
  location: string | null;
  /** Who is sending the file; ends up in PRODID and the organizer line. */
  organizer: string;
  /** When the file was built; DTSTAMP. */
  stamp: string;
};

/** RFC 5545 §3.3.11: backslash, semicolon, comma and newline are escaped in TEXT. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** RFC 5545 §3.1: a content line longer than 75 octets folds with CRLF + one space. */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  let limit = 75;
  while (Buffer.byteLength(rest, "utf8") > limit) {
    // Walk back from the octet limit to a character boundary.
    let cut = Math.min(rest.length, limit);
    while (Buffer.byteLength(rest.slice(0, cut), "utf8") > limit) cut -= 1;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
    limit = 74; // the continuation's leading space is an octet
  }
  parts.push(rest);
  return parts.join("\r\n ");
}

/** 2026-04-20T09:00:00.000Z → 20260420T090000Z */
export function calendarMoment(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`not a moment: ${iso}`);
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export const DEFAULT_VISIT_MINUTES = 60;

export function calendarEnd(start: string, end: string | null): { end: string; assumed: boolean } {
  if (end !== null && Date.parse(end) > Date.parse(start)) return { end, assumed: false };
  return { end: new Date(Date.parse(start) + DEFAULT_VISIT_MINUTES * 60_000).toISOString(), assumed: true };
}

export function buildCalendar(visit: CalendarVisit): string {
  const { end, assumed } = calendarEnd(visit.start, visit.end);
  const description = assumed
    ? `${visit.description}\nNo end time was recorded for this visit; one hour is shown.`
    : visit.description;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${escapeText(visit.organizer)}//SoftwareFactory Services//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeText(visit.uid)}`,
    `DTSTAMP:${calendarMoment(visit.stamp)}`,
    `DTSTART:${calendarMoment(visit.start)}`,
    `DTEND:${calendarMoment(end)}`,
    `SUMMARY:${escapeText(visit.summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
    ...(visit.location === null ? [] : [`LOCATION:${escapeText(visit.location)}`]),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

/** A filename a browser will keep: the service and the day, ASCII only. */
export function calendarFilename(serviceType: string, start: string): string {
  const slug = serviceType.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "visit";
  return `${slug}-${start.slice(0, 10)}.ics`;
}
