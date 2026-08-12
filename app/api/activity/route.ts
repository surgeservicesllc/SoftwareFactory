import { z } from "zod";

import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

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
    const { data, error } = await client
      .from("activity_events")
      .select("id,project_id,actor_user_id,event_type,entity_type,entity_id,description,occurred_at")
      .eq("organization_id", activeOrganization.id)
      .order("occurred_at", { ascending: false })
      .limit(parsed.data.limit);
    if (error) return databaseErrorResponse(error);

    const events = data ?? [];
    const actorIds = [...new Set(events.flatMap((event) => event.actor_user_id ? [event.actor_user_id] : []))];
    const projectIds = [...new Set(events.flatMap((event) => event.project_id ? [event.project_id] : []))];
    const [{ data: profiles, error: profilesError }, { data: projects, error: projectsError }] = await Promise.all([
      actorIds.length
        ? client.from("profiles").select("id,display_name").in("id", actorIds)
        : Promise.resolve({ data: [], error: null }),
      projectIds.length
        ? client.from("projects").select("id,name").in("id", projectIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (profilesError) return databaseErrorResponse(profilesError);
    if (projectsError) return databaseErrorResponse(projectsError);

    const profilesById = new Map((profiles ?? []).map((profile) => [profile.id, profile.display_name]));
    const projectsById = new Map((projects ?? []).map((project) => [project.id, project.name]));

    return jsonNoStore({
      activeOrganizationId: activeOrganization.id,
      events: events.map((event) => ({
        actor: event.actor_user_id
          ? { id: event.actor_user_id, displayName: profilesById.get(event.actor_user_id) ?? "SoftwareFactory user" }
          : null,
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
  } catch (error) {
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "activity_unavailable", message: "Live activity could not be loaded." } },
      { status: 500 },
    );
  }
}
