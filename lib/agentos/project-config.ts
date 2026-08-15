/**
 * `agentos.yml` — the project configuration as code.
 *
 * `docs/AGENTOS_SPEC.md` §17: every project has a YAML file that mimics the
 * online UI, and §22 asks that push-then-pull be identity modulo whitespace.
 *
 * That round trip is the whole design constraint. It only holds if parsing and
 * serializing agree on three things, each of which is easy to get wrong:
 *
 *   Ordering    collections are emitted sorted by a stable key, so two configs
 *               describing the same workspace serialize identically regardless
 *               of the order rows came back from the database.
 *   Absence     an omitted field and an explicitly empty one must not round
 *               trip differently. Defaults are applied on parse and omitted on
 *               serialize when they still hold.
 *   Rejection   an unknown key is refused rather than dropped. Silently
 *               discarding it would make `pull` erase configuration that the
 *               author believed was applied.
 *
 * Credentials are referenced by variable NAME only, never by value. The parser
 * refuses a config that tries to carry one.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

/** Variable names that can never be an agent's credential reference. */
const FORBIDDEN_CREDENTIAL_NAMES = new Set([
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
  "DATABASE_URL",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_STATE_SECRET",
  "VERCEL_TOKEN",
  "WORKER_TICK_SECRET",
  "CRON_SECRET",
]);

const credentialReference = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{2,63}$/, "must be an environment variable name")
  .refine((name) => !FORBIDDEN_CREDENTIAL_NAMES.has(name), {
    message: "that variable is privileged and cannot back an agent capability",
  })
  .refine((name) => !name.startsWith("NEXT_PUBLIC_"), {
    message: "a NEXT_PUBLIC_ variable reaches the browser and cannot hold a credential",
  });

const slug = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/);
/** `agentos_mcp_connections.name` permits underscores; a stricter rule here would
 *  make `pull` emit a file its own parser rejects. */
const connectionName = z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/);
/** `agents.name` is free text in the schema, so it is free text here too. Only
 *  agents a template step names are additionally required to be slug-shaped,
 *  because `agentos_task_template_steps.agent_name` constrains that column. */
const agentName = z.string().min(1).max(120);
const hostname = z
  .string()
  .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/,
    "must be a bare hostname with no scheme, port or path");

const environmentSchema = z.object({
  name: z.string().min(1).max(120),
  networking: z.enum(["open", "limited"]).default("limited"),
  allowedHosts: z.array(hostname).max(50).default([]),
}).strict().superRefine((value, context) => {
  if (value.networking === "open" && value.allowedHosts.length > 0) {
    context.addIssue({
      code: "custom",
      message: "an open environment must not list hosts; the list would imply a limit it does not apply",
    });
  }
});

const mcpConnectionSchema = z.object({
  name: connectionName,
  displayName: z.string().min(1).max(120),
  transport: z.enum(["stdio", "http", "builtin"]),
  endpoint: z.string().max(500).optional(),
  credentialEnvVar: credentialReference.optional(),
  allowedOperations: z.array(z.string().min(1).max(120)).max(100).default([]),
}).strict().superRefine((value, context) => {
  if (value.transport === "http" && value.endpoint && !value.endpoint.startsWith("https://")) {
    context.addIssue({
      code: "custom",
      message: "an http transport endpoint must use https",
    });
  }
});

const skillSchema = z.object({
  slug,
  name: z.string().min(1).max(120),
  kind: z.enum(["prompt", "file"]),
  body: z.string().max(20000).optional(),
  filePath: z.string().max(500).optional(),
}).strict().superRefine((value, context) => {
  const hasBody = value.body !== undefined;
  const hasPath = value.filePath !== undefined;
  if (value.kind === "prompt" && (!hasBody || hasPath)) {
    context.addIssue({ code: "custom", message: "a prompt skill carries a body and no filePath" });
  }
  if (value.kind === "file" && (!hasPath || hasBody)) {
    context.addIssue({ code: "custom", message: "a file skill carries a filePath and no body" });
  }
});

const filesystemGrantSchema = z.object({
  folderPath: z.string().regex(/^\/[A-Za-z0-9._/-]{0,200}$/).refine((path) => !path.includes(".."), {
    message: "a folder grant cannot traverse out of its own prefix",
  }),
  read: z.boolean().default(false),
  write: z.boolean().default(false),
  delete: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (!value.read && !value.write && !value.delete) {
    context.addIssue({
      code: "custom",
      message: "a grant that permits nothing reads as a grant; remove it instead",
    });
  }
  // Matching the schema: write and delete each imply read.
  if ((value.write || value.delete) && !value.read) {
    context.addIssue({ code: "custom", message: "write and delete both require read" });
  }
});

