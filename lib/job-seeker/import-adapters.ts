/**
 * Job import adapters: real discovery beyond manual entry.
 *
 * Two kinds of adapter live here, and the distinction is the whole design:
 *
 * - PUBLIC adapters (Greenhouse, Lever) read providers' public, keyless
 *   postings APIs. They need no credential — what they need is an
 *   *identifier*: which company's board to read, and that is the user's
 *   input on the page, not an environment secret. Their `fetchPostings`
 *   is real, bounded, and validated; what it returns is exactly what the
 *   provider published, normalized into the shape `job_seeker_jobs`
 *   stores, attributed by `source`.
 *
 * - CREDENTIALED adapters (LinkedIn) require provider credentials that do
 *   not exist yet. They carry no fetch implementation at all — an
 *   unconfigured adapter is incapable of inventing jobs because there is
 *   nothing to call — and `configured` flips only by detection of the
 *   named variables, never by assertion.
 */

import {
  fetchAshbyBoard,
  fetchBreezyBoard,
  fetchSmartRecruitersBoard,
  fetchWorkableBoard,
} from "@/lib/job-seeker/boards/company-boards";
import {
  fetchArbeitnowJobs,
  fetchHimalayasJobs,
  fetchJobicyJobs,
  fetchRemoteOkJobs,
  fetchRemotiveJobs,
} from "@/lib/job-seeker/boards/aggregators";

import {
  COMPANY_MAX,
  DESCRIPTION_MAX,
  EXTERNAL_ID_MAX,
  ImportSourceError,
  LOCATION_MAX,
  MAX_IMPORT_POSTINGS,
  TITLE_MAX,
  assertIdentifier,
  bounded,
  boundedOrNull,
  htmlToText,
  httpsUrlOrNull,
  timedFetch,
  type FetchedPostings,
  type ImportedJob,
  type JobImportAdapter,
} from "@/lib/job-seeker/boards/contract";

/*
 * Re-exported so every existing importer of these names keeps working. The
 * definitions moved; the public surface of this module did not.
 */
export {
  ImportSourceError,
  MAX_IMPORT_POSTINGS,
  htmlToText,
  type FetchedPostings,
  type ImportSourceErrorCode,
  type ImportedJob,
  type JobImportAdapter,
} from "@/lib/job-seeker/boards/contract";

type GreenhouseJob = {
  id?: number | string;
  title?: string;
  company_name?: string;
  absolute_url?: string;
  location?: { name?: string };
  content?: string;
};

