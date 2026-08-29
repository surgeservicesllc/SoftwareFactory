import { GRAPH_TEMPLATES, type GraphTemplate } from "@/lib/graph/templates";

/**
 * The Chief of Staff: what a person asked for, turned into how it will run.
 *
 * ## What this does, and the line it refuses to cross
 *
 * It classifies intent, chooses the plan shape that intent deserves, and
 * records the constraints the request *actually stated*. It does not author
 * requirements, and that restraint is the whole design.
 *
 * The temptation here is to emit a tidy list — "must support user login, must
 * be mobile responsive, must handle payments" — from a sentence that said none
 * of those things. That reads impressively and is fabrication: acceptance
 * criteria nobody agreed to, presented as though they came from the person who
 * typed the request. Requirements are authored by the REQUIREMENT stage at run
 * time, by a model that has the goal in front of it, and that stage's output is
 * a real artifact with a real contract. This module hands that stage a
 * well-framed brief and gets out of the way.
 *
 * So everything below is derived from the text by rules a reader can check.
 * `statedConstraints` quotes the request; it never paraphrases it into a
 * requirement.
 *
 * ## Why classification is rules rather than a model
 *
 * Routing must work before a provider credential exists, must be identical on
 * two identical requests, and must be explainable — "matched *build*, on the
 * word 'build'" is a sentence a person can argue with. A model deciding which
 * template to run would be a non-deterministic choice with no audit trail, made
 * before the run that would have recorded it.
 */

export type BuildIntent =
  | "build"
  | "fix"
  | "audit"
  | "migrate"
  | "review"
  | "investigate"
  | "improve";

export type PlanShape = "full_lifecycle" | "feature_build" | "targeted";

/** One reason the classifier decided what it decided, quoting the request. */
export type IntentSignal = Readonly<{
  intent: BuildIntent;
  /** The matched text, verbatim, so a person can see what triggered it. */
  matched: string;
}>;

export type ChiefOfStaffPlan = Readonly<{
  goal: string;
  intent: BuildIntent;
  shape: PlanShape;
  templateKey: string;
  /** Why this template, in a sentence a non-technical person can read. */
  rationale: string;
  signals: readonly IntentSignal[];
  /**
   * Constraints the request itself stated, quoted rather than invented. Empty
   * is the ordinary case and must render as "none stated" rather than as a
   * gap — most people describe what they want, not how it must be built.
   */
  statedConstraints: readonly string[];
  /**
   * True when the request describes a whole product rather than a change to
   * one. Whole products get the ten-phase path; changes do not need it.
   */
  wholeProduct: boolean;
}>;

/*
 * Ordered most specific to least. First match wins, and the order is the
 * policy: "fix the migration that broke" is a fix, not a migration, because
 * the failure is what the person is asking about.
 */
