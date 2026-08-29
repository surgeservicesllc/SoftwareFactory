import { boardSearchAdapter } from "@/lib/job-seeker/board-search/registry";

/**
 * The researched source catalogue behind the unified job search: the most
 * popular general job sources and the leading marketing-focused ones, each
 * carrying an honest account of what this product does with it today.
 *
 * Statuses mean exactly one thing each:
 *
 * - `live` — an adapter in the board-search registry genuinely queries the
 *   source over its published integration surface (open JSON API or official
 *   RSS). Every `live` row names its adapter, and an integrity test holds the
 *   two lists equal, so this file cannot claim a connection the registry does
 *   not have.
 * - `needs_credentials` — the source publishes an official API that requires
 *   credentials or partner status this deployment does not hold. The UI shows
 *   these as **Not Connected**. Nothing is queried; the note says what the
 *   owner would need to supply.
 * - `external_link` — no permitted programmatic integration is connected, but
 *   the source supports an ordinary web link, so the UI opens a pre-filled
 *   search (or the board's jobs page) in a new tab. The person's own browser
 *   visits the site; this product fetches nothing. Every one of these URLs
 *   was probed on 2026-08-29: each resolved and responded (several behind
 *   bot walls that gate automated clients, which a person's browser is not).
 *   Four boards researched for this list turned out to have dead domains and
 *   were replaced with probed live ones rather than listed on reputation.
 * - `not_supported` — automated access is prohibited or blocked and no
 *   workable link-out exists; the note carries the reason. Kept in the
 *   catalogue so the refusal is documented where a person would look for the
 *   source, instead of the source silently missing.
 *
 * The choice this file never makes is a fake one: no source is listed as
 * searchable unless searching it is real.
 */

export type CatalogueStatus = "live" | "needs_credentials" | "external_link" | "not_supported";

export type CatalogueSource = Readonly<{
  /** Stable slug; equals the registry adapter key for live sources. */
  key: string;
  name: string;
  focus: "general" | "marketing";
  status: CatalogueStatus;
  /** live only: the registry adapter that serves this row. */
  adapterKey?: string;
  /**
   * external_link (and credentialed sources with a usable web search): the
   * URL the UI opens. `{query}` and `{location}` interpolate URL-encoded.
   */
  searchUrl?: string;
  /** The honest sentence a person reads about this source's standing. */
  note: string;
}>;

