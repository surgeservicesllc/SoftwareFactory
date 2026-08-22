import "server-only";

import { assignmentConfigFromRow } from "@/lib/bots/assignment-config";
import { findBotProvider } from "@/lib/bots/catalog";
import { isCredentialPresent, normalizeCredentialRef } from "@/lib/bots/credentials";
import { loadStoredCredentialOverlay } from "@/lib/providers/stored-credentials";
import {
  evaluateBotReadiness,
  isBotReadiness,
  readinessLabel,
  readinessTone,
  type BotReadiness,
} from "@/lib/bots/readiness";
import { fromDatabaseRiskLevel } from "@/lib/bots/schemas";
import { isMissingDatabaseColumn } from "@/lib/bots/schema-compat";
import type {
  BotFabricSnapshot,
  SerializedAssignment,
  SerializedBot,
  SerializedBotRole,
  SerializedProject,
} from "@/lib/bots/types";

export type {
  BotFabricSnapshot,
  SerializedAssignment,
  SerializedBot,
  SerializedBotRole,
  SerializedProject,
};

/**
 * Tenant-scoped reads for the bot fabric.
 *
 * Every query here runs through the caller's session, so Supabase row-level
 * security is the second, independent check behind the application's active
 * organization binding. Serialized rows deliberately carry a credential
 * *reference* and a presence boolean — never a credential value.
 */

const MANAGER_ROLES = ["owner", "admin"] as const;

export function canManageBotFabric(role: string): boolean {
  return (MANAGER_ROLES as readonly string[]).includes(role);
}

type QueryResult = {
  data: unknown;
  error: DatabaseError | null;
};

type OrderedQuery = {
  order: (
    column: string,
    options: { ascending: boolean },
  ) => OrderedQuery;
  limit: (count: number) => PromiseLike<QueryResult>;
};

type FilteredOrderedQuery = OrderedQuery & {
  neq: (column: string, value: string) => FilteredOrderedQuery;
  gt: (column: string, value: string) => FilteredOrderedQuery;
};

type SupabaseLikeClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => FilteredOrderedQuery;
    };
  };
};

type DatabaseError = { code?: string; message?: string };

type BotRow = {
  id: string;
  name: string;
  provider: string;
  model: string;
  credential_ref: string | null;
  base_url: string | null;
  readiness: string;
  readiness_detail: string | null;
  last_checked_at: string | null;
  notes: string | null;
  ai_account_id?: string | null;
  created_at: string;
};

type RoleRow = {
  id: string;
  name: string;
  slug: string;
  summary: string;
  instructions: string;
  risk_ceiling: string;
  capabilities: unknown;
  created_at: string;
  updated_at: string;
};

type AssignmentRow = {
  id: string;
  /** Absent until 20260822000200; legacy rows serialize with token 1. */
  revision?: number;
  bot_id: string;
  project_id: string;
  role_id: string;
  status: string;
  assigned_at: string;
  released_at: string | null;
  preset?: string | null;
  responsibilities?: unknown;
  instructions?: string | null;
  repository_access?: string | null;
  branch_strategy?: string | null;
  can_open_pull_request?: boolean | null;
  can_merge_pull_request?: boolean | null;
  pipeline_access?: string | null;
  environment_access?: string | null;
  tools?: unknown;
  requires_human_approval?: boolean | null;
  max_concurrent_tasks?: number | null;
  priority?: number | null;
  model?: string | null;
  work_effort?: string | null;
};

type ProjectRow = {
  id: string;
  name: string;
  status: string;
  github_repository: string | null;
  health_status: string;
};

export class BotFabricQueryError extends Error {
  readonly databaseError: DatabaseError;

