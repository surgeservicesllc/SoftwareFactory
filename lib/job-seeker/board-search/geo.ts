import "server-only";

import cities from "@/lib/job-seeker/board-search/data/cities.json";
import postalCodes from "@/lib/job-seeker/board-search/data/postal-codes-us.json";

import type { UnifiedHit } from "@/lib/job-seeker/board-search/unify";

/**
 * Location + radius for the unified search, from a real place index.
 *
 * The boards return a job's place as free text, so a radius filter needs a
 * gazetteer: `data/cities.json` is derived from GeoNames' cities15000 set
 * (every city of 15,000+ people; CC BY 4.0, https://www.geonames.org) —
 * folded name, English name, country, coordinates, population. Larger
 * cities also carry their latin alternate names, which is what lets
 * "København", "München" or "NYC" resolve. When one folded name belongs to
 * several cities the most populous one wins, deterministically — a person
 * filtering around "Portland" gets the bigger Portland, and the resolved
 * city and country are always shown so the choice is visible.
 *
 * ZIP codes resolve too: `data/postal-codes-us.json` is derived from
 * GeoNames' US postal-code set (same CC BY 4.0 source), one row per
 * five-digit ZIP with its place name and centroid. A ZIP anywhere in the
 * text — "78701", "Austin, TX 78701", "78701-1234" — resolves to that
 * centroid after the city lookups have had their chance, and the resolved
 * place is shown with the ZIP so the person sees exactly what was used.
 *
 * The module is server-only: the index is a few megabytes and belongs in
 * the server bundle, never in the browser.
 *
 * Honesty rules, matching the rest of the filter vocabulary:
 * - A centre that cannot be resolved never fails or silently narrows the
 *   search — the radius is reported as not applied, with the reason.
 * - A remote posting has no distance; it is kept and counted.
 * - A posting whose place text cannot be resolved is kept and counted,
 *   because "we could not locate it" is not "it is far away".
 */

type CityRow = [
  key: string,
  display: string,
  country: string,
  lat: number,
  lng: number,
  population: number,
];

export type ResolvedPlace = Readonly<{
  name: string;
  country: string;
  lat: number;
  lng: number;
}>;

const MANUAL_FOLDS: Readonly<Record<string, string>> = {
  "ø": "o", "æ": "ae", "ß": "ss", "œ": "oe", "đ": "d",
  "ð": "d", "þ": "th", "ł": "l", "ħ": "h", "ı": "i",
};

/** Must mirror the fold in the dataset build exactly, or lookups miss. */
export function foldPlaceName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[øæßœđðþłħı]/g, (c) => MANUAL_FOLDS[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

let index: Map<string, ResolvedPlace> | null = null;

function placeIndex(): Map<string, ResolvedPlace> {
  if (index === null) {
    index = new Map(
      (cities as CityRow[]).map(([key, display, country, lat, lng]) => [
        key,
        { name: display, country, lat, lng },
      ]),
    );
  }
  return index;
}

type PostalRow = [zip: string, display: string, lat: number, lng: number];

let zipIndex: Map<string, ResolvedPlace> | null = null;

function postalIndex(): Map<string, ResolvedPlace> {
  if (zipIndex === null) {
    zipIndex = new Map(
      (postalCodes as PostalRow[]).map(([zip, display, lat, lng]) => [
        zip,
        // The ZIP stays in the shown name so the person sees exactly what
        // the radius was centred on.
        { name: `${display} ${zip}`, country: "US", lat, lng },
      ]),
    );
  }
  return zipIndex;
}

/**
 * Resolve free place text to a point. Tries the whole folded string as a
 * city, then each comma-separated segment ("Copenhagen, Denmark" →
 * "copenhagen"), then any five-digit US ZIP in the text ("78701",
 * "Austin, TX 78701", "78701-1234" all resolve to the ZIP's centroid).
 */
export function resolvePlace(text: string): ResolvedPlace | null {
  const lookup = placeIndex();
  const whole = foldPlaceName(text);
  if (whole.length === 0) return null;
  const exact = lookup.get(whole);
  if (exact !== undefined) return exact;
  for (const segment of text.split(",")) {
    const key = foldPlaceName(segment);
    if (key.length === 0) continue;
    const found = lookup.get(key);
    if (found !== undefined) return found;
  }
  const zip = /\b(\d{5})\b/.exec(text);
  if (zip !== null) {
    const found = postalIndex().get(zip[1]);
    if (found !== undefined) return found;
  }
  return null;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  a: Readonly<{ lat: number; lng: number }>,
  b: Readonly<{ lat: number; lng: number }>,
): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export type RadiusOutcome<T> = Readonly<{
  hits: T[];
  /** Postings whose place resolved to a point beyond the radius: dropped. */
  excluded: number;
  /** Postings kept because their place text resolved to no known city. */
  unresolvedKept: number;
  /** Remote postings kept because a remote job has no distance. */
  remoteKept: number;
}>;

export function applyRadius<T extends UnifiedHit>(
  hits: readonly T[],
  center: ResolvedPlace,
  radiusKm: number,
): RadiusOutcome<T> {
  const kept: T[] = [];
  let excluded = 0;
  let unresolvedKept = 0;
  let remoteKept = 0;
  for (const hit of hits) {
    if (hit.job.workModel === "remote") {
      remoteKept += 1;
      kept.push(hit);
      continue;
    }
    const place = hit.job.location === null ? null : resolvePlace(hit.job.location);
    if (place === null) {
      unresolvedKept += 1;
      kept.push(hit);
      continue;
    }
    if (haversineKm(center, place) <= radiusKm) {
      kept.push(hit);
    } else {
      excluded += 1;
    }
  }
  return { hits: kept, excluded, unresolvedKept, remoteKept };
}