const INTENT_RULES: ReadonlyArray<readonly [RegExp, BuildIntent]> = [
  /*
   * "broke" and "broken" are different words and people type both. Missing the
   * past tense sent "fix the migration that broke last night" to the
   * schema-change path — a failure routed as planned work, which is the wrong
   * shape of run and the wrong set of gates.
   */
  [/\b(bug|broke|broken|crash|crashed|defect|fail(?:s|ed|ing)?|regression|not working|doesn'?t work)\b/i, "fix"],
  [/\b(incident|outage|postmortem|root cause)\b/i, "investigate"],
  [/\b(audit|review|assess|evaluate)\b/i, "audit"],
  [/\b(migrat|schema change|backfill)\w*/i, "migrate"],
  [/\b(refactor|clean ?up|tidy|simplify|optimi[sz]e)\b/i, "improve"],
  [/\b(build|create|make|develop|implement|add|ship|launch)\b/i, "build"],
];

/**
 * Words that describe a product rather than a change to one.
 *
 * "Build me an app" is a whole product; "add a button" is not, even though
 * both match *build*. The distinction decides whether the ten-phase lifecycle
 * is warranted, and running it for a one-line change would put a person
 * through discovery and architecture gates to move a button.
 */
const WHOLE_PRODUCT = /\b(app|application|platform|product|site|website|system|saas|portal|dashboard|marketplace|tool)\b/i;

/** A change scoped to something that already exists. */
const SCOPED_CHANGE = /\b(button|field|column|endpoint|route|page|link|label|copy|typo|test|log)\b/i;

export function classifyIntent(goal: string): { intent: BuildIntent; signals: IntentSignal[] } {
  const signals: IntentSignal[] = [];
  for (const [pattern, intent] of INTENT_RULES) {
    const match = pattern.exec(goal);
    if (match) signals.push({ intent, matched: match[0] });
  }
  return { intent: signals[0]?.intent ?? "build", signals };
}

/**
 * Constraints the request stated, quoted.
 *
 * Deliberately narrow: a named technology, a named deadline, a named platform.
 * A sentence fragment is quoted whole so nothing is put in the requester's
 * mouth. If the rules find nothing, that is the honest answer.
 */
export function statedConstraints(goal: string): string[] {
  const found: string[] = [];
  const patterns: readonly RegExp[] = [
    /\b(?:using|with|in|on)\s+(react|next\.?js|vue|svelte|python|django|rails|node|postgres|supabase|typescript|tailwind|stripe|firebase)\b/gi,
    /\b(?:must|should|needs? to)\s+[^.,;]{3,80}/gi,
    /\bby\s+(?:tomorrow|next week|friday|monday|end of (?:day|week|month))\b/gi,
    /\b(?:mobile|responsive|offline|accessible|multi-?tenant|real-?time)\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of goal.matchAll(pattern)) {
      const text = match[0].trim();
      if (text.length > 0 && !found.includes(text)) found.push(text);
    }
  }
  return found.slice(0, 12);
}

const TARGETED_TEMPLATE: Readonly<Record<BuildIntent, string>> = Object.freeze({
  fix: "bug_sweep",
  investigate: "incident_investigation",
  audit: "production_readiness",
  migrate: "database_migration",
  review: "code_review",
  improve: "refactor_sweep",
  build: "feature_build",
});

function templateExists(key: string): boolean {
  return GRAPH_TEMPLATES.some((template) => template.key === key);
}

/**
 * The plan for a goal.
 *
 * The one routing decision that did not exist before: a request describing a
 * whole product gets `full_lifecycle`. That template — ten phases, goal through
 * deployment health — was previously unreachable by intent. No keyword routed
 * to it, so the only way to run the repository's most complete path was to know
 * its key and ask for it directly.
 */
export function planForGoal(goal: string): ChiefOfStaffPlan {
  const trimmed = goal.trim();
  const { intent, signals } = classifyIntent(trimmed);

  const wholeProduct =
    intent === "build" && WHOLE_PRODUCT.test(trimmed) && !SCOPED_CHANGE.test(trimmed);

  let shape: PlanShape;
  let templateKey: string;
  let rationale: string;

  if (wholeProduct) {
    shape = "full_lifecycle";
    templateKey = "full_lifecycle";
    rationale =
      "This describes a whole product, so it runs the ten-phase path: state the goal, look before building, choose and design, build, review, test, deploy, and check the deployment is healthy.";
  } else if (intent === "build") {
    shape = "feature_build";
    templateKey = "feature_build";
    rationale =
      "This describes a change to something that already exists, so it runs the build path rather than the ten-phase product lifecycle.";
  } else {
    shape = "targeted";
    templateKey = TARGETED_TEMPLATE[intent];
    rationale = `This reads as ${intent} work, so it runs the ${templateKey.replaceAll("_", " ")} path.`;
  }

  /*
   * A template named here but absent from the registry would plan a run that
   * cannot start. Falling back to feature_build keeps the request runnable and
   * says so, rather than failing at launch with a key nobody typed.
   */
  if (!templateExists(templateKey)) {
    templateKey = "feature_build";
    shape = "feature_build";
    rationale = `${rationale} The preferred template is not registered in this deployment, so the general build path runs instead.`;
  }

  return {
    goal: trimmed,
    intent,
    shape,
    templateKey,
    rationale,
    signals,
    statedConstraints: statedConstraints(trimmed),
    wholeProduct,
  };
}

/** The chosen template, or null when the registry does not hold it. */
export function templateForPlan(plan: ChiefOfStaffPlan): GraphTemplate | null {
  return GRAPH_TEMPLATES.find((template) => template.key === plan.templateKey) ?? null;
}
