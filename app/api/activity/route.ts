import { z } from "zod";

import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { invalidRequest, rows, withTenant } from "@/lib/server/tenant-route";

export const runtime = "nodejs";

const querySchema = z
  .object({
    projectId: z.string().uuid().optional(),
    eventType: z.string().trim().max(64).optional(),
    entityType: z.string().trim().max(64).optional(),
    search: z.string().trim().max(120).optional(),
    since: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

type ActivityRow = {
  id: string;
  project_id: string | null;
  actor_user_id: string | null;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  description: string;
  occurred_at: string;
};

export async function GET(request: Request) {
  return withTenant(
    async ({ activeOrganization, client }) => {
      const url = new URL(request.url);
      const parsed = querySchema.safeParse(
        Object.fromEntries(
          (["projectId", "eventType", "entityType", "search", "since", "limit"] as const)
            .map((key) => [key, url.searchParams.get(key) ?? undefined])
            .filter(([, value]) => value !== undefined),
        ),
      );
      if (!parsed.success) {
        return invalidRequest("invalid_activity_query", "The activity query is invalid.");
      }

      let query = client
        .from("activity_events")
        // Raw metadata is never returned to a browser; it can carry operational
        // detail that belongs only in the audit record.
        .select("id,project_id,actor_user_id,event_type,entity_type,entity_id,description,occurred_at")
        .eq("organization_id", activeOrganization.id)
        .order("occurred_at", { ascending: false })
        .limit(parsed.data.limit);

      if (parsed.data.projectId) query = query.eq("project_id", parsed.data.projectId);
      if (parsed.data.eventType) query = query.eq("event_type", parsed.data.eventType);
      if (parsed.data.entityType) query = query.eq("entity_type", parsed.data.entityType);
      if (parsed.data.since) query = query.gte("occurred_at", parsed.data.since);
      if (parsed.data.search) {
        const escaped = parsed.data.search.replace(/[%,]/g, " ");
        query = query.ilike("description", `%${escaped}%`);
      }

      const { data, error } = await query;
      if (error) return databaseErrorResponse(error);

      const events = rows<ActivityRow>(data);
      const actorIds = [...new Set(events.flatMap((event) => (event.actor_user_id ? [event.actor_user_id] : [])))];
      const projectIds = [...new Set(events.flatMap((event) => (event.project_id ? [event.project_id] : [])))];

      const [{ data: profiles, error: profilesError }, { data: projects, error: projectsError }] =
        await Promise.all([
          actorIds.length
            ? client.from("profiles").select("id,display_name").in("id", actorIds)
            : Promise.resolve({ data: [], error: null }),
          projectIds.length
            ? client.from("projects").select("id,name").in("id", projectIds)
            : Promise.resolve({ data: [], error: null }),
        ]);
      if (profilesError) return databaseErrorResponse(profilesError);
      if (projectsError) return databaseErrorResponse(projectsError);

      const profilesById = new Map(
        rows<{ id: string; display_name: string | null }>(profiles).map((profile) => [
          profile.id,
          profile.display_name,
        ]),
      );
      const projectsById = new Map(
        rows<{ id: string; name: string }>(projects).map((project) => [project.id, project.name]),
      );

      const { data: eventTypes } = await client
        .from("activity_events")
        .select("event_type")
        .eq("organization_id", activeOrganization.id)
        .order("occurred_at", { ascending: false })
        .limit(500);

      return jsonNoStore({
        activeOrganizationId: activeOrganization.id,
        availableEventTypes: [
          ...new Set(rows<{ event_type: string }>(eventTypes).map((event) => event.event_type)),
        ].sort(),
        events: events.map((event) => ({
          actor: event.actor_user_id
            ? {
              id: event.actor_user_id,
              displayName: profilesById.get(event.actor_user_id) ?? "SoftwareFactory user",
            }
            : { id: null, displayName: "SoftwareFactory system" },
          description: event.description,
          entity: { id: event.entity_id, type: event.entity_type },
          eventType: event.event_type,
          id: event.id,
          occurredAt: event.occurred_at,
          project: event.project_id
            ? { id: event.project_id, name: projectsById.get(event.project_id) ?? "Project" }
            : null,
        })),
      });
    },
    { code: "activity_unavailable", message: "Live activity could not be loaded." },
  );
}
