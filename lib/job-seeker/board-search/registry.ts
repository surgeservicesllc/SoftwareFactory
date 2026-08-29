import { arbeitnowAdapter } from "@/lib/job-seeker/board-search/arbeitnow";
import { freehireAdapter } from "@/lib/job-seeker/board-search/freehire";
import { himalayasAdapter } from "@/lib/job-seeker/board-search/himalayas";
import { jobicyAdapter } from "@/lib/job-seeker/board-search/jobicy";
import { remoteokAdapter } from "@/lib/job-seeker/board-search/remoteok";
import { remotiveAdapter } from "@/lib/job-seeker/board-search/remotive";
import { weworkremotelyAdapter } from "@/lib/job-seeker/board-search/weworkremotely";
import { jobdanmarkAdapter } from "@/lib/job-seeker/board-search/jobdanmark";
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
 *
 * ## Jobbank is absent because it does not work, by its own author's account
 *
 * `.agents/skills/jobbank-search` carries this in its fetch helper:
 *
 *   "Jobbank is blocking automated requests with Cloudflare bot protection.
 *    Skip this portal or use the WebSearch fallback."
 *
 * A board in this list is a board a person can tick and expect an answer
 * from. One that answers with a bot challenge would fail on nearly every
 * search, and a permanently failing entry teaches people to ignore the
 * failure notice — which is the notice that has to work when a board that
 * usually answers stops. If Jobbank's protection changes, it can be added.
 *
 */
export const BOARD_SEARCH_ADAPTERS: readonly BoardSearchAdapter[] = Object.freeze([
  jobnetAdapter,
  jobindexAdapter,
  jobdanmarkAdapter,
  freehireAdapter,
  // The 2026-08-29 expansion (active JobSearch goal): boards whose published
  // integration surface is an open JSON API or official RSS feed. Each one
  // was probed live before its parser was written, and each parser is pinned
  // against a captured sample. Same membership rule as ever: a board in this
  // list is a board that will genuinely be queried.
  remotiveAdapter,
  remoteokAdapter,
  jobicyAdapter,
  himalayasAdapter,
  arbeitnowAdapter,
  weworkremotelyAdapter,
]);

export function boardSearchAdapter(key: string): BoardSearchAdapter | null {
  return BOARD_SEARCH_ADAPTERS.find((adapter) => adapter.key === key) ?? null;
}

/** Every board key, for validating what a request asked for. */
export function boardSearchKeys(): readonly string[] {
  return BOARD_SEARCH_ADAPTERS.map((adapter) => adapter.key);
}
