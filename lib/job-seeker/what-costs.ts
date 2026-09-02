import { normalizeIdentity } from "@/lib/job-seeker/board-search/unify";

/**
 * What keeps costing you (ADR-245): two questions no board answers, both
 * computed from the person's own recorded rows.
 *
 * The skills gap: which terms the postings you record keep naming that
 * your profile does not list, ranked by how many postings name them. The
 * vocabulary is a fixed list of tools, languages and disciplines, so a
 * "gap" is always a recognisable thing to record or learn — never a stray
 * word from a job description — and every row prints its counts.
 *
 * Company memory: what happened the last time you dealt with this
 * employer, said from your own applications — the boards show company
 * reviews written by strangers; this shows your own record.
 */

export const SKILL_VOCABULARY: readonly string[] = [
  // Languages and runtimes
  "TypeScript", "JavaScript", "Python", "Java", "Kotlin", "Swift", "Go", "Rust", "C#", "C++", "Ruby", "PHP", "Scala", "SQL", "R", "Node.js",
  // Frameworks and libraries
  "React", "Next.js", "Vue", "Angular", "Svelte", "Django", "Flask", "FastAPI", "Spring", "Rails", ".NET", "Express", "GraphQL", "REST",
  // Data and infrastructure
  "PostgreSQL", "MySQL", "MongoDB", "Redis", "Elasticsearch", "Kafka", "RabbitMQ", "Snowflake", "BigQuery", "Redshift", "dbt", "Airflow", "Spark", "Hadoop",
  "AWS", "Azure", "GCP", "Google Cloud", "Kubernetes", "Docker", "Terraform", "Ansible", "Helm", "Linux", "CI/CD", "GitHub Actions", "Jenkins",
  "Supabase", "Firebase", "Vercel", "Serverless", "Microservices",
  // Data science and AI
  "Machine Learning", "Deep Learning", "TensorFlow", "PyTorch", "Pandas", "NumPy", "scikit-learn", "LLM", "NLP", "Computer Vision", "Data Science", "Statistics",
  // Product, design, delivery
  "Figma", "Sketch", "Jira", "Confluence", "Agile", "Scrum", "Kanban", "Product Management", "Roadmap", "A/B Testing", "User Research", "UX", "UI",
  "Accessibility", "WCAG", "Design Systems",
  // Marketing
  "SEO", "SEM", "Google Ads", "Meta Ads", "LinkedIn Ads", "Google Analytics", "GA4", "HubSpot", "Salesforce", "Marketo", "Pardot", "Mailchimp", "Klaviyo",
  "Braze", "Segment", "Looker", "Tableau", "Power BI", "Content Marketing", "Copywriting", "Email Marketing", "Marketing Automation", "CRM", "ABM",
  "Demand Generation", "Lead Generation", "Brand", "PR", "Social Media", "Influencer", "Affiliate", "Growth", "Conversion Rate Optimization", "CRO",
  "Paid Media", "Programmatic", "Webflow", "WordPress", "Shopify", "Canva", "Adobe Creative Suite", "Photoshop", "Illustrator", "Premiere",
  // Operations, sales, finance
  "Excel", "Google Sheets", "SAP", "Oracle", "NetSuite", "QuickBooks", "Zendesk", "ServiceNow", "Workday", "Greenhouse", "Lever",
  "Project Management", "PMP", "Six Sigma", "Lean", "Supply Chain", "Procurement", "Forecasting", "Budgeting", "Compliance", "GDPR", "SOC 2", "ISO 27001",
  // Security and networking
  "Security", "Penetration Testing", "SIEM", "IAM", "OAuth", "Networking", "TCP/IP", "Cloud Security",
  // Languages people speak
  "Spanish", "French", "German", "Danish", "Swedish", "Norwegian", "Dutch", "Portuguese", "Mandarin", "Japanese", "Arabic",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const VOCABULARY_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = SKILL_VOCABULARY.map((term) => [
  term,
  new RegExp(`(?<![\\w.+#])${escapeRegExp(term)}(?![\\w+#])`, "i"),
]);

export type RecordedPosting = Readonly<{
  id: string;
  company: string;
  title: string;
  description: string | null;
  qualified: boolean | null;
  discoveredAt: string;
  application: Readonly<{
    stage: string;
    appliedAt: string | null;
    closedReason: string | null;
  }> | null;
}>;

export type SkillGap = Readonly<{
  term: string;
  /** Postings among the person's recorded jobs that name the term. */
  postings: number;
  /** Of those, the ones the evaluator qualified — the roles you already fit. */
  qualifiedPostings: number;
  /** One sentence with the counts, as the page prints it. */
  sentence: string;
}>;

/** Terms in the vocabulary a text names, once each. */
export function namedSkills(text: string): string[] {
  const named: string[] = [];
  for (const [term, pattern] of VOCABULARY_PATTERNS) {
    if (pattern.test(text)) named.push(term);
  }
  return named;
}

/**
 * The skills gap: vocabulary terms named by the person's recorded postings
 * and absent from the profile, ranked by how many postings name them, then
 * by how many qualified postings do. A term named by one posting is not a
 * pattern and is left out; the threshold is printed on the page.
 */
export const GAP_MINIMUM_POSTINGS = 2;

export function skillsGap(
  postings: readonly RecordedPosting[],
  profileSkills: readonly string[],
  limit = 15,
): SkillGap[] {
  const recorded = new Set(profileSkills.map((skill) => skill.trim().toLowerCase()));
  const counts = new Map<string, { postings: number; qualified: number }>();
  for (const posting of postings) {
    const text = `${posting.title} ${posting.description ?? ""}`;
    for (const term of namedSkills(text)) {
      if (recorded.has(term.toLowerCase())) continue;
      const entry = counts.get(term) ?? { postings: 0, qualified: 0 };
      entry.postings += 1;
      if (posting.qualified === true) entry.qualified += 1;
      counts.set(term, entry);
    }
  }
  return [...counts.entries()]
    .filter(([, entry]) => entry.postings >= GAP_MINIMUM_POSTINGS)
    .sort((a, b) => b[1].postings - a[1].postings || b[1].qualified - a[1].qualified || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, entry]) => ({
      term,
      postings: entry.postings,
      qualifiedPostings: entry.qualified,
      sentence: `${term} — named in ${entry.postings} of your ${postings.length} recorded postings`
        + (entry.qualified > 0 ? ` (${entry.qualified} of them qualified)` : "")
        + "; not in your profile.",
    }));
}