  constructor(databaseError: DatabaseError) {
    super(databaseError.message ?? "The bot fabric could not be loaded.");
    this.name = "BotFabricQueryError";
    this.databaseError = databaseError;
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string").slice(0, 12);
}

function toAssignmentStatus(value: string): SerializedAssignment["status"] {
  return value === "active" || value === "paused" ? value : "released";
}

/**
 * Whether a bot's referenced credential is available to a worker right now,
 * counting both server environment variables and credentials a person signed
 * in or pasted into the console (which live in the vault, not the environment).
 *
 * A bot connected through the one-click sign-in must read exactly as ready as
 * one whose key was set by hand — otherwise "connected" and "ready" disagree,
 * which is the specific confusion the sign-in flow exists to remove. Reusing
 * the overlay rather than a presence-only check is deliberate: it counts a
 * credential ready only if it can actually be opened, which is precisely the
 * condition under which a worker could use it.
 */
export type CredentialPresence = (credentialRef: string | null) => boolean;

export function serializeBot(
  row: BotRow,
  isPresent: CredentialPresence = isCredentialPresent,
): SerializedBot {
  const provider = findBotProvider(row.provider);
  const credentialPresent = isPresent(row.credential_ref);
  const evaluated = evaluateBotReadiness({
    provider: row.provider,
    model: row.model,
    credentialRef: row.credential_ref,
    baseUrl: row.base_url,
    credentialPresent,
  });
  const persisted: BotReadiness = isBotReadiness(row.readiness) ? row.readiness : "not_connected";
  // Disabled is an owner-authored stop state, not a credential-health verdict.
  // A recovered vault credential must never silently re-enable the bot.
  const current = persisted === "disabled"
    ? {
      readiness: "disabled" as const,
      detail: row.readiness_detail ?? "Disabled by an organization owner or administrator.",
    }
    : evaluated;

  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    providerLabel: provider?.label ?? row.provider,
    providerVendor: provider?.vendor ?? "Unknown vendor",
    model: row.model,
    credentialRef: row.credential_ref,
    credentialPresent,
    baseUrl: row.base_url,
    notes: row.notes,
    readiness: persisted,
    readinessLabel: readinessLabel(persisted),
    readinessTone: readinessTone(persisted),
    readinessDetail: row.readiness_detail,
    lastCheckedAt: row.last_checked_at,
    currentReadiness: current.readiness,
    currentReadinessDetail: current.detail,
    aiAccountId: row.ai_account_id ?? null,
    createdAt: row.created_at,
  };
}

export function serializeBotRole(row: RoleRow): SerializedBotRole {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    summary: row.summary,
    instructions: row.instructions,
    riskCeiling: fromDatabaseRiskLevel(row.risk_ceiling),
    capabilities: toStringArray(row.capabilities),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeAssignment(row: AssignmentRow): SerializedAssignment {
  return {
    id: row.id,
    revision: typeof row.revision === "number" && row.revision > 0 ? row.revision : 1,
    botId: row.bot_id,
    projectId: row.project_id,
    roleId: row.role_id,
    status: toAssignmentStatus(row.status),
    assignedAt: row.assigned_at,
    releasedAt: row.released_at,
    // Per-posting execution preferences: null model means the bot's default.
    model: row.model ?? null,
    workEffort: row.work_effort ?? "medium",
    config: assignmentConfigFromRow(row),
  };
}

export function serializeProject(row: ProjectRow): SerializedProject {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    githubRepository: row.github_repository,
    healthStatus: row.health_status,
  };
}

async function readTable<Row>(
  client: SupabaseLikeClient,
  table: string,
  columns: string,
  organizationId: string,
  orderColumn: string,
  limit: number,
): Promise<Row[]> {
  const { data, error } = await client
    .from(table)
    .select(columns)
    .eq("organization_id", organizationId)
    .order(orderColumn, { ascending: true })
    .limit(limit);

  if (error) throw new BotFabricQueryError(error);
  return (data ?? []) as Row[];
}

/**
 * Read a tenant table to a terminal empty page using its unique id as the
 * cursor. A short page is not terminal proof because PostgREST can enforce a
 * server-side row cap below the requested limit.
 */
