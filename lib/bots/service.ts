import "server-only";

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

type SupabaseLikeClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        order: (
          column: string,
          options: { ascending: boolean },
        ) => {
          limit: (count: number) => PromiseLike<{ data: unknown; error: DatabaseError | null }>;
        };
      };
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
  bot_id: string;
  project_id: string;
  role_id: string;
  status: string;
  assigned_at: string;
  released_at: string | null;
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
  const current = evaluateBotReadiness({
    provider: row.provider,
    model: row.model,
    credentialRef: row.credential_ref,
    baseUrl: row.base_url,
    credentialPresent,
  });
  const persisted: BotReadiness = isBotReadiness(row.readiness) ? row.readiness : "not_connected";

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
    botId: row.bot_id,
    projectId: row.project_id,
    roleId: row.role_id,
    status: toAssignmentStatus(row.status),
    assignedAt: row.assigned_at,
    releasedAt: row.released_at,
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
 * Builds the credential-presence test for one organization: a reference is
 * present if the server environment holds it, or if a signed-in / pasted
 * credential for that same variable exists in the vault. Stored credentials
 * are opened here through the same overlay the provider-status route uses, so
 * the fleet and the providers tab can never disagree about a connection.
 */
async function credentialPresenceForOrganization(
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
    readTable<BotRow>(
      supabase,
      "bots",
      "id,name,provider,model,credential_ref,base_url,readiness,readiness_detail,last_checked_at,notes,created_at",
      organizationId,
      "name",
      200,
    ),
    readTable<RoleRow>(
      supabase,
      "bot_roles",
      "id,name,slug,summary,instructions,risk_ceiling,capabilities,created_at,updated_at",
      organizationId,
      "name",
      200,
    ),
    readTable<AssignmentRow>(
      supabase,
      "bot_assignments",
      "id,bot_id,project_id,role_id,status,assigned_at,released_at",
      organizationId,
      "assigned_at",
      500,
    ),
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
    assignments: assignments
      .map(serializeAssignment)
      .filter((assignment) => assignment.status !== "released"),
    projects: projects
      .filter((project) => project.status !== "archived")
      .map(serializeProject),
  };
}