async function fetchGreenhouseBoard(identifier: string): Promise<FetchedPostings> {
  const token = assertIdentifier(identifier);
  const response = await timedFetch(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`,
  );
  if (response.status === 404) {
    throw new ImportSourceError(
      "source_not_found",
      `No public Greenhouse board is published at "${token}". The token is the last path segment of boards.greenhouse.io/{token}.`,
    );
  }
  if (!response.ok) {
    throw new ImportSourceError("provider_error", `Greenhouse answered HTTP ${response.status}.`);
  }
  const body = (await response.json().catch(() => null)) as { jobs?: GreenhouseJob[] } | null;
  const jobs = Array.isArray(body?.jobs) ? body.jobs : [];

  const postings = jobs.slice(0, MAX_IMPORT_POSTINGS).flatMap((job): ImportedJob[] => {
    const title = boundedOrNull(job?.title, TITLE_MAX);
    const id = job?.id;
    if (!title || (typeof id !== "number" && typeof id !== "string")) return [];
    const location = boundedOrNull(job?.location?.name, LOCATION_MAX);
    const description = boundedOrNull(htmlToText(String(job?.content ?? "")), DESCRIPTION_MAX);
    return [{
      externalId: bounded(String(id), EXTERNAL_ID_MAX),
      url: httpsUrlOrNull(job?.absolute_url),
      title,
      company: boundedOrNull(job?.company_name, COMPANY_MAX) ?? token,
      salaryText: null,
      location,
      workModel: location && /remote/i.test(location) ? "remote" : null,
      description,
    }];
  });

  return {
    company: postings[0]?.company ?? token,
    totalAvailable: jobs.length,
    postings,
  };
}

type LeverPosting = {
  id?: string;
  text?: string;
  hostedUrl?: string;
  workplaceType?: string;
  categories?: { location?: string };
  descriptionPlain?: string;
  description?: string;
  lists?: Array<{ text?: string; content?: string }>;
};

function leverWorkModel(posting: LeverPosting, location: string | null): ImportedJob["workModel"] {
  const type = posting.workplaceType?.toLowerCase() ?? "";
  if (type === "remote") return "remote";
  if (type === "hybrid") return "hybrid";
  if (type === "onsite" || type === "on-site") return "onsite";
  return location && /remote/i.test(location) ? "remote" : null;
}

function leverDescription(posting: LeverPosting): string | null {
  const parts: string[] = [];
  const opening = posting.descriptionPlain?.trim()
    || (posting.description ? htmlToText(posting.description) : "");
  if (opening) parts.push(opening);
  for (const list of posting.lists ?? []) {
    const heading = list.text?.trim();
    const content = list.content ? htmlToText(list.content) : "";
    if (heading || content) parts.push([heading, content].filter(Boolean).join("\n"));
  }
  const combined = parts.join("\n\n").trim();
  return combined ? bounded(combined, DESCRIPTION_MAX) : null;
}

async function fetchLeverSite(identifier: string): Promise<FetchedPostings> {
  const site = assertIdentifier(identifier);
  const response = await timedFetch(
    `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`,
  );
  if (response.status === 404) {
    throw new ImportSourceError(
      "source_not_found",
      `No public Lever site is published at "${site}". The site name is the last path segment of jobs.lever.co/{site}.`,
    );
  }
  if (!response.ok) {
    throw new ImportSourceError("provider_error", `Lever answered HTTP ${response.status}.`);
  }
  const body = (await response.json().catch(() => null)) as LeverPosting[] | null;
  if (!Array.isArray(body)) {
    throw new ImportSourceError("provider_error", "Lever answered with an unexpected shape.");
  }

  const postings = body.slice(0, MAX_IMPORT_POSTINGS).flatMap((posting): ImportedJob[] => {
    const title = boundedOrNull(posting?.text, TITLE_MAX);
    const id = boundedOrNull(posting?.id, EXTERNAL_ID_MAX);
    if (!title || !id) return [];
    const location = boundedOrNull(posting?.categories?.location, LOCATION_MAX);
    return [{
      externalId: id,
      url: httpsUrlOrNull(posting?.hostedUrl),
      title,
      // Lever's public payload names no company; the site identifier is the
      // truthful attribution a person typed and can verify.
      company: site,
      salaryText: null,
      location,
      workModel: leverWorkModel(posting ?? {}, location),
      description: leverDescription(posting ?? {}),
    }];
  });

  return { company: site, totalAvailable: body.length, postings };
}

function configuredIn(env: NodeJS.ProcessEnv, names: readonly string[]): boolean {
  return names.every((name) => Boolean(env[name]?.trim()));
}

/**
 * The registry, evaluated against the live environment. Greenhouse and
 * Lever are public-API adapters — always available, driven by a
 * user-supplied identifier. LinkedIn still needs its OAuth credential and
 * so remains detection-gated with no fetch implementation.
 */
export function listImportAdapters(env: NodeJS.ProcessEnv = process.env): readonly JobImportAdapter[] {
  return [
    {
      key: "greenhouse",
      name: "Greenhouse job boards",
      summary: "Reads public postings from a company's Greenhouse board — no credential needed.",
      mode: "public",
      identifierLabel: "Board token",
      identifierHint: "The last path segment of boards.greenhouse.io/{token} — e.g. \"stripe\".",
      requiredConfiguration: [],
      configured: true,
      fetchPostings: fetchGreenhouseBoard,
    },
    {
      key: "lever",
      name: "Lever postings",
      summary: "Reads public postings from a company's Lever site — no credential needed.",
      mode: "public",
      identifierLabel: "Site name",
      identifierHint: "The last path segment of jobs.lever.co/{site} — e.g. \"palantir\".",
      requiredConfiguration: [],
      configured: true,
      fetchPostings: fetchLeverSite,
    },
    {
      key: "ashby",
      name: "Ashby job boards",
      summary: "Reads public postings from a company's Ashby board — no credential needed.",
      mode: "public",
      identifierLabel: "Board name",
      identifierHint: "The last path segment of jobs.ashbyhq.com/{name} — e.g. \"ramp\".",
      requiredConfiguration: [],
      configured: true,
      fetchPostings: fetchAshbyBoard,
    },
    {
      key: "smartrecruiters",
      name: "SmartRecruiters",
      summary: "Reads public postings from a company's SmartRecruiters board — no credential needed.",
      mode: "public",
      identifierLabel: "Company",
      identifierHint: "The company in jobs.smartrecruiters.com/{company} — e.g. \"smartrecruiters\".",
      requiredConfiguration: [],
      configured: true,
      fetchPostings: fetchSmartRecruitersBoard,
    },
    {
      key: "workable",
      name: "Workable",
      summary: "Reads public postings from a company's Workable account — no credential needed.",
      mode: "public",
      identifierLabel: "Account",
      identifierHint: "The subdomain in apply.workable.com/{account} — e.g. \"deel\".",
      requiredConfiguration: [],
      configured: true,
      fetchPostings: fetchWorkableBoard,
    },
    {
      key: "breezy",
      name: "Breezy HR",
      summary: "Reads public postings from a company's Breezy board — no credential needed.",
      mode: "public",
      identifierLabel: "Company",
      identifierHint: "The subdomain in {company}.breezy.hr — e.g. \"breezy\".",
      requiredConfiguration: [],
      configured: true,
      fetchPostings: fetchBreezyBoard,
    },
    /*
     * The aggregators. Their identifier is a search term rather than a
     * company, which is why their labels ask a different question — and why
     * `assertSearchTerm` rather than `assertIdentifier` validates it.
     */
    {
      key: "remotive",
      name: "Remotive",
      summary: "Searches Remotive's remote-only job board across every employer on it.",
      mode: "public",
      identifierLabel: "Search term",
      identifierHint: "A job title, skill or keyword — e.g. \"react developer\".",
      requiredConfiguration: [],
      configured: true,
      fetchPostings: fetchRemotiveJobs,
    },
    {
      key: "remoteok",
      name: "Remote OK",
      summary: "Searches Remote OK across every employer on it. Postings link back to Remote OK, as their API terms require.",
      mode: "public",
      identifierLabel: "Search term",
      identifierHint: "A job title, skill or tag — e.g. \"golang\".",
      requiredConfiguration: [],
      configured: true,
      fetchPostings: fetchRemoteOkJobs,
    },
    {
      key: "jobicy",
      name: "Jobicy",
      summary: "Searches Jobicy's remote job board. Postings link to the original Jobicy listing, as their API terms require.",
      mode: "public",
      identifierLabel: "Search term",
      identifierHint: "A job tag — e.g. \"python\" or \"design\".",
      requiredConfiguration: [],
      configured: true,
      fetchPostings: fetchJobicyJobs,
    },
    {
      key: "arbeitnow",
      name: "Arbeitnow",
      summary: "Searches Arbeitnow's board, strongest for roles in Germany and the EU.",
      mode: "public",
      identifierLabel: "Search term",
      identifierHint: "A job title, company or city — e.g. \"backend\" or \"berlin\".",
      requiredConfiguration: [],
      configured: true,
      fetchPostings: fetchArbeitnowJobs,
    },
    {
      key: "himalayas",
      name: "Himalayas",
      summary: "Searches Himalayas' remote job board across every employer on it.",
      mode: "public",
      identifierLabel: "Search term",
      identifierHint: "A job title, company or country — e.g. \"engineer\".",
      requiredConfiguration: [],
      configured: true,
      fetchPostings: fetchHimalayasJobs,
    },
    {
      key: "linkedin",
      name: "LinkedIn job search",
      summary: "Searches LinkedIn jobs matching your target titles and locations.",
      mode: "credentialed",
      requiredConfiguration: ["SOFTWAREFACTORY_LINKEDIN_CLIENT_ID", "SOFTWAREFACTORY_LINKEDIN_CLIENT_SECRET"],
      configured: configuredIn(env, [
        "SOFTWAREFACTORY_LINKEDIN_CLIENT_ID",
        "SOFTWAREFACTORY_LINKEDIN_CLIENT_SECRET",
      ]),
    },
  ];
}
