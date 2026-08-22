import "server-only";

import { createClient } from "@supabase/supabase-js";

import { evaluateBotReadiness } from "@/lib/bots/readiness";
import {
  isMissingDatabaseColumn,
  isMissingDatabaseFunction,
} from "@/lib/bots/schema-compat";
import {
  credentialPresenceForOrganization,
  serializeBot,
  type SerializedBot,
} from "@/lib/bots/service";
import { isSupabaseServiceRoleCredential } from "@/lib/supabase/config";
import { getSupabasePublicEnvironment } from "@/lib/supabase/env";

type DatabaseError = { code?: string; message?: string };
type QueryResult = { data: unknown; error: DatabaseError | null };

type FilterBuilder = {
  eq: (column: string, value: string) => FilterBuilder;
  maybeSingle: () => PromiseLike<QueryResult>;
};

type ReadinessReadClient = {
  from: (table: string) => {
    select: (columns: string) => FilterBuilder;
  };
};

type ReadinessRecorderClient = {
  rpc: (name: string, args: Record<string, unknown>) => {
    single: () => PromiseLike<QueryResult>;
  };
};

export class BotReadinessRecorderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BotReadinessRecorderConfigurationError";
  }
}

/**
 * A readiness verdict depends on server-only credential evidence, so only a
 * server-only service-role client may persist it. Browser-authenticated clients
 * retain read access but have no EXECUTE grant on the recorder RPC.
 */
export function createBotReadinessRecorderClient(): ReadinessRecorderClient {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey || !isSupabaseServiceRoleCredential(serviceRoleKey)) {
    throw new BotReadinessRecorderConfigurationError(
      "SUPABASE_SERVICE_ROLE_KEY must be a server-only service-role credential.",
    );
  }
  const { url } = getSupabasePublicEnvironment();
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  }) as unknown as ReadinessRecorderClient;
}

export class BotReadinessSyncError extends Error {
  readonly databaseError: DatabaseError;
  readonly stage: "read" | "record";

  constructor(stage: "read" | "record", databaseError: DatabaseError) {
    super(databaseError.message ?? "Bot readiness could not be synchronized.");
    this.name = "BotReadinessSyncError";
    this.stage = stage;
    this.databaseError = databaseError;
  }
}

export const BOT_READINESS_MIGRATION_PENDING_CODE = "bot_readiness_migration_pending";

function readinessMigrationPending(): BotReadinessSyncError {
  return new BotReadinessSyncError("record", {
    code: BOT_READINESS_MIGRATION_PENDING_CODE,
    message: "Readiness verification is waiting for the checked-recorder database upgrade.",
  });
}

/**
 * Read one exact tenant bot, evaluate the credential that the server can
 * actually open now, and persist the verdict through the audited manager RPC.
 *
 * Provisioning uses this before it claims the returned bot is usable. The
 * command router reads persisted readiness, so returning after only a
 * vault-aware *display* calculation would leave a bot that looks Ready but is
 * rejected when work is submitted.
 */
export async function synchronizeBotReadiness(
  rawClient: unknown,
  organizationId: string,
  botId: string,
  actorUserId: string,
  rawRecorderClient?: unknown,
): Promise<SerializedBot | null> {
  const client = rawClient as ReadinessReadClient;
  const baseColumns =
    "id,name,provider,model,credential_ref,base_url,readiness,readiness_detail,last_checked_at,notes,created_at";
  const read = (columns: string) => client
    .from("bots")
    .select(columns)
    .eq("organization_id", organizationId)
    .eq("id", botId)
    .maybeSingle();

  let checkedIdentityAvailable = true;
  let result = await read(`${baseColumns},ai_account_id,revision`);
  if (isMissingDatabaseColumn(result.error, "revision")) {
    checkedIdentityAvailable = false;
    // Account identity predates row revisions on the hosted schema. Read it
    // only to distinguish a missing row from a rollout that must retry.
    result = await read(`${baseColumns},ai_account_id`);
  }
  if (isMissingDatabaseColumn(result.error, "ai_account_id")) {
    checkedIdentityAvailable = false;
    result = await read(baseColumns);
  }
  const { data: existing, error: readError } = result;

  if (readError) throw new BotReadinessSyncError("read", readError);
  if (!existing) return null;

  // The legacy recorder cannot compare the row identity it evaluated and
  // cannot preserve a management-authored Disabled state across a race. Until
  // both identity columns exist, refusing a retryable readiness mutation is
  // the only truthful behavior.
  if (!checkedIdentityAvailable) throw readinessMigrationPending();

  const row = existing as {
    provider: string;
    model: string;
    credential_ref: string | null;
    base_url: string | null;
    readiness: string;
    ai_account_id?: string | null;
    revision?: number;
  };
  const isCredentialPresent = await credentialPresenceForOrganization(organizationId);
  // Disabled is a durable management decision. Credential recovery may change
  // what the vault can resolve, but only an explicit manager action can enable
  // this bot again, so readiness synchronization must not overwrite it.
  if (row.readiness === "disabled") {
    return serializeBot(existing as Parameters<typeof serializeBot>[0], isCredentialPresent);
  }
  const verdict = evaluateBotReadiness({
    provider: row.provider,
    model: row.model,
    credentialRef: row.credential_ref,
    baseUrl: row.base_url,
    credentialPresent: isCredentialPresent(row.credential_ref),
  });

  if (typeof row.revision !== "number"
    || row.revision <= 0
    || !Object.hasOwn(row, "ai_account_id")) {
    throw readinessMigrationPending();
  }

  const recorder = (rawRecorderClient ?? createBotReadinessRecorderClient()) as ReadinessRecorderClient;
  const recordResult = await recorder
    .rpc("record_bot_readiness_preserving_disabled", {
      p_organization_id: organizationId,
      p_bot_id: botId,
      p_actor_user_id: actorUserId,
      p_expected_revision: row.revision,
      p_expected_ai_account_id: row.ai_account_id ?? null,
      p_expected_provider: row.provider,
      p_expected_model: row.model,
      p_expected_credential_ref: row.credential_ref,
      p_expected_base_url: row.base_url,
      p_readiness: verdict.readiness,
      p_detail: verdict.detail,
    })
    .single();

  if (isMissingDatabaseFunction(
    recordResult.error,
    "record_bot_readiness_preserving_disabled",
  )) {
    throw readinessMigrationPending();
  }
  if (recordResult.error) throw new BotReadinessSyncError("record", recordResult.error);
  return serializeBot(
    recordResult.data as Parameters<typeof serializeBot>[0],
    isCredentialPresent,
  );
}
