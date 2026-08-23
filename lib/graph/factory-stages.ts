import { SDLC_STAGES, type SdlcStage } from "@/lib/sdlc/lifecycle";

/**
 * The ten stages the owner's boards name, over the eleven the database holds.
 *
 * These are not a second vocabulary. `sdlc_stage` is the stored truth and every
 * page still reads it; this is what a person is shown — the numbering and the
 * wording from the ten-step boards, which say BUILD where the database says
 * IMPLEMENTATION and DEPLOY where it says DEPLOYMENT.
 *
 * One stage covers two: REQUIREMENT is GOAL and PRD together, which is exactly
 * the presentation ADR-136 prescribed when it mapped the ten onto the eight.
 * The other nine are renames, and after ADR-137 grew the enum, DISCOVER,
 * EVALUATE and DECIDE have real stages behind them rather than being dormant.
 *
 * `covers` is the whole reason this is data rather than a label lookup: a page
 * for REQUIREMENT has to read two stages' nodes, and nothing else in the
 * system should have to know which those are.
 */
export type FactoryStage = {
  /** 1 through 10, as the boards number them. */
  readonly number: number;
  /** The URL segment: `requirement`, `build`, `deploy`. */
  readonly slug: string;
  /** What the boards call it. */
  readonly name: string;
  /** One line, in the plain language the goal document asks for. */
  readonly purpose: string;
  /** The stored stages this presents. Never empty. */
  readonly covers: readonly SdlcStage[];
};

export const FACTORY_STAGES: readonly FactoryStage[] = [
  {
    number: 1,
    slug: "requirement",
    name: "Requirement",
    purpose: "Turn one plain-English request into an objective, scope and acceptance criteria.",
    // The one stage that is two: the request, and the structured requirement
    // it becomes.
    covers: ["GOAL", "PRD"],
  },
  {
    number: 2,
    slug: "discover",
    name: "Discover",
    purpose: "Find what already exists — internal code, packages, APIs — before building anything.",
    covers: ["DISCOVERY"],
  },
  {
    number: 3,
    slug: "evaluate",
    name: "Evaluate",
    purpose: "Score the candidates on licence, security, maintenance and fit.",
    covers: ["EVALUATION"],
  },
  {
    number: 4,
    slug: "decide",
    name: "Decide",
    purpose: "Choose to use, connect, adapt, fork or build, and record why.",
    covers: ["DECISION"],
  },
  {
    number: 5,
    slug: "architect",
    name: "Architect",
    purpose: "Design the integration: contracts, data flow, security and the task graph.",
    covers: ["ARCHITECTURE"],
  },
  {
    number: 6,
    slug: "build",
    name: "Build",
    purpose: "Implement the work — code, migrations, adapters, tests.",
    covers: ["IMPLEMENTATION"],
  },
  {
    number: 7,
    slug: "review",
    name: "Review",
    purpose: "Inspect it independently: correctness, security, quality, coverage.",
    covers: ["REVIEW"],
  },
  {
    number: 8,
    slug: "test",
    name: "Test",
    purpose: "Run the tests that decide whether it is safe to release.",
    covers: ["TEST"],
  },
  {
    number: 9,
    slug: "deploy",
    name: "Deploy",
    purpose: "Release it, apply migrations, and verify health afterwards.",
    covers: ["DEPLOYMENT"],
  },
  {
    number: 10,
    slug: "monitor",
    name: "Monitor",
    purpose: "Watch it run, and turn what is found into the next cycle of work.",
    covers: ["MONITORING"],
  },
];

/** The board stage a URL segment names, or null. Case-insensitive. */
export function factoryStageBySlug(slug: string): FactoryStage | null {
  const wanted = slug.trim().toLowerCase();
  return FACTORY_STAGES.find((stage) => stage.slug === wanted) ?? null;
}

/**
 * The board stage a stored stage belongs to.
 *
 * Exhaustive by construction — the test holds every `SdlcStage` to exactly one
 * board stage, so a stage added to the enum without a home here fails there
 * rather than disappearing from the ten pages.
 */
export function factoryStageFor(stage: SdlcStage): FactoryStage | null {
  return FACTORY_STAGES.find((candidate) => candidate.covers.includes(stage)) ?? null;
}

/** Every stored stage, in board order — the order a person reads them in. */
export function stagesInFactoryOrder(): readonly SdlcStage[] {
  const ordered = FACTORY_STAGES.flatMap((stage) => stage.covers);
  // A stored stage with no board home would silently vanish from any list
  // built here; the test forbids that, and this keeps the two in step.
  return ordered.filter((stage) => (SDLC_STAGES as readonly string[]).includes(stage));
}