const repoGrantSchema = z.object({
  repository: z.string().min(1).max(200),
  mountPath: z.string().regex(/^\/[A-Za-z0-9._/-]{0,200}$/).refine((path) => !path.includes(".."), {
    message: "a mount path cannot traverse out of its own prefix",
  }),
  permission: z.enum(["git_read", "git_write"]).default("git_read"),
}).strict();

/** `public.agent_role`, mirrored so a push can create an agent the file names. */
const agentRoleSchema = z.enum([
  "orchestrator", "product", "frontend", "backend", "database",
  "qa", "security", "release", "ceo_reporter", "custom",
]);

const agentSchema = z.object({
  name: agentName,
  role: agentRoleSchema.default("custom"),
  description: z.string().max(2000).optional(),
  environment: z.string().min(1).max(120).optional(),
  runner: z.enum(["cloud", "local", "inherit"]).default("inherit"),
  inboxAccess: z.boolean().default(false),
  // Default deny throughout: an omitted list grants nothing.
  mcpConnections: z.array(connectionName).max(50).default([]),
  skills: z.array(slug).max(50).default([]),
  repos: z.array(repoGrantSchema).max(20).default([]),
  filesystem: z.array(filesystemGrantSchema).max(50).default([]),
  collaborators: z.array(agentName).max(50).default([]),
}).strict();

const templateStepSchema = z.object({
  name: z.string().min(1).max(160),
  // Slug-shaped because `agentos_task_template_steps.agent_name` is. `human`
  // already satisfies that shape and needs no special case in the schema.
  agent: slug,
  prompt: z.string().min(1).max(8000),
  approvalGate: z.boolean().default(false),
  humanStep: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.humanStep && !value.approvalGate) {
    context.addIssue({
      code: "custom",
      message: "a step a human performs must be approval-gated, or the chain advances past work nobody did",
    });
  }
});

const templateSchema = z.object({
  name: slug,
  displayName: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  variables: z.array(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)).max(20).default([]),
  steps: z.array(templateStepSchema).min(1).max(50),
}).strict();

export const projectConfigSchema = z.object({
  project: z.string().min(1).max(120),
  environments: z.array(environmentSchema).max(50).default([]),
  mcpConnections: z.array(mcpConnectionSchema).max(50).default([]),
  skills: z.array(skillSchema).max(100).default([]),
  agents: z.array(agentSchema).max(100).default([]),
  templates: z.array(templateSchema).max(50).default([]),
}).strict();

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

export class ProjectConfigError extends Error {
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[] = []) {
    super(message);
    this.name = "ProjectConfigError";
    this.issues = issues;
  }
}

/**
 * Parses `agentos.yml`.
 *
 * `.strict()` throughout means an unknown key is an error rather than a
 * silently dropped one — a `pull` that discarded it would erase configuration
 * its author believed was applied.
 */
