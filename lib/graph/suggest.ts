import { GRAPH_TEMPLATES, type GraphTemplate } from "@/lib/graph/templates";

/**
 * Suggest a pipeline template for a plain-language goal, by keyword. The
 * suggestion is informational: the Phase 1C worker executes the goal as
 * written, so the composer labels it as a suggestion rather than a binding
 * choice. First match wins; the order runs from the most specific intent to
 * the most general.
 */
const KEYWORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bmigrat/i, "database_migration"],
  [/\brls\b|row.level.security/i, "rls_audit"],
  [/\bsecurit|vulnerab|penetration\b/i, "security_audit"],
  [/\bseo\b|\baeo\b|search engine/i, "seo_aeo_audit"],
  [/\bmobile\b|responsive|viewport/i, "mobile_audit"],
  [/\bperformance|\bslow\b|latenc|optimi[sz]e speed/i, "performance_audit"],
  [/\btest coverage|\btests?\b.*\b(add|write|missing)\b|\bcoverage\b/i, "test_coverage"],
  [/\brefactor|clean.?up|dead code|duplicat/i, "refactor_sweep"],
  [/\bdependenc(y|ies)\b.*\b(audit|update|upgrade)\b|\bupgrade\b.*\bdependenc/i, "dependency_audit"],
  [/\breview\b.*\b(code|pr|pull request)\b|\bcode review\b/i, "code_review"],
  [/\bincident|outage|rollback|production (failure|down)/i, "incident_investigation"],
  [/\b(bug|fix|broken|error|crash|defect)\b/i, "bug_sweep"],
  [/\bproduction.?read|go.?live|launch checklist/i, "production_readiness"],
  [/\baudit\b/i, "production_readiness"],
];

export function suggestTemplateForGoal(goal: string): GraphTemplate | null {
  for (const [pattern, key] of KEYWORDS) {
    if (pattern.test(goal)) {
      return GRAPH_TEMPLATES.find((template) => template.key === key) ?? null;
    }
  }
  // Anything else reads as building something new.
  return GRAPH_TEMPLATES.find((template) => template.key === "feature_build") ?? null;
}