async function readCompleteTable<Row extends { id: string }>(
  client: SupabaseLikeClient,
  table: string,
  columns: string,
  organizationId: string,
): Promise<Row[]> {
  const pageSize = 200;
  const maximumDataPages = 100;
  const rows: Row[] = [];
  let afterId: string | null = null;

  for (let pageNumber = 0; pageNumber <= maximumDataPages; pageNumber += 1) {
    let query = client
      .from(table)
      .select(columns)
      .eq("organization_id", organizationId);
    if (afterId !== null) query = query.gt("id", afterId);
    const { data, error } = await query.order("id", { ascending: true }).limit(pageSize);
    if (error) throw new BotFabricQueryError(error);

    const page = (data ?? []) as Row[];
    if (page.length === 0) return rows;
    if (pageNumber === maximumDataPages) break;

    let previousId: string | null = afterId;
    for (const row of page) {
      if (typeof row.id !== "string"
        || row.id.length === 0
        || (previousId !== null && row.id <= previousId)) {
        throw new BotFabricQueryError({
          code: `${table}_pagination_invalid`,
          message: `The ${table} roster could not be read completely.`,
        });
      }
      previousId = row.id;
    }

    rows.push(...page);
    afterId = previousId;
  }

  throw new BotFabricQueryError({
    code: `${table}_pagination_limit`,
    message: `The ${table} roster exceeded its safe read boundary.`,
  });
}

function sortNamedRows<Row extends { id: string; name: string }>(rows: Row[]): Row[] {
  return rows.sort((left, right) => (
    left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
  ));
}

async function readBots(
  client: SupabaseLikeClient,
  organizationId: string,
): Promise<BotRow[]> {
  const baseColumns =
    "id,name,provider,model,credential_ref,base_url,readiness,readiness_detail,last_checked_at,notes";
  try {
    return sortNamedRows(await readCompleteTable<BotRow>(
      client,
      "bots",
      `${baseColumns},ai_account_id,created_at`,
      organizationId,
    ));
  } catch (error) {
    if (!(error instanceof BotFabricQueryError)
      || !isMissingDatabaseColumn(error.databaseError, "ai_account_id")) {
      throw error;
    }
    // Very old hosted schemas predate account identity. Keep the fleet visible
    // with a null account link; never smooth over any other read failure.
    return sortNamedRows(await readCompleteTable<BotRow>(
      client,
      "bots",
      `${baseColumns},created_at`,
      organizationId,
    ));
  }
}

async function readRoles(
  client: SupabaseLikeClient,
  organizationId: string,
): Promise<RoleRow[]> {
  return sortNamedRows(await readCompleteTable<RoleRow>(
    client,
    "bot_roles",
    "id,name,slug,summary,instructions,risk_ceiling,capabilities,created_at,updated_at",
    organizationId,
  ));
}

/**
 * Read the complete open roster, not an arbitrary history prefix.
 *
 * The table keeps released postings forever as audit-supporting history. If
 * the generic bounded read takes the oldest 500 rows before filtering those
 * records, a newer active posting can disappear and every consumer can make a
 * false completion or availability decision. Apply the status predicate in
 * PostgreSQL first, then keyset-page on the unique assignment id until the
 * database returns an empty page. Deliberately do not stop on a short page:
 * PostgREST may impose a lower server-side row ceiling than the requested page
 * size, and treating that short page as complete recreates the same defect.
 *
 * This is a rolling read, not a transaction snapshot. Its completeness marker
 * proves that this ordered traversal reached a terminal page; ordinary changes
 * committed after a page was read appear on the next refresh. The page guard
 * is a denial-of-service boundary, not a completeness shortcut. Reaching it
 * fails the entire fabric read, so no caller can interpret a partial roster as
 * an empty or completed one.
 */
