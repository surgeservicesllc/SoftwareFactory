import type { RiskLevel } from "@/lib/risk";

/**
 * Provider catalog for the bot fabric.
 *
 * This module is browser-safe on purpose: it holds only public, non-secret
 * metadata used to pre-fill the registration form. Credential values never
 * appear here — a bot references a server-side environment variable by name,
 * and only the server ever resolves it.
 */

export const BOT_PROVIDER_IDS = [
  "anthropic",
  "openai",
  "google",
  "xai",
  "mistral",
  "deepseek",
  "groq",
  "openrouter",
  "selfhosted",
  "custom",
] as const;

export type BotProviderId = (typeof BOT_PROVIDER_IDS)[number];

export type BotProvider = {
  id: BotProviderId;
  /** What people call the bot ("Claude"), not the company. */
  label: string;
  vendor: string;
  /** Two-letter monogram used by the provider tile. */
  monogram: string;
  accent: string;
  summary: string;
  /** Suggested model identifiers. The model field always accepts free text. */
  suggestedModels: readonly string[];
  /**
   * Environment variable this provider reads by convention. `null` means the
   * provider can run without a credential (a self-hosted gateway, for example).
   */
  defaultCredentialRef: string | null;
  /**
   * The variable a signed-in *subscription* credential fills, where the
   * provider's own login tool supports one (`claude setup-token`, `codex
   * login`). Distinct from the API-key ref because the two bill differently.
   * Literal strings, not imports: this catalog is shipped to the browser, and
   * the server-side key constants live behind `server-only`. A unit test pins
   * each value to its server constant so they cannot drift.
   */
  subscriptionCredentialRef: string | null;
  /** Whether a bot on this provider must carry its own endpoint. */
  requiresBaseUrl: boolean;
  docsUrl: string;
  /**
   * The exact page that issues a key, so setup is a link rather than a hunt.
   * `null` where the provider issues no key (a self-hosted gateway) or where
   * the operator chooses the endpoint themselves.
   */
  apiKeyUrl: string | null;
};

