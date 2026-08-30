import type { DerivedSeniority } from "@/lib/job-seeker/board-search/unify";

/**
 * Deep links into the sites that permit an ordinary web link but not
 * automated collection — LinkedIn and Indeed above all.
 *
 * Neither offers this product a lawful results feed: LinkedIn's job search
 * API is partner-only, Indeed closed its publisher search API to new
 * partners, and both prohibit scraping — which this repository refuses.
 * What their terms do permit is the same thing a person does by hand: open
 * the site's own search. So "wired" here means wired *outward*, as deeply
 * as their URLs allow — the search text, place, radius, posted-within
 * window, work model, seniority and salary floor are translated into the
 * exact parameters each site's own search UI reads, and the person lands on
 * a results page already narrowed to what they asked this page for.
 *
 * The honesty rule for every mapping below: a filter is either translated
 * faithfully or left off the URL entirely. Nothing is approximated into a
 * different meaning, and anything a site cannot express in a URL simply
 * stays behind — the link never claims more than it carries.
 */

export type LinkoutQuery = Readonly<{
  text: string;
  location: string;
  /** Applied only when a place is set — a radius around nowhere is nothing. */
  radiusKm: number | null;
  postedWithinDays: number | null;
  workModel: "remote" | "hybrid" | "onsite" | null;
  seniority: DerivedSeniority | null;
  salaryMinimum: number | null;
}>;

export const EMPTY_LINKOUT_QUERY: LinkoutQuery = Object.freeze({
  text: "",
  location: "",
  radiusKm: null,
  postedWithinDays: null,
  workModel: null,
  seniority: null,
  salaryMinimum: null,
});

/** The generic path: a catalogue template with {query}/{location} slots. */
export function fillLinkTemplate(template: string, text: string, location: string): string {
  return template
    .replace("{query}", encodeURIComponent(text.trim()))
    .replace("{location}", encodeURIComponent(location.trim()));
}

const KM_PER_MILE = 1.609344;

/**
 * LinkedIn's job-search URL, in the parameters its own search UI reads:
 * `keywords`, `location`, `distance` (miles), `f_TPR` (posted within, as
 * `r` + seconds), `f_WT` (1 on-site / 2 remote / 3 hybrid), `f_E`
 * (experience level) and `f_SB2` (salary floor buckets, $40k+ … $200k+).
 */
function buildLinkedInUrl(query: LinkoutQuery): string {
  const url = new URL("https://www.linkedin.com/jobs/search/");
  const params = url.searchParams;
  params.set("keywords", query.text.trim());
  params.set("location", query.location.trim());
  if (query.radiusKm !== null && query.location.trim() !== "") {
    params.set("distance", String(Math.max(1, Math.round(query.radiusKm / KM_PER_MILE))));
  }
  if (query.postedWithinDays !== null) {
    params.set("f_TPR", `r${query.postedWithinDays * 86_400}`);
  }
  if (query.workModel !== null) {
    params.set("f_WT", { onsite: "1", remote: "2", hybrid: "3" }[query.workModel]);
  }
  if (query.seniority !== null) {
    // LinkedIn's levels: 1 internship, 2 entry, 3 associate, 4 mid-senior,
    // 5 director, 6 executive. Only faithful equivalents are mapped; "lead"
    // and "manager" have no LinkedIn level, so they stay off the URL rather
    // than being bent into a level that means something else.
    const level: Partial<Record<DerivedSeniority, string>> = {
      intern: "1",
      entry: "2",
      senior: "4",
      director: "5",
      executive: "6",
    };
    const mapped = level[query.seniority];
    if (mapped !== undefined) params.set("f_E", mapped);
  }
  if (query.salaryMinimum !== null && query.salaryMinimum >= 40_000) {
    // Buckets are $40k+ (1) through $200k+ (9) in $20k steps; the highest
    // bucket not exceeding the asked-for floor is the faithful one — it
    // shows a superset of the request, never a mislabeled subset.
    params.set("f_SB2", String(Math.min(9, Math.floor(query.salaryMinimum / 20_000) - 1)));
  }
  return url.toString();
}

/** Indeed's radius choices; snapped upward so the link never quietly narrows. */
const INDEED_RADII_MILES = [5, 10, 15, 25, 35, 50, 100] as const;

/**
 * Indeed's job-search URL: `q`, `l`, `radius` (miles), `fromage` (days).
 * Indeed exposes no URL parameter for work model or seniority; per its own
 * search tips, a salary floor and "remote" belong in the query text, so
 * those two — and only those two — are appended there, visibly.
 */
function buildIndeedUrl(query: LinkoutQuery): string {
  const url = new URL("https://www.indeed.com/jobs");
  const params = url.searchParams;
  const terms = [query.text.trim()];
  if (query.salaryMinimum !== null && query.salaryMinimum > 0) {
    terms.push(`$${query.salaryMinimum.toLocaleString("en-US")}`);
  }
  if (query.workModel === "remote") terms.push("remote");
  params.set("q", terms.filter((term) => term !== "").join(" "));
  params.set("l", query.location.trim());
  if (query.radiusKm !== null && query.location.trim() !== "") {
    const miles = query.radiusKm / KM_PER_MILE;
    const snapped = INDEED_RADII_MILES.find((choice) => choice >= miles) ?? 100;
    params.set("radius", String(snapped));
  }
  if (query.postedWithinDays !== null) {
    params.set("fromage", String(query.postedWithinDays));
  }
  return url.toString();
}

const DEEP_BUILDERS: Record<string, (query: LinkoutQuery) => string> = {
  linkedin_jobs: buildLinkedInUrl,
  indeed: buildIndeedUrl,
};

/** Whether this source's link carries the person's filters, not just the text. */
export function linkoutCarriesFilters(sourceKey: string): boolean {
  return sourceKey in DEEP_BUILDERS;
}

/**
 * The link for a catalogue source: the site-specific deep builder when one
 * exists, else the source's own {query}/{location} template verbatim.
 */
export function buildLinkoutUrl(
  sourceKey: string,
  searchUrl: string,
  query: LinkoutQuery,
): string {
  const builder = DEEP_BUILDERS[sourceKey];
  if (builder !== undefined) return builder(query);
  return fillLinkTemplate(searchUrl, query.text, query.location);
}