export function parseProjectConfig(text: string): ProjectConfig {
  let document: unknown;
  try {
    document = parseYaml(text);
  } catch (error) {
    throw new ProjectConfigError(
      `agentos.yml is not valid YAML: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const parsed = projectConfigSchema.safeParse(document);
  if (!parsed.success) {
    throw new ProjectConfigError(
      "agentos.yml does not describe a valid project",
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }

  // Referential integrity across the file. A name that resolves to nothing is
  // a typo that would otherwise become a silently ungranted capability.
  const issues: string[] = [];

  // Names are the identity a push matches on, so a duplicate is an ambiguity
  // rather than a redundancy: whichever row won would be arbitrary.
  for (const [collection, names] of [
    ["environments", parsed.data.environments.map((e) => e.name)],
    ["mcpConnections", parsed.data.mcpConnections.map((c) => c.name)],
    ["skills", parsed.data.skills.map((s) => s.slug)],
    ["agents", parsed.data.agents.map((a) => a.name)],
    ["templates", parsed.data.templates.map((t) => t.name)],
  ] as const) {
    const seen = new Set<string>();
    for (const name of names) {
      if (seen.has(name)) issues.push(`${collection}: "${name}" is defined more than once`);
      seen.add(name);
    }
  }

  const environmentNames = new Set(parsed.data.environments.map((e) => e.name));
  const connectionNames = new Set(parsed.data.mcpConnections.map((c) => c.name));
  const skillSlugs = new Set(parsed.data.skills.map((s) => s.slug));
  const agentNames = new Set(parsed.data.agents.map((a) => a.name));

  for (const agent of parsed.data.agents) {
    if (agent.environment && !environmentNames.has(agent.environment)) {
      issues.push(`agents.${agent.name}: environment "${agent.environment}" is not defined`);
    }
    for (const connection of agent.mcpConnections) {
      if (!connectionNames.has(connection)) {
        issues.push(`agents.${agent.name}: mcpConnection "${connection}" is not defined`);
      }
    }
    for (const skillName of agent.skills) {
      if (!skillSlugs.has(skillName)) {
        issues.push(`agents.${agent.name}: skill "${skillName}" is not defined`);
      }
    }
    for (const collaborator of agent.collaborators) {
      if (collaborator === agent.name) {
        issues.push(`agents.${agent.name}: an agent cannot list itself as a collaborator`);
      } else if (!agentNames.has(collaborator)) {
        issues.push(`agents.${agent.name}: collaborator "${collaborator}" is not defined`);
      }
    }
  }

  for (const template of parsed.data.templates) {
    for (const step of template.steps) {
      // `human` is the spec's own actor for a sign-off step and never resolves
      // to an agent record. Every other name must, and because this column is
      // slug-shaped, an agent whose name is not slug-shaped is unreachable
      // from a template — which this reports rather than leaving to discover.
      if (step.agent !== "human" && !agentNames.has(step.agent)) {
        issues.push(`templates.${template.name}: step "${step.name}" names undefined agent "${step.agent}"`);
      }
      // A placeholder with no declared variable can never be filled, and the
      // failure would surface only when someone instantiated the template.
      for (const match of step.prompt.matchAll(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g)) {
        if (!template.variables.includes(match[1])) {
          issues.push(`templates.${template.name}: step "${step.name}" uses undeclared variable "${match[1]}"`);
        }
      }
    }
  }

  if (issues.length > 0) {
    throw new ProjectConfigError("agentos.yml references things it does not define", issues);
  }

  return parsed.data;
}

/** Drops keys whose value still equals the schema default. */
function omitDefaults<T extends Record<string, unknown>>(
  value: T,
  defaults: Partial<Record<keyof T, unknown>>,
): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    const fallback = defaults[key as keyof T];
    if (fallback !== undefined) {
      if (Array.isArray(entry) && Array.isArray(fallback) && entry.length === 0) continue;
      if (entry === fallback) continue;
    }
    result[key] = entry;
  }
  return result as Partial<T>;
}

/**
 * Serializes a config back to YAML.
 *
 * Collections are sorted by a stable key so the same workspace always produces
 * the same bytes, whatever order rows arrived in. Without that, `pull` after
 * `push` would show a diff made entirely of reordering.
 */
export function serializeProjectConfig(config: ProjectConfig): string {
  const document = {
    project: config.project,
    environments: [...config.environments]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((environment) => omitDefaults(environment, { networking: "limited", allowedHosts: [] })),
    mcpConnections: [...config.mcpConnections]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((connection) => omitDefaults(connection, { allowedOperations: [] })),
    skills: [...config.skills].sort((a, b) => a.slug.localeCompare(b.slug)),
    agents: [...config.agents]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((agent) => {
        const bare = omitDefaults(agent, {
          role: "custom",
          runner: "inherit",
          inboxAccess: false,
          mcpConnections: [],
          skills: [],
          repos: [],
          filesystem: [],
          collaborators: [],
        });
        return {
          ...bare,
          ...(agent.mcpConnections.length > 0
            ? { mcpConnections: [...agent.mcpConnections].sort() } : {}),
          ...(agent.skills.length > 0 ? { skills: [...agent.skills].sort() } : {}),
          ...(agent.collaborators.length > 0
            ? { collaborators: [...agent.collaborators].sort() } : {}),
          ...(agent.repos.length > 0
            ? { repos: [...agent.repos].sort((a, b) => a.mountPath.localeCompare(b.mountPath))
                .map((repo) => omitDefaults(repo, { permission: "git_read" })) } : {}),
          ...(agent.filesystem.length > 0
            ? { filesystem: [...agent.filesystem].sort((a, b) => a.folderPath.localeCompare(b.folderPath))
                .map((grant) => omitDefaults(grant, { read: false, write: false, delete: false })) } : {}),
        };
      }),
    // Templates keep author order: step order is the workflow, not a set.
    templates: config.templates.map((template) => ({
      ...omitDefaults(template, { variables: [] }),
      steps: template.steps.map((step) =>
        omitDefaults(step, { approvalGate: false, humanStep: false })),
    })),
  };

  // Empty top-level collections are omitted so a minimal file stays minimal.
  const pruned = Object.fromEntries(
    Object.entries(document).filter(([, value]) => !Array.isArray(value) || value.length > 0),
  );

  return stringifyYaml(pruned, { lineWidth: 0 });
}

/**
 * True when two configs describe the same workspace.
 *
 * Compares serialized forms, which is what "identity modulo whitespace" means
 * in practice: both sides go through the same ordering and default rules.
 */
export function configsAreEquivalent(left: ProjectConfig, right: ProjectConfig): boolean {
  return serializeProjectConfig(left) === serializeProjectConfig(right);
}