export const BOT_PROVIDERS: readonly BotProvider[] = [
  {
    id: "anthropic",
    label: "Claude",
    vendor: "Anthropic",
    monogram: "CL",
    accent: "#d9855b",
    summary: "Long-horizon agentic work, deep code review, and planning.",
    suggestedModels: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5", "claude-fable-5"],
    defaultCredentialRef: "ANTHROPIC_API_KEY",
    subscriptionCredentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
    requiresBaseUrl: false,
    docsUrl: "https://platform.claude.com/docs",
    apiKeyUrl: "https://platform.claude.com/settings/keys",
  },
  {
    id: "openai",
    label: "Codex / GPT",
    vendor: "OpenAI",
    monogram: "OA",
    accent: "#5bd6a8",
    summary: "General coding agents and the Codex family of code models.",
    /*
     * The head of this list is what a bot is provisioned with, and the
     * executor accepts exactly one model, so the head is not a preference —
     * it is the executable model. `tests/unit/execution-model-agreement.test.ts`
     * ties it to `executionModel()`; the rest are for a person configuring a
     * bot by hand.
     */
    suggestedModels: ["gpt-5.3-codex", "gpt-5.1-codex", "gpt-5.1", "gpt-5-mini", "o4-mini"],
    defaultCredentialRef: "OPENAI_API_KEY",
    subscriptionCredentialRef: "SOFTWAREFACTORY_CODEX_AUTH_JSON",
    requiresBaseUrl: false,
    docsUrl: "https://platform.openai.com/docs",
    apiKeyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "google",
    label: "Gemini",
    vendor: "Google",
    monogram: "GM",
    accent: "#6aa9ff",
    summary: "Large-context reasoning and multimodal review.",
    suggestedModels: ["gemini-3-pro", "gemini-3-flash", "gemini-2.5-pro"],
    defaultCredentialRef: "GEMINI_API_KEY",
    subscriptionCredentialRef: null,
    requiresBaseUrl: false,
    docsUrl: "https://ai.google.dev/gemini-api/docs",
    apiKeyUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "xai",
    label: "Grok",
    vendor: "xAI",
    monogram: "GR",
    accent: "#c0c6d0",
    summary: "Fast general reasoning with an OpenAI-compatible surface.",
    suggestedModels: ["grok-4", "grok-4-fast", "grok-3"],
    defaultCredentialRef: "XAI_API_KEY",
    subscriptionCredentialRef: null,
    requiresBaseUrl: false,
    docsUrl: "https://docs.x.ai",
    apiKeyUrl: "https://console.x.ai",
  },
  {
    id: "mistral",
    label: "Mistral",
    vendor: "Mistral AI",
    monogram: "MI",
    accent: "#ffa24d",
    summary: "Efficient European models including Codestral for code.",
    suggestedModels: ["mistral-large-latest", "codestral-latest", "mistral-small-latest"],
    defaultCredentialRef: "MISTRAL_API_KEY",
    subscriptionCredentialRef: null,
    requiresBaseUrl: false,
    docsUrl: "https://docs.mistral.ai",
    apiKeyUrl: "https://console.mistral.ai/api-keys",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    vendor: "DeepSeek",
    monogram: "DS",
    accent: "#7f9bff",
    summary: "Cost-efficient reasoning and code completion.",
    suggestedModels: ["deepseek-chat", "deepseek-reasoner"],
    defaultCredentialRef: "DEEPSEEK_API_KEY",
    subscriptionCredentialRef: null,
    requiresBaseUrl: false,
    docsUrl: "https://api-docs.deepseek.com",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "groq",
    label: "Groq",
    vendor: "Groq",
    monogram: "GQ",
    accent: "#ff7d84",
    summary: "Low-latency inference for open-weight models.",
    suggestedModels: ["llama-3.3-70b-versatile", "qwen-2.5-coder-32b"],
    defaultCredentialRef: "GROQ_API_KEY",
    subscriptionCredentialRef: null,
    requiresBaseUrl: false,
    docsUrl: "https://console.groq.com/docs",
    apiKeyUrl: "https://console.groq.com/keys",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    vendor: "OpenRouter",
    monogram: "OR",
    accent: "#a78bfa",
    summary: "One reference that fans out to many upstream providers.",
    suggestedModels: ["openrouter/auto", "anthropic/claude-opus-5", "openai/gpt-5.1"],
    defaultCredentialRef: "OPENROUTER_API_KEY",
    subscriptionCredentialRef: null,
    requiresBaseUrl: false,
    docsUrl: "https://openrouter.ai/docs",
    apiKeyUrl: "https://openrouter.ai/settings/keys",
  },
  {
    id: "selfhosted",
    label: "Self-hosted",
    vendor: "Your infrastructure",
    monogram: "SH",
    accent: "#60d8ff",
    summary: "An Ollama, vLLM, or similar gateway you expose over HTTPS.",
    suggestedModels: ["llama3.1:70b", "qwen2.5-coder:32b"],
    defaultCredentialRef: null,
    subscriptionCredentialRef: null,
    requiresBaseUrl: true,
    docsUrl: "https://docs.vllm.ai",
    apiKeyUrl: null,
  },
  {
    id: "custom",
    label: "Custom endpoint",
    vendor: "OpenAI-compatible",
    monogram: "CX",
    accent: "#c6f135",
    summary: "Any other OpenAI-compatible API you can reach over HTTPS.",
    suggestedModels: [],
    defaultCredentialRef: "BOT_CREDENTIAL_CUSTOM",
    subscriptionCredentialRef: null,
    requiresBaseUrl: true,
    docsUrl: "https://platform.openai.com/docs/api-reference",
    apiKeyUrl: null,
  },
];

const providersById = new Map(BOT_PROVIDERS.map((provider) => [provider.id, provider]));

export function findBotProvider(id: string): BotProvider | null {
  return providersById.get(id as BotProviderId) ?? null;
}

export function isBotProviderId(value: string): value is BotProviderId {
  return providersById.has(value as BotProviderId);
}

export type BotRoleTemplate = {
  slug: string;
  name: string;
  summary: string;
  instructions: string;
  riskCeiling: RiskLevel;
  capabilities: readonly string[];
};

/**
 * Starter roles. These are suggestions a person can adopt in one click and
 * then edit; the authored role in the database is always the source of truth.
 */