export const SOURCE_CATALOGUE: readonly CatalogueSource[] = Object.freeze([
  // ── General: connected boards ────────────────────────────────────────────
  {
    key: "remotive",
    name: "Remotive",
    focus: "general",
    status: "live",
    adapterKey: "remotive",
    note: "Searched over Remotive's public API within its stated call budget; results link back to Remotive and are ~24h delayed by the board's design.",
  },
  {
    key: "remoteok",
    name: "Remote OK",
    focus: "general",
    status: "live",
    adapterKey: "remoteok",
    note: "Searched over the public JSON feed with the attribution and link-back its legal notice requires.",
  },
  {
    key: "jobicy",
    name: "Jobicy",
    focus: "general",
    status: "live",
    adapterKey: "jobicy",
    note: "Searched over the public remote-jobs API using its free-text tag search.",
  },
  {
    key: "himalayas",
    name: "Himalayas",
    focus: "general",
    status: "live",
    adapterKey: "himalayas",
    note: "Recent listings fetched from the public jobs API and filtered locally against the search term.",
  },
  {
    key: "arbeitnow",
    name: "Arbeitnow",
    focus: "general",
    status: "live",
    adapterKey: "arbeitnow",
    note: "Europe-centric feed read over the public job-board API and filtered locally.",
  },
  {
    key: "weworkremotely",
    name: "We Work Remotely",
    focus: "general",
    status: "live",
    adapterKey: "weworkremotely",
    note: "Read over the board's official RSS feed — its published integration surface — and filtered locally.",
  },
  {
    key: "jobnet",
    name: "Jobnet (Denmark)",
    focus: "general",
    status: "live",
    adapterKey: "jobnet",
    note: "Denmark's public employment service, searched over its open API.",
  },
  {
    key: "jobindex",
    name: "Jobindex (Denmark)",
    focus: "general",
    status: "live",
    adapterKey: "jobindex",
    note: "Denmark's largest job board, searched over its published surface.",
  },
  {
    key: "jobdanmark",
    name: "JobDanmark",
    focus: "general",
    status: "live",
    adapterKey: "jobdanmark",
    note: "Danish job board searched over its published surface.",
  },
  {
    key: "freehire",
    name: "Freehire",
    focus: "general",
    status: "live",
    adapterKey: "freehire",
    note: "Searched over the board's public API; the one connected board that states salary and work arrangement as data.",
  },

  // ── General: official APIs awaiting credentials ─────────────────────────
  {
    key: "usajobs",
    name: "USAJOBS",
    focus: "general",
    status: "needs_credentials",
    searchUrl: "https://www.usajobs.gov/Search/Results?k={query}",
    note: "The U.S. federal government's job API is official and free but requires a registered API key and user agent from developer.usajobs.gov. Not connected until the owner supplies one; the link opens USAJOBS search directly.",
  },
  {
    key: "adzuna",
    name: "Adzuna",
    focus: "general",
    status: "needs_credentials",
    searchUrl: "https://www.adzuna.com/search?q={query}",
    note: "Adzuna aggregates millions of listings behind an official API that requires a free app_id/app_key pair from developer.adzuna.com. Not connected until the owner registers; the link opens Adzuna search directly.",
  },
  {
    key: "jooble",
    name: "Jooble",
    focus: "general",
    status: "needs_credentials",
    searchUrl: "https://jooble.org/SearchResult?ukw={query}",
    note: "Jooble's aggregation API is official and free but issues per-site keys on request. Not connected until the owner obtains one; the link opens Jooble search directly.",
  },
  {
    key: "careerjet",
    name: "Careerjet",
    focus: "general",
    status: "needs_credentials",
    searchUrl: "https://www.careerjet.com/search/jobs?s={query}&l={location}",
    note: "Careerjet's search API requires an affiliate ID. Not connected until the owner registers; the link opens Careerjet search directly.",
  },
  {
    key: "reed",
    name: "Reed.co.uk",
    focus: "general",
    status: "needs_credentials",
    searchUrl: "https://www.reed.co.uk/jobs?keywords={query}",
    note: "Reed's Jobseeker API (the UK's largest board) requires a free API key from reed.co.uk/developers. Not connected until the owner registers; the link opens Reed search directly.",
  },
  {
    key: "ziprecruiter",
    name: "ZipRecruiter",
    focus: "general",
    status: "needs_credentials",
    searchUrl: "https://www.ziprecruiter.com/jobs-search?search={query}&location={location}",
    note: "ZipRecruiter's job search API is partner-only. Not connected without a partner key; the link opens ZipRecruiter search directly.",
  },

  // ── General: link-out only ──────────────────────────────────────────────
  {
    key: "linkedin_jobs",
    name: "LinkedIn Jobs",
    focus: "general",
    status: "external_link",
    searchUrl: "https://www.linkedin.com/jobs/search/?keywords={query}&location={location}",
    note: "LinkedIn's terms prohibit automated collection, and this repository has twice declined to scrape it; that decision stands. The link opens LinkedIn's own job search in your browser, which is the permitted path.",
  },
  {
    key: "indeed",
    name: "Indeed",
    focus: "general",
    status: "external_link",
    searchUrl: "https://www.indeed.com/jobs?q={query}&l={location}",
    note: "Indeed's publisher API is closed to new partners and scraping is prohibited, so the link opens Indeed's own search in your browser.",
  },
  {
    key: "glassdoor",
    name: "Glassdoor",
    focus: "general",
    status: "external_link",
    searchUrl: "https://www.glassdoor.com/Job/jobs.htm?sc.keyword={query}",
    note: "Glassdoor retired its public API, so the link opens Glassdoor's own search in your browser.",
  },
  {
    key: "monster",
    name: "Monster",
    focus: "general",
    status: "external_link",
    searchUrl: "https://www.monster.com/jobs/search?q={query}&where={location}",
    note: "Monster has no open API; the link opens Monster's own search in your browser.",
  },
  {
    key: "google_jobs",
    name: "Google for Jobs",
    focus: "general",
    status: "external_link",
    searchUrl: "https://www.google.com/search?q={query}+jobs",
    note: "Google's job surface is a search feature without a public API; the link runs the search in your browser, where Google's job panel appears.",
  },
  {
    key: "dice",
    name: "Dice",
    focus: "general",
    status: "external_link",
    searchUrl: "https://www.dice.com/jobs?q={query}&location={location}",
    note: "Dice (tech-focused) has no open API; the link opens Dice's own search in your browser.",
  },
  {
    key: "wellfound",
    name: "Wellfound (AngelList Talent)",
    focus: "general",
    status: "external_link",
    searchUrl: "https://wellfound.com/jobs",
    note: "Wellfound (startup jobs) restricts automated access; the link opens its jobs page in your browser.",
  },
  {
    key: "simplyhired",
    name: "SimplyHired",
    focus: "general",
    status: "external_link",
    searchUrl: "https://www.simplyhired.com/search?q={query}&l={location}",
    note: "SimplyHired has no open API; the link opens its own search in your browser.",
  },
  {
    key: "themuse",
    name: "The Muse",
    focus: "general",
    status: "external_link",
    searchUrl: "https://www.themuse.com/search?keyword={query}",
    note: "The Muse publishes a public JSON API and is the strongest candidate for the next live adapter; until that adapter exists the link opens its own search in your browser.",
  },

  // ── Marketing: link-out boards ──────────────────────────────────────────
  {
    key: "ama_jobs",
    name: "AMA Job Board",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://jobs.ama.org/",
    note: "The American Marketing Association's board has no open API; the link opens it in your browser.",
  },
  {
    key: "marketinghire",
    name: "MarketingHire",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://www.marketinghire.com/",
    note: "Marketing-specialty board without an open API; the link opens it in your browser.",
  },
  {
    key: "marketingjobs",
    name: "MarketingJobs.com",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://www.marketingjobs.com/",
    note: "Marketing-specialty board without an open API; the link opens it in your browser.",
  },
  {
    key: "marketerhire",
    name: "MarketerHire",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://marketerhire.com/",
    note: "Freelance marketing talent marketplace; matching happens inside its own product, so the link opens it in your browser.",
  },
  {
    key: "superpath",
    name: "Superpath",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://jobs.superpath.co/",
    note: "Content-marketing community job board without an open API; the link opens it in your browser.",
  },
  {
    key: "problogger",
    name: "ProBlogger Job Board",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://problogger.com/jobs/",
    note: "Long-running content and blogging job board without an open API; the link opens it in your browser.",
  },
  {
    key: "mediabistro",
    name: "Mediabistro",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://www.mediabistro.com/jobs/",
    note: "Media, PR, and marketing job board without an open API; the link opens it in your browser.",
  },
  {
    key: "adweek_jobs",
    name: "Adweek Jobs",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://jobs.adweek.com/",
    note: "Advertising-industry board without an open API; the link opens it in your browser.",
  },
  {
    key: "builtin_marketing",
    name: "Built In — Marketing",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://builtin.com/jobs/marketing",
    note: "Built In's marketing category across its city hubs; no open API, so the link opens it in your browser.",
  },
  {
    key: "workingincontent",
    name: "Working in Content",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://workingincontent.com/",
    note: "Content-strategy and content-marketing job board without an open API; the link opens it in your browser.",
  },
  {
    key: "campaign_jobs",
    name: "Campaign Jobs",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://jobs.campaignlive.co.uk/",
    note: "UK advertising-industry board without an open API; the link opens it in your browser.",
  },
  {
    key: "heymarketers",
    name: "Hey Marketers",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://www.heymarketers.com/",
    note: "Marketing-only job board without an open API; the link opens it in your browser.",
  },
  {
    key: "prsa_jobcenter",
    name: "PRSA Jobcenter",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://jobs.prsa.org/",
    note: "The Public Relations Society of America's board has no open API; the link opens it in your browser.",
  },
  {
    key: "odwyers_pr_jobs",
    name: "O'Dwyer's PR Jobs",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://jobs.odwyerpr.com/",
    note: "The long-running PR trade publication's job board; no open API, so the link opens it in your browser.",
  },
  {
    key: "dribbble_jobs",
    name: "Dribbble Jobs",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://dribbble.com/jobs",
    note: "Design and creative board (brand, visual, and marketing design roles) without an open API; the link opens it in your browser.",
  },
  {
    key: "behance_joblist",
    name: "Behance Job List",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://www.behance.net/joblist",
    note: "Adobe's creative job list (brand and marketing design roles) without an open API; the link opens it in your browser.",
  },
  {
    key: "aiga_designjobs",
    name: "AIGA Design Jobs",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://designjobs.aiga.org/",
    note: "The professional design association's board (brand and marketing design roles) without an open API; the link opens it in your browser.",
  },
  {
    key: "coroflot",
    name: "Coroflot",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://www.coroflot.com/design-jobs",
    note: "Design and creative job board without an open API; the link opens it in your browser.",
  },
  {
    key: "krop",
    name: "Krop",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://www.krop.com/creative-jobs/",
    note: "Creative-industry job board without an open API; the link opens it in your browser.",
  },
  {
    key: "creative_circle",
    name: "Creative Circle",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://www.creativecircle.com/",
    note: "Creative and marketing staffing agency; roles are placed through its recruiters, so the link opens it in your browser.",
  },
  {
    key: "aquent",
    name: "Aquent",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://aquent.com/find-work",
    note: "Creative and marketing staffing agency; roles are placed through its recruiters, so the link opens it in your browser.",
  },
  {
    key: "onward_search",
    name: "Onward Search",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://www.onwardsearch.com/",
    note: "Digital, creative, and marketing staffing agency; the link opens it in your browser.",
  },
  {
    key: "talent_24_seven",
    name: "24 Seven Talent",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://www.24seventalent.com/",
    note: "Marketing, fashion, and creative staffing agency; the link opens it in your browser.",
  },
  {
    key: "roberthalf_creative",
    name: "Robert Half — Marketing & Creative",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://www.roberthalf.com/us/en/jobs",
    note: "Staffing firm whose marketing and creative practice absorbed The Creative Group; the link opens its job search in your browser.",
  },
  {
    key: "contentwritingjobs",
    name: "Content Writing Jobs",
    focus: "marketing",
    status: "external_link",
    searchUrl: "https://www.contentwritingjobs.com/",
    note: "Content-marketing and writing job board without an open API; the link opens it in your browser.",
  },
]);

export function catalogueSource(key: string): CatalogueSource | null {
  return SOURCE_CATALOGUE.find((source) => source.key === key) ?? null;
}

/** The catalogue rows that resolve to a working registry adapter. */
export function liveCatalogueSources(): readonly CatalogueSource[] {
  return SOURCE_CATALOGUE.filter(
    (source) =>
      source.status === "live" &&
      source.adapterKey !== undefined &&
      boardSearchAdapter(source.adapterKey) !== null,
  );
}