async function readOpenAssignments(
  client: SupabaseLikeClient,
  organizationId: string,
): Promise<AssignmentRow[]> {
  const pageSize = 250;
  // At the requested page size this permits 25,000 open postings, followed by
  // one terminal-page proof. More than that—or a server cap so low that 100
  // data pages cannot finish—fails closed.
  const maximumDataPages = 100;
  const rows: AssignmentRow[] = [];
  let afterId: string | null = null;
  let revisionAvailable = true;

  const baseColumns =
    "id,bot_id,project_id,role_id,status,assigned_at,released_at,preset,responsibilities,"
    + "instructions,repository_access,branch_strategy,can_open_pull_request,"
    + "can_merge_pull_request,pipeline_access,environment_access,tools,"
    + "requires_human_approval,max_concurrent_tasks,priority,model,work_effort";

  const readPage = async (includeRevision: boolean): Promise<QueryResult> => {
    let query = client
      .from("bot_assignments")
      .select(includeRevision ? `id,revision,${baseColumns.slice(3)}` : baseColumns)
      .eq("organization_id", organizationId)
      .neq("status", "released");
    if (afterId !== null) query = query.gt("id", afterId);
    return query.order("id", { ascending: true }).limit(pageSize);
  };

  for (let pageNumber = 0; pageNumber <= maximumDataPages; pageNumber += 1) {
    let result = await readPage(revisionAvailable);
    if (revisionAvailable && isMissingDatabaseColumn(result.error, "revision")) {
      revisionAvailable = false;
      result = await readPage(false);
    }
    const { data, error } = result;
    if (error) throw new BotFabricQueryError(error);

    const page = (data ?? []) as AssignmentRow[];
    if (page.length === 0) return rows;

    // The extra query after 100 data pages exists only to prove termination.
    // Any row on it means the bounded read is incomplete, so do not serialize
    // that prefix or imply that its progress calculations are authoritative.
    if (pageNumber === maximumDataPages) break;

    const nextAfterId = page.at(-1)?.id;
    if (
      typeof nextAfterId !== "string"
      || nextAfterId.length === 0
      || (afterId !== null && nextAfterId <= afterId)
    ) {
      throw new BotFabricQueryError({
        code: "bot_assignments_pagination_invalid",
        message: "The open bot-assignment roster could not be read completely.",
      });
    }

    rows.push(...page);
    afterId = nextAfterId;
  }

  throw new BotFabricQueryError({
    code: "bot_assignments_pagination_limit",
    message: "The open bot-assignment roster exceeded its safe read boundary.",
  });
}

/**
 * Builds the credential-presence test for one organization: a reference is
 * present if the server environment holds it, or if a signed-in / pasted
 * credential for that same variable exists in the vault. Stored credentials
 * are opened here through the same overlay the provider-status route uses, so
 * the fleet and the providers tab can never disagree about a connection.
 */
export async function credentialPresenceForOrganization(
  organizationId: string,
): Promise<CredentialPresence> {
  const overlay = await loadStoredCredentialOverlay(organizationId);
  const storedRefs = new Set(Object.keys(overlay));

  return (credentialRef: string | null) => {
    if (!credentialRef) return false;
    if (isCredentialPresent(credentialRef)) return true;
    let normalized: string | null = null;
    try {
      normalized = normalizeCredentialRef(credentialRef);
    } catch {
      return false;
    }
    return normalized !== null && storedRefs.has(normalized);
  };
}

export async function loadBotFabric(
  client: unknown,
  organizationId: string,
): Promise<BotFabricSnapshot> {
  const supabase = client as SupabaseLikeClient;

  const [isPresent, [bots, roles, assignments, projects]] = await Promise.all([
    credentialPresenceForOrganization(organizationId),
    Promise.all([
    readBots(supabase, organizationId),
    readRoles(supabase, organizationId),
    readOpenAssignments(supabase, organizationId),
    readTable<ProjectRow>(
      supabase,
      "projects",
      "id,name,status,github_repository,health_status",
      organizationId,
      "name",
      200,
    ),
    ]),
  ]);

  return {
    bots: bots.map((row) => serializeBot(row, isPresent)),
    roles: roles.map(serializeBotRole),
    assignments: assignments.map(serializeAssignment),
    assignmentsComplete: true,
    projects: projects
      .filter((project) => project.status !== "archived")
      .map(serializeProject),
  };
}
