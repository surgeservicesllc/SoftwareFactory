import { SDLC_STAGES, type SdlcStage } from "@/lib/sdlc/lifecycle";

/**
 * The owner's ten-step vocabulary, mapped onto the eleven lifecycle stages.
 *
 * The navigation and the design boards speak in ten steps — Requirement
 * through Monitor — while the engine records eleven stages. The two are the
 * same process under two groupings: REQUIREMENT covers both GOAL and PRD
 * (capturing what to build and writing it down are one step to a person),
 * and every other step is one stage under the owner's name for it.
 *
 * The mapping is total and exclusive — every stage belongs to exactly one
 * step — which the unit test asserts, so a stage added to `SDLC_STAGES`
 * breaks the build here until someone says which step owns it. That is the
 * point: an unmapped stage would be work the factory pages silently never
 * show.
 */

export type FactoryStep = {
  readonly slug: string;
  readonly number: number;
  readonly title: string;
  /** Lifecycle stages this step reads, in lifecycle order. */
  readonly stages: readonly SdlcStage[];
  readonly summary: string;
};

export const FACTORY_STEPS: readonly FactoryStep[] = Object.freeze([
  {
    slug: "requirement",
    number: 1,
    title: "Requirement",
    stages: ["GOAL", "PRD"],
    summary: "We capture what you want to build, why it matters, and how we will know it's successful.",
  },
  {
    slug: "discover",
    number: 2,
    title: "Discover",
    stages: ["DISCOVERY"],
    summary: "We search everywhere so we can build on what already exists.",
  },
  {
    slug: "evaluate",
    number: 3,
    title: "Evaluate",
    stages: ["EVALUATION"],
    summary: "Every candidate is scored on the same fixed rubric, so runs stay comparable.",
  },
  {
    slug: "decide",
    number: 4,
    title: "Decide",
    stages: ["DECISION"],
    summary: "Use, connect, adapt, fork or build — all five paths weighed, one chosen, with the plan.",
  },
  {
    slug: "architect",
    number: 5,
    title: "Architect",
    stages: ["ARCHITECTURE"],
    summary: "The design a person approves before anything is built on it.",
  },
  {
    slug: "build",
    number: 6,
    title: "Build",
    stages: ["IMPLEMENTATION"],
    summary: "The approved design becomes a change.",
  },
  {
    slug: "review",
    number: 7,
    title: "Review",
    stages: ["REVIEW"],
    summary: "Fresh eyes judge the change and record what they checked.",
  },
  {
    slug: "test",
    number: 8,
    title: "Test",
    stages: ["TEST"],
    summary: "An anchor reads CI's own verdict — the stage cannot be talked into passing.",
  },
  {
    slug: "deploy",
    number: 9,
    title: "Deploy",
    stages: ["DEPLOYMENT"],
    summary: "An externally visible act, owner-gated in Phase 1: the refusal on the record is the honest terminal.",
  },
  {
    slug: "monitor",
    number: 10,
    title: "Monitor",
    stages: ["MONITORING"],
    summary: "A probe of the live surface records what is actually serving.",
  },
]);

export function factoryStep(slug: string): FactoryStep | null {
  const lowered = slug.toLowerCase();
  return FACTORY_STEPS.find((step) => step.slug === lowered) ?? null;
}

/** The step that owns a stage — total by the test's assertion. */
export function stepForStage(stage: SdlcStage): FactoryStep {
  const owner = FACTORY_STEPS.find((step) => step.stages.includes(stage));
  if (!owner) throw new Error(`No factory step owns the ${stage} stage.`);
  return owner;
}

/** Every stage, so the mapping test cannot drift from the vocabulary. */
export const ALL_STAGES: readonly SdlcStage[] = SDLC_STAGES;
