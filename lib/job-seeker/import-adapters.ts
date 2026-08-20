/**
 * Job import adapters: the architecture for discovery beyond manual entry.
 *
 * An adapter is a typed contract — fetch postings from a source, normalized
 * into the exact shape `job_seeker_jobs` stores, attributed by `source`. The
 * registry below names each adapter this design anticipates and EXACTLY what
 * configuration it needs to exist. None of it is configured, and the truthful
 * consequence runs through the whole stack: `configured: false` here, "Not
 * Connected" on the page, and no code path that could record a job from a
 * source that never answered.
 *
 * When a credential arrives, an adapter gains a `fetchJobs` implementation
 * and its `configured` flips by detection (the named variable exists), never
 * by assertion.
 */

export type ImportedJob = Readonly<{
  externalId: string;
  url: string;
  title: string;
  company: string;
  salaryText: string | null;
  location: string | null;
  workModel: "remote" | "hybrid" | "onsite" | null;
  description: string | null;
}>;

export type JobImportAdapter = Readonly<{
  /** The `source` value recorded on every job this adapter imports. */
  key: string;
  name: string;
  /** What this adapter reads once configured. */
  summary: string;
  /** The exact configuration that must exist before this adapter is real. */
  requiredConfiguration: readonly string[];
  /** True only when the named configuration is actually present. */
  configured: boolean;
  /**
   * Present only on a configured adapter. Its absence is what makes an
   * unconfigured adapter incapable of inventing jobs: there is nothing to
   * call.
   */
  fetchJobs?: (query: Readonly<{ titles: readonly string[]; locations: readonly string[] }>) => Promise<readonly ImportedJob[]>;
}>;

function configuredIn(env: NodeJS.ProcessEnv, names: readonly string[]): boolean {
  return names.every((name) => Boolean(env[name]?.trim()));
}

/**
 * The registry, evaluated against the live environment. No adapter ships a
 * fetch implementation yet — each needs its provider's API credential and a
 * reviewed integration — so `configured` is currently false everywhere by
 * detection, and the console says so.
 */
export function listImportAdapters(env: NodeJS.ProcessEnv = process.env): readonly JobImportAdapter[] {
  return [
    {
      key: "greenhouse",
      name: "Greenhouse job boards",
      summary: "Reads public postings from a company's Greenhouse board.",
      requiredConfiguration: ["SOFTWAREFACTORY_GREENHOUSE_BOARDS"],
      configured: configuredIn(env, ["SOFTWAREFACTORY_GREENHOUSE_BOARDS"]),
    },
    {
      key: "lever",
      name: "Lever postings",
      summary: "Reads public postings from a company's Lever site.",
      requiredConfiguration: ["SOFTWAREFACTORY_LEVER_SITES"],
      configured: configuredIn(env, ["SOFTWAREFACTORY_LEVER_SITES"]),
    },
    {
      key: "linkedin",
      name: "LinkedIn job search",
      summary: "Searches LinkedIn jobs matching your target titles and locations.",
      requiredConfiguration: ["SOFTWAREFACTORY_LINKEDIN_CLIENT_ID", "SOFTWAREFACTORY_LINKEDIN_CLIENT_SECRET"],
      configured: configuredIn(env, [
        "SOFTWAREFACTORY_LINKEDIN_CLIENT_ID",
        "SOFTWAREFACTORY_LINKEDIN_CLIENT_SECRET",
      ]),
    },
  ];
}
