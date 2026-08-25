import { jobindexAdapter } from "@/lib/job-seeker/board-search/jobindex";
import { jobnetAdapter } from "@/lib/job-seeker/board-search/jobnet";
import type { BoardSearchAdapter } from "@/lib/job-seeker/board-search/types";

/**
 * The boards Search can actually read.
 *
 * Membership here is the claim that an adapter works, so a board joins this
 * list when its `search` really calls it and parses the answer — never as a
 * placeholder. The page renders this registry, which means a board a person
 * can tick is a board that will be queried.
 *
 * ## LinkedIn is deliberately absent
 *
 * The source repository ships `.agents/skills/linkedin-search`, and it is not
 * ported. Two independent reasons, either sufficient:
 *
 * 1. LinkedIn's terms prohibit automated collection. The MIT licence on the
 *    source settles whether the code may be copied, not whether the service
 *    may be read this way, and those are different permissions from different
 *    parties.
 * 2. This repository already decided the question. `import-adapters.ts`
 *    carries a LinkedIn adapter with no `fetchPostings` at all, on the stated
 *    grounds that "an unconfigured adapter is incapable of inventing jobs
 *    because there is nothing to call". Adding a scraper here would overturn
 *    that from a different file rather than by revisiting the decision.
 *
 * If LinkedIn is ever wanted, the route is a credentialed integration under
 * the existing import-adapter rules, not this list.
 */
export const BOARD_SEARCH_ADAPTERS: readonly BoardSearchAdapter[] = Object.freeze([
  jobnetAdapter,
  jobindexAdapter,
]);

export function boardSearchAdapter(key: string): BoardSearchAdapter | null {
  return BOARD_SEARCH_ADAPTERS.find((adapter) => adapter.key === key) ?? null;
}

/** Every board key, for validating what a request asked for. */
export function boardSearchKeys(): readonly string[] {
  return BOARD_SEARCH_ADAPTERS.map((adapter) => adapter.key);
}
