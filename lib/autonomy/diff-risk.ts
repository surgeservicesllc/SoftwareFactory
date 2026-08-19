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
 * Content that widens autonomous authority.
 *
 * `policies/RISK_CLASSIFICATION.md` lists "enabling or widening autonomous
 * approval, merge, deploy, or rollback authority" as RED. Without this the
 * classifier would score a migration that flips `auto_merge` to true as an
 * ordinary schema change — YELLOW — which is precisely the case the whole
 * control model exists to prevent. A loop must never be able to grant itself
 * more power through a change it classified as routine.
 */
const AUTHORITY_WIDENING = [
  /\bauto_(plan|code|test|repair|review|approve|merge|deploy|rollback)\s*(=|:)\s*true\b/i,
  /\bautonomous_mode\s*(=|:)\s*true\b/i,
  /\bautonomy_kill_switch_active\s*(=|:)\s*false\b/i,
  /\bmaximum_autonomous_risk\s*(=|:)\s*'?(yellow|red)'?/i,
  /\bdrop\s+constraint[^;]*green_observation_only/i,
  /\bautonomous_operations_stopped\s*(=|:)\s*false\b/i,
];

/**
 * Content that destroys audit evidence. Deleting the record of what happened
 * is listed separately from destroying production data because it is worse:
 * it removes the ability to find out what was destroyed.
 */
const AUDIT_EVIDENCE_DESTRUCTION = [
  /\b(drop|truncate)\s+table\s+[a-z_.]*\b(audit|activity_events|autonomy_decisions|operations_audit)/i,
  /\bdelete\s+from\s+[a-z_.]*\b(audit|activity_events|autonomy_decisions|operations_audit)/i,
  /\bdrop\s+trigger[^;]*append_only/i,
  // Disabling an append-only trigger removes immutability just as dropping it
  // does, and leaves the trigger in place to suggest otherwise. Dropping was
  // listed and disabling was not, which is an inconsistency in this rule rather
  // than a judgement that one is safer.
  /\bdisable\s+trigger[^;]*append_only/i,
  /\balter\s+table[^;]*\b(audit|activity_events|autonomy_decisions|operations_audit)[^;]*\bdisable\s+trigger\b/i,
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
  // `no force` weakens row-level security exactly as `disable` does: it lets
  // the table owner bypass its own policies. It was missing while `disable`
  // was listed, so the more obscure spelling of the same act scored YELLOW --
  // and this repository's invariant is FORCE RLS on every exposed table, so
  // the obscure spelling is the one worth catching.
  /\bno\s+force\s+row\s+level\s+security\b/i,
  /\bdrop\s+policy\b/i,
];

/**
 * Grants that widen what an unauthenticated caller may do.
 *
 * `tests/integration/schema-security-invariants.test.ts` asserts that `anon`
 * holds no write privilege on any table in the schema. A migration that grants
 * one is a deliberate reversal of that invariant, and reversing an invariant is
 * the owner's decision rather than a routine schema change.
 */
const ANONYMOUS_ACCESS_WIDENING = [
  /\bgrant\b[^;]*\bto\b[^;]*\banon\b/i,
  /\balter\s+default\s+privileges\b[^;]*\bto\b[^;]*\banon\b/i,
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
    factor: "privileged-access",
    reason: "Enables or widens autonomous approval, merge, deploy, or rollback authority.",
    matches: (file) =>
      (file.addedLines ?? []).some((line) => AUTHORITY_WIDENING.some((m) => m.test(line))) ||
      /(^|\/)lib\/autonomy\/controls\.ts$/.test(file.path),
  },
  {
    factor: "privileged-access",
    reason: "Grants an unauthenticated role access it does not currently hold.",
    matches: (file) =>
      (file.addedLines ?? []).some((line) => ANONYMOUS_ACCESS_WIDENING.some((m) => m.test(line))),
  },
  {
    factor: "destructive-production-data",
    reason: "Destroys or unprotects audit evidence.",
    matches: (file) =>
      (file.addedLines ?? []).some((line) => AUDIT_EVIDENCE_DESTRUCTION.some((m) => m.test(line))),
  },
  {
    factor: "authentication-or-security-controls",
    reason: "Changes authentication, authorization, encryption, audit policy, or row-level security.",
    matches: path(
      /(^|\/)(auth|middleware|proxy)\b|row_level_security|(^|\/)lib\/supabase\/|(^|\/)(encryption|crypto|audit-policy)\b/i,
    ),
  },
  {
    factor: "destructive-production-data",
    reason: "Changes backup, retention, or recovery controls.",
    matches: path(/(^|\/)(backups?|retention|recovery)\//i),
  },
  {
    factor: "authentication-or-security-controls",
    reason: "Changes a repository or deployment policy document.",
    matches: path(/^(policies|AGENTS\.md|CLAUDE\.md)/),
  },
  {
    factor: "safety-relevant-memory",
    reason: "Changes recorded architecture or policy decisions.",
    // `policies/PROTECTED_RESOURCES.md` lists "safety-relevant AI memory" among
    // the paths requiring elevated review, and prohibits an automated system
    // from weakening its own guardrails. The decision log is where those
    // guardrails are recorded, so editing it is not documentation-only — an
    // otherwise-GREEN diff could delete the ADR that requires owner approval.
    //
    // YELLOW rather than RED is the policy's own wording: documentation-only
    // clarification "may be GREEN/YELLOW", and only a semantic reduction in
    // protection is RED. Enhanced gates and a security-agent review apply; an
    // owner signature does not. The status memory — current state, handoff,
    // roadmap, backlog, scorecard — stays documentation-only, because every
    // material change is required to update it and pinning it above GREEN
    // would mean no change could ever complete.
    matches: path(/^AI\/DECISIONS\.md$/),
  },
  {
    factor: "dns-or-domain-ownership",
    reason: "Changes domain, DNS, TLS, or hosting routing configuration.",
    matches: path(/(^|\/)(vercel|netlify)\.json$|(^|\/)(dns|domains?|tls|certs?|certificates)\//i),
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