export const BOT_ROLE_TEMPLATES: readonly BotRoleTemplate[] = [
  {
    slug: "orchestrator",
    name: "Orchestrator",
    summary: "Breaks an objective into bounded work and routes it to other bots.",
    instructions:
      "You coordinate work across a project. Turn the stated objective into a short ordered plan of bounded, independently reviewable tasks. Delegate each task to the bot whose role fits it, one self-contained brief per task, and state the acceptance check for each. Keep synthesis and final reporting for yourself. Never mark work complete on another bot's say-so without evidence.",
    riskCeiling: "GREEN",
    capabilities: ["planning", "delegation", "reporting"],
  },
  {
    slug: "product",
    name: "Product definition",
    summary: "Turns intent into acceptance criteria a reviewer can check.",
    instructions:
      "Convert requests into precise, testable acceptance criteria. State the user-visible outcome, the edge cases that must hold, and what is explicitly out of scope. Prefer one concrete example over three abstract rules. Flag any requirement whose two readings would lead to materially different work.",
    riskCeiling: "GREEN",
    capabilities: ["requirements", "acceptance-criteria"],
  },
  {
    slug: "frontend",
    name: "Frontend engineer",
    summary: "Builds interface work with responsive and accessible states.",
    instructions:
      "Implement interface changes that match the surrounding code's idiom. Cover loading, empty, error, and authorization states, and verify layouts at mobile, tablet, and desktop widths. Keep privileged work on the server and add client boundaries only at the smallest interactive scope. Never introduce a control that mutates production state without an explicit confirmation step.",
    riskCeiling: "GREEN",
    capabilities: ["ui", "accessibility", "responsive"],
  },
  {
    slug: "backend",
    name: "Backend engineer",
    summary: "Implements server logic, contracts, and validation.",
    instructions:
      "Implement server-side behavior with explicit input validation, bounded response sizes, and fail-closed error handling. Treat every client input and provider response as untrusted. Keep authorization checks independent of any single layer, and add or update tests for each changed boundary.",
    riskCeiling: "YELLOW",
    capabilities: ["api", "validation", "tests"],
  },
  {
    slug: "database",
    name: "Database engineer",
    summary: "Writes additive, reversible migrations with row-level security.",
    instructions:
      "Write forward-only, additive migrations. Every exposed table keeps row-level security enabled with ownership checks, foreign keys, and indexes. State the rollback path for each change in the same diff. Never rename or delete an applied migration, and never widen a grant without naming the exact caller that needs it.",
    riskCeiling: "RED",
    capabilities: ["migrations", "rls", "indexes"],
  },
  {
    slug: "qa",
    name: "QA engineer",
    summary: "Finds the failing case before a reviewer does.",
    instructions:
      "Write focused tests for the behavior under review and run them. Report pass and fail plainly with the relevant output, and name the exact inputs that produce a wrong result. Do not edit non-test code; if the code under test looks wrong, report that instead of working around it.",
    riskCeiling: "GREEN",
    capabilities: ["testing", "regression", "coverage"],
  },
  {
    slug: "security-reviewer",
    name: "Security reviewer",
    summary: "Read-only review for authorization, secrets, and tenant leaks.",
    instructions:
      "Review only the files you are pointed at. Look for missing authorization checks, cross-tenant reads, secret material reaching logs, browsers, or database rows, unsafe deserialization, and injection paths. Report each finding as file and line, the concrete request that exploits it, and a suggested fix. Say plainly when you found none. Make no code changes.",
    riskCeiling: "GREEN",
    capabilities: ["review", "authorization", "secrets"],
  },
  {
    slug: "release-manager",
    name: "Release manager",
    summary: "Assembles release evidence; never merges or deploys.",
    instructions:
      "Assemble the evidence a release decision needs: gate results, coverage, migration state, and outstanding blockers, each with its source. State explicitly what has not been verified. You do not merge, deploy, or roll back — recommend, and let the owner decide.",
    riskCeiling: "RED",
    capabilities: ["release-evidence", "checklists"],
  },
  {
    slug: "docs-writer",
    name: "Documentation writer",
    summary: "Keeps repository memory accurate after behavior changes.",
    instructions:
      "Update documentation to match what the code actually does. When memory and implementation disagree, inspect the code and fix the document in the same change. Keep truthful status language intact: never relabel a configured integration as connected, and never describe planned work in the present tense.",
    riskCeiling: "GREEN",
    capabilities: ["documentation", "repository-memory"],
  },
];

export function findBotRoleTemplate(slug: string): BotRoleTemplate | null {
  return BOT_ROLE_TEMPLATES.find((template) => template.slug === slug) ?? null;
}
