import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Saved searches: the query a person built, kept whole so it can be re-run.
 *
 * The table (20260828000400) stores `query` as one jsonb document because the
 * filter vocabulary belongs to the product and grows; this route bounds and
 * validates that document's shape so a browser cannot park arbitrary payloads
 * in it. Ownership is organization + person, enforced twice: the queries here
 * filter on both, and forced RLS beneath refuses anything they miss.
 *
 * "Run now" is `PATCH {id, markRun: true}` — it records `last_run_at` and
 * returns the stored query for the client to execute through the ordinary
 * search endpoint. The server does not re-run the search itself: running it
 * where the person is means the results land where the person is looking,
 * with the same tokens and the same failure reporting as any other search.
 *
 * Alert cadence rows exist in the schema but no delivery engine exists yet,
 * so this route deliberately exposes none of it — a switch wired to nothing
 * is the kind of dead control this repository refuses to ship.
 */

const querySchema = z
  .object({
    text: z.string().trim().max(200).default(""),
    location: z.string().trim().max(120).nullish(),
    boards: z.array(z.string().trim().min(1).max(64)).max(16).optional(),
    sort: z.enum(["returned", "newest", "salary", "match"]).optional(),
    filters: z
      .object({
        keywordMode: z.enum(["and", "or"]).optional(),
        keywords: z.array(z.string().trim().min(1).max(80)).max(16).optional(),
        excludeKeywords: z.array(z.string().trim().min(1).max(80)).max(16).optional(),
        excludeCompanies: z.array(z.string().trim().min(1).max(120)).max(16).optional(),
        workModel: z.enum(["remote", "hybrid", "onsite"]).nullish(),
        salaryMinimum: z.number().int().min(0).max(10_000_000).nullish(),
        requireSalary: z.boolean().optional(),
        postedWithinDays: z.number().int().min(1).max(365).nullish(),
        minimumScore: z.number().int().min(0).max(100).nullish(),
      })
      .strict()
      .optional(),
  })
  .strict();

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    query: querySchema,
  })
  .strict();

const patchSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120).optional(),
    query: querySchema.optional(),
    /** Record that the search was just re-run. */
    markRun: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.query !== undefined || value.markRun === true, {
    message: "Nothing to change.",
  });

const deleteSchema = z.object({ id: z.string().uuid() }).strict();

const COLUMNS = "id, name, query, last_run_at, created_at, updated_at";

type SavedSearchRow = {
  id: string;
  name: string;
  query: unknown;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
};

function toView(row: SavedSearchRow) {
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function conflictResponse() {
  return jsonNoStore(
    {
      error: {
        code: "saved_search_name_taken",
        message: "You already have a saved search with this name.",
      },
    },
    { status: 409 },
  );
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

export async function GET() {
  try {
    const { activeOrganization, user, client } = await requireActiveOrganization();
    const { data, error } = await client
      .from("job_seeker_saved_searches")
      .select(COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({ savedSearches: ((data ?? []) as SavedSearchRow[]).map(toView) });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "saved_searches_unavailable", message: "Saved searches could not be listed." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 32_000));
    const sensitive = findSensitiveData(payload);
    if (sensitive) {
      throw new ApiRequestError(
        422,
        "sensitive_content",
        `The saved search appears to contain a credential-shaped value at ${sensitive.path}; remove it and save again.`,
      );
    }
    const { activeOrganization, user, client } = await requireActiveOrganization();
    const { data, error } = await client
      .from("job_seeker_saved_searches")
      .insert({
        organization_id: activeOrganization.id,
        user_id: user.id,
        name: payload.name,
        query: payload.query,
      })
      .select(COLUMNS)
      .single<SavedSearchRow>();
    if (isUniqueViolation(error)) return conflictResponse();
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({ savedSearch: toView(data) }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "saved_search_invalid",
            message: "The saved search is not valid.",
            issues: error.issues.slice(0, 5),
          },
        },
        { status: 422 },
      );
    }
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "saved_search_failed", message: "The search could not be saved." } },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = patchSchema.parse(await readBoundedJson(request, 32_000));
    const sensitive = findSensitiveData(payload);
    if (sensitive) {
      throw new ApiRequestError(
        422,
        "sensitive_content",
        `The saved search appears to contain a credential-shaped value at ${sensitive.path}; remove it and save again.`,
      );
    }
    const { activeOrganization, user, client } = await requireActiveOrganization();
    const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (payload.name !== undefined) changes.name = payload.name;
    if (payload.query !== undefined) changes.query = payload.query;
    if (payload.markRun === true) changes.last_run_at = new Date().toISOString();
    const { data, error } = await client
      .from("job_seeker_saved_searches")
      .update(changes)
      .eq("id", payload.id)
      .eq("organization_id", activeOrganization.id)
      .eq("user_id", user.id)
      .select(COLUMNS)
      .maybeSingle<SavedSearchRow>();
    if (isUniqueViolation(error)) return conflictResponse();
    if (error) return databaseErrorResponse(error);
    if (data === null) {
      return jsonNoStore(
        { error: { code: "saved_search_missing", message: "That saved search does not exist." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ savedSearch: toView(data) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "saved_search_invalid", message: "The change is not valid.", issues: error.issues.slice(0, 5) } },
        { status: 422 },
      );
    }
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "saved_search_failed", message: "The saved search could not be changed." } },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = deleteSchema.parse(await readBoundedJson(request, 4_000));
    const { activeOrganization, user, client } = await requireActiveOrganization();
    const { data, error } = await client
      .from("job_seeker_saved_searches")
      .delete()
      .eq("id", payload.id)
      .eq("organization_id", activeOrganization.id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle<{ id: string }>();
    if (error) return databaseErrorResponse(error);
    if (data === null) {
      return jsonNoStore(
        { error: { code: "saved_search_missing", message: "That saved search does not exist." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ deleted: data.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "saved_search_invalid", message: "The request is not valid." } },
        { status: 422 },
      );
    }
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "saved_search_failed", message: "The saved search could not be deleted." } },
      { status: 500 },
    );
  }
}
