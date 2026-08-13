import { z } from "zod";

import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

type ActivityReference = {
  id: string;
  type: string;
};

type SafeActivityEvidence = {
  action: string | null;
  actorLogin: string | null;
  conclusion: string | null;
  resources: ActivityReference[];
  source: "github" | "softwarefactory";
  stateTransition: string | null;
  status: string | null;
};

type ActivityRow = {
  actor_display_name: string | null;
  actor_user_id: string | null;
  description: string;
  entity_id: string | null;
  entity_type: string;
  event_type: string;
  evidence: unknown;
  id: string;
  occurred_at: string;
  project_id: string | null;
  project_name: string | null;
};

const referenceKeys = [
  ["repository", "repository"],
  ["repository_id", "repository"],
  ["github_repository_id", "repository binding"],
  ["installation_id", "installation"],
  ["connection_id", "connection"],
  ["delivery_id", "delivery"],
  ["pull_request_number", "pull request"],
  ["number", "pull request"],
  ["command_id", "command"],
  ["task_id", "task"],
  ["agent_id", "agent"],
  ["rollback_of_deployment_id", "deployment"],
  ["commit_sha", "commit"],
  ["head_branch", "branch"],
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedScalar(value: unknown, maximumLength = 160) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized || normalized.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    return null;
  }
  return normalized;
}

/**
 * Activity metadata is an internal audit payload, not an API response. Only
 * explicitly named, bounded scalar evidence leaves this boundary. Unknown
 * keys and nested objects are ignored, including all provider payload data.
 */
export function activityEvidenceFromMetadata(metadata: unknown): SafeActivityEvidence {
  const record = isObject(metadata) ? metadata : {};
  const githubActor = isObject(record.github_actor) ? record.github_actor : {};
  const actorLogin = boundedScalar(githubActor.login, 39);
  const safeActorLogin = actorLogin && /^[a-z\d](?:[a-z\d-]{0,38})$/iu.test(actorLogin)
    ? actorLogin
    : null;
  const declaredSource = boundedScalar(record.source, 64)?.toLowerCase();
  const provider = boundedScalar(record.provider, 64)?.toLowerCase();
  const githubEventType = boundedScalar(record.github_event_type, 160)?.toLowerCase();
  const source = declaredSource === "github"
    || declaredSource === "github_repository_sync"
    || provider === "github"
    || githubEventType?.startsWith("github.")
    ? "github"
    : "softwarefactory";

  const explicitTransition = boundedScalar(record.state_transition);
  const from = boundedScalar(record.from, 80);
  const to = boundedScalar(record.to, 80);
  const resourceType = boundedScalar(record.resource_type, 64) ?? "GitHub resource";
  const resources: ActivityReference[] = referenceKeys.flatMap(([key, type]) => {
    const id = boundedScalar(record[key]);
    return id ? [{ id, type }] : [];
  });
  const externalResourceId = boundedScalar(record.external_resource_id);
  const resourceNumber = boundedScalar(record.resource_number, 32);
  if (externalResourceId) resources.push({ id: externalResourceId, type: resourceType });
  if (resourceNumber) resources.push({ id: resourceNumber, type: `${resourceType} number` });

  return {
    action: boundedScalar(record.action) ?? boundedScalar(record.operation),
    actorLogin: safeActorLogin,
    conclusion: boundedScalar(record.conclusion),
    resources,
    source,
    stateTransition: explicitTransition ?? (from && to ? `${from} -> ${to}` : null),
    status: boundedScalar(record.status) ?? boundedScalar(record.decision),
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ limit: url.searchParams.get("limit") ?? undefined });
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_activity_query", message: "The activity query is invalid." } },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client.rpc("list_activity", {
      p_limit: parsed.data.limit,
      p_organization_id: activeOrganization.id,
    });
    if (error) return databaseErrorResponse(error);

    const events = (data ?? []) as ActivityRow[];

    return jsonNoStore({
      activeOrganizationId: activeOrganization.id,
      events: events.map((event) => {
        const evidence = activityEvidenceFromMetadata(event.evidence);
        return {
          actor: event.actor_user_id
            ? {
                displayName: event.actor_display_name ?? "SoftwareFactory user",
                id: event.actor_user_id,
                source: "softwarefactory" as const,
              }
            : evidence.actorLogin
              ? { displayName: `@${evidence.actorLogin}`, id: null, source: "github" as const }
              : null,
          description: event.description,
          entity: { id: event.entity_id, type: event.entity_type },
          eventType: event.event_type,
          evidence: {
            action: evidence.action,
            conclusion: evidence.conclusion,
            resources: evidence.resources,
            source: evidence.source,
            stateTransition: evidence.stateTransition,
            status: evidence.status,
          },
          id: event.id,
          occurredAt: event.occurred_at,
          project: event.project_id
            ? { id: event.project_id, name: event.project_name ?? "Project" }
            : null,
        };
      }),
    });
  } catch (error) {
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "activity_unavailable", message: "Live activity could not be loaded." } },
      { status: 500 },
    );
  }
}