export type CompanyMemory = Readonly<{
  company: string;
  recorded: number;
  applied: number;
  /** The most recent application's outcome, in a sentence. */
  sentence: string;
}>;

const REPLY_STAGES = new Set(["RECRUITER_RESPONSE", "INTERVIEW", "FINAL_INTERVIEW", "OFFER"]);

function days(from: string, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - Date.parse(from)) / 86_400_000));
}

const REASON_WORDS: Readonly<Record<string, string>> = {
  no_response: "closed with no response",
  rejected_before_interview: "rejected before an interview",
  rejected_after_interview: "rejected after an interview",
  withdrew: "you withdrew",
  offer_declined: "you declined the offer",
  position_filled: "the position was filled or cancelled",
  other: "closed",
};

/**
 * Your own history with one employer, from your own rows. Nothing about
 * the company is asserted beyond what you recorded: how many of its
 * postings you kept, how many you applied to, and how the most recent
 * application went.
 */
export function companyMemory(
  postings: readonly RecordedPosting[],
  company: string,
  now: Date = new Date(),
): CompanyMemory | null {
  const key = normalizeIdentity(company, "").split("::")[0]!;
  const mine = postings.filter((posting) => normalizeIdentity(posting.company, "").split("::")[0] === key);
  if (mine.length === 0) return null;
  const applications = mine
    .filter((posting) => posting.application?.appliedAt)
    .sort((a, b) => (b.application!.appliedAt! > a.application!.appliedAt! ? 1 : -1));
  let sentence: string;
  if (applications.length === 0) {
    sentence = `You recorded ${mine.length === 1 ? "one posting" : `${mine.length} postings`} from ${company} and applied to none.`;
  } else {
    const latest = applications[0]!.application!;
    const appliedOn = latest.appliedAt!.slice(0, 10);
    if (latest.stage === "CLOSED") {
      sentence = `You applied to ${company} on ${appliedOn}; ${REASON_WORDS[latest.closedReason ?? "other"] ?? "closed"}.`;
    } else if (REPLY_STAGES.has(latest.stage)) {
      sentence = `You applied to ${company} on ${appliedOn} and heard back (${latest.stage.replaceAll("_", " ").toLowerCase()}).`;
    } else {
      sentence = `You applied to ${company} on ${appliedOn}; no reply in ${days(latest.appliedAt!, now)} days.`;
    }
  }
  return { company, recorded: mine.length, applied: applications.length, sentence };
}
