import { classifyRisk, compareRisk, type RiskClassification, type RiskFactor } from "@/lib/risk";

/**
 * Classify a concrete diff, rather than a hand-supplied list of factors.
 *
 * `classifyRisk` answers "given these factors, how risky is this?". It cannot
 * answer "what factors does this change actually have?", so every caller so far
 * has had to assert its own risk. That is exactly the judgement an autonomous
 * loop must not be trusted to make about itself, so this module derives the
 * factors from the changed paths instead.
 *
 * The rules are deliberately blunt and ordered most-dangerous-first. A path that
 * matches nothing contributes no factor, and a diff that contributes no factor at
 * all falls through to `classifyRisk`'s YELLOW default: an unrecognised change is
 * not evidence of a safe one.
 */

export interface DiffFile {
  readonly path: string;
  /** Present only for content-sensitive rules; absent input never lowers risk. */
  readonly addedLines?: readonly string[];
}

export interface DiffRiskAssessment extends RiskClassification {
  /** Human-readable reason per factor, so a decision can be explained. */
  readonly reasons: readonly string[];
  /** Paths that drove the classification, deduplicated and sorted. */
  readonly triggeringPaths: readonly string[];
}

interface Rule {
  readonly factor: RiskFactor;
  readonly reason: string;
  readonly matches: (file: DiffFile) => boolean;
}

const path = (test: RegExp) => (file: DiffFile) => test.test(file.path);

/**
 * Content markers for a credential-shaped addition.
 *
 * These match the *shape* of a secret, not any real value. A hit means the diff
 * carries something that looks like a live credential and must not be judged
 * automatically.
 */
const SECRET_MARKERS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /SERVICE_ROLE_KEY\s*[:=]\s*["'][^"'\s]{8,}/i,
];

/**
 * Destructive schema verbs. `drop table`, `truncate`, and a non-additive column
 * drop cannot be walked back by re-running a migration, so they are RED even
 * though an ordinary migration is only YELLOW.
 */
const DESTRUCTIVE_SQL = [
  /\bdrop\s+(table|schema|database|column|type)\b/i,
  /\btruncate\s+table\b/i,
  /\bdelete\s+from\b(?![^;]*\bwhere\b)/i,
  /\bdisable\s+row\s+level\s+security\b/i,
  /\bdrop\s+policy\b/i,
];

/** Ordered most dangerous first; every matching rule contributes its factor. */
const RULES: readonly Rule[] = [
  {
    factor: "secrets-or-credentials",
    reason: "Adds content shaped like a credential, key, or token.",
    matches: (file) => (file.addedLines ?? []).some((line) => SECRET_MARKERS.some((m) => m.test(line))),
  },
  {
    factor: "secrets-or-credentials",
    reason: "Touches an environment or secret-bearing file.",
    matches: path(/(^|\/)\.env(\.|$)|(^|\/)secrets?\//i),
  },
  {
    factor: "destructive-production-data",
    reason: "Contains a destructive or irreversible SQL statement.",
    matches: (file) => (file.addedLines ?? []).some((line) => DESTRUCTIVE_SQL.some((m) => m.test(line))),
  },
  {
    factor: "authentication-or-security-controls",
    reason: "Changes authentication, authorization, or row-level security.",
    matches: path(/(^|\/)(auth|middleware|proxy)\b|row_level_security|(^|\/)lib\/supabase\//i),
  },
  {
    factor: "authentication-or-security-controls",
    reason: "Changes a repository or deployment policy document.",
    matches: path(/^(policies|AGENTS\.md|CLAUDE\.md)/),
  },
  {
    factor: "dns-or-domain-ownership",
    reason: "Changes domain, DNS, or hosting routing configuration.",
    matches: path(/(^|\/)(vercel|netlify)\.json$|(^|\/)(dns|domains?)\//i),
  },
  {
    factor: "privileged-access",
    reason: "Changes a privileged workflow or CI permission surface.",
    matches: path(/^\.github\//),
  },
  {
    factor: "money-or-billing",
    reason: "Changes billing, payment, or subscription handling.",
    matches: path(/(^|\/)(billing|payments?|stripe|checkout|subscriptions?)\b/i),
  },
  {
    factor: "non-destructive-schema-change",
    reason: "Adds or alters database schema.",
    matches: path(/(^|\/)supabase\/migrations\//),
  },
  {
    factor: "dependency-change",
    reason: "Changes dependencies or the lockfile.",
    matches: path(/(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/),
  },
  {
    factor: "reversible-production-configuration",
    reason: "Changes build, runtime, or type configuration.",
    matches: path(/(^|\/)(next|tsconfig|eslint|vitest|playwright|postcss|tailwind)\.[a-z.]*(json|ts|js|mjs|cjs)$/i),
  },
  {
    factor: "application-behavior",
    reason: "Changes server-side application behavior.",
    matches: path(/^(app\/api|lib)\/.*\.(ts|tsx)$/),
  },
  {
    factor: "isolated-reversible-ui",
    reason: "Changes presentation only.",
    matches: path(/^(components|app)\/.*\.(tsx|css)$/),
  },
  {
    factor: "test-only",
    reason: "Changes tests only.",
    matches: path(/^tests\/|\.(test|spec)\.[jt]sx?$/),
  },
  {
    factor: "documentation-only",
    reason: "Changes documentation only.",
    matches: path(/\.mdx?$|^(AI|docs)\//),
  },
];

/**
 * Derive a risk classification from the files a change touches.
 *
 * An empty diff is YELLOW, not GREEN: nothing to inspect is not the same as
 * nothing to worry about, and `classifyRisk` already encodes that default.
 */
export function assessDiffRisk(files: readonly DiffFile[]): DiffRiskAssessment {
  const factors: RiskFactor[] = [];
  const reasons: string[] = [];
  const triggeringPaths = new Set<string>();

  for (const rule of RULES) {
    const matched = files.filter((file) => rule.matches(file));
    if (matched.length === 0) continue;

    if (!factors.includes(rule.factor)) factors.push(rule.factor);
    if (!reasons.includes(rule.reason)) reasons.push(rule.reason);
    for (const file of matched) triggeringPaths.add(file.path);
  }

  const classification = classifyRisk(factors);

  return Object.freeze({
    ...classification,
    reasons: Object.freeze(
      reasons.length ? reasons : ["No recognised change signal; defaulted to the safe level."],
    ),
    triggeringPaths: Object.freeze([...triggeringPaths].sort()),
  });
}

/**
 * Compare the risk declared when work started against the risk the finished
 * diff actually carries.
 *
 * The loop classifies twice on purpose. Work that starts GREEN and ends up
 * touching a migration must not inherit its opening classification, so an
 * escalation is reported explicitly rather than folded into the result.
 */
export function reclassifyAgainstDeclared(
  declared: RiskClassification["level"],
  files: readonly DiffFile[],
): {
  readonly assessment: DiffRiskAssessment;
  /** The finished diff is riskier than declared; the opening class is void. */
  readonly escalated: boolean;
  /** The finished diff is safer. Reported, but it never widens authority. */
  readonly deescalated: boolean;
} {
  const assessment = assessDiffRisk(files);
  const delta = compareRisk(assessment.level, declared);
  return Object.freeze({
    assessment,
    escalated: delta > 0,
    deescalated: delta < 0,
  });
}
