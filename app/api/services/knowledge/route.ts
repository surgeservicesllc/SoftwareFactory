import { z } from "zod";

import {
  CRM_KB_ARTICLE_COLUMNS,
  KB_AUDIENCES,
  KB_SLUG_PATTERN,
  slugify,
  toKbArticleView,
  toKbSearchHit,
  type CrmKbArticleRow,
  type CrmKbSearchRow,
} from "@/lib/services/knowledge";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The knowledge base, for staff (ADR-237). A search is `crm_kb_search`
 * under the caller's RLS with the rank printed; a write is a row the
 * caller owns. The slug is derived from the title when not supplied, and
 * a title with nothing usable in it is refused rather than given a made-up
 * slug.
 */

const RESULT_CEILING = 200;

const createSchema = z
  .object({
    title: z.string().trim().min(2).max(160),
    body: z.string().trim().min(1).max(20_000),
    slug: z.string().trim().min(2).max(80).regex(KB_SLUG_PATTERN).optional(),
    category: z.string().trim().min(1).max(60).nullish(),
    audience: z.enum(KB_AUDIENCES).default("staff"),
    published: z.boolean().default(false),
  })
  .strict();

export type KnowledgePayload = {
  query: string;
  audience: string | null;
  publishedOnly: boolean;
  hits: ReturnType<typeof toKbSearchHit>[];
  counts: { total: number; published: number; customer: number };
};

export async function GET(request: Request) {
  try {
    const { activeOrganization, client } = await requireActiveOrganization();
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").slice(0, 200);
    const audienceParam = url.searchParams.get("audience");
    const audience = (KB_AUDIENCES as readonly string[]).includes(audienceParam ?? "") ? audienceParam : null;
    const publishedOnly = url.searchParams.get("published") === "1";

    const [search, all] = await Promise.all([
      client
        .rpc("crm_kb_search", {
          p_organization: activeOrganization.id,
          p_query: query.length > 0 ? query : null,
          p_audience: audience,
          p_published_only: publishedOnly,
        })
        .limit(RESULT_CEILING),
      client.from("crm_kb_articles").select("id, audience, published_at").eq("organization_id", activeOrganization.id).limit(5000),
    ]);
    if (search.error) return databaseErrorResponse(search.error);
    if (all.error) return databaseErrorResponse(all.error);
    const rows = (all.data ?? []) as Array<{ id: string; audience: string; published_at: string | null }>;

    return jsonNoStore({
      query,
      audience,
      publishedOnly,
      hits: ((search.data ?? []) as unknown as CrmKbSearchRow[]).map(toKbSearchHit),
      counts: {
        total: rows.length,
        published: rows.filter((row) => row.published_at !== null).length,
        customer: rows.filter((row) => row.audience === "customer" && row.published_at !== null).length,
      },
    } satisfies KnowledgePayload);
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore({ error: { code: "knowledge_unavailable", message: "The knowledge base could not be loaded." } }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 64_000));
    const slug = payload.slug ?? slugify(payload.title);
    if (slug === null) {
      return jsonNoStore(
        { error: { code: "slug_unavailable", message: "The title has nothing a web address can be made from; give the article a slug." } },
        { status: 422 },
      );
    }
    const { activeOrganization, client, user } = await requireActiveOrganization();
    const { data, error } = await client
      .from("crm_kb_articles")
      .insert({
        organization_id: activeOrganization.id,
        slug,
        title: payload.title,
        body: payload.body,
        category: payload.category ?? null,
        audience: payload.audience,
        published_at: payload.published ? new Date().toISOString() : null,
        created_by: user.id,
        updated_by: user.id,
      })
      .select(CRM_KB_ARTICLE_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23505") {
        return jsonNoStore({ error: { code: "slug_taken", message: `An article already uses the slug “${slug}”.` } }, { status: 409 });
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore({ article: toKbArticleView(data as unknown as CrmKbArticleRow) }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore({ error: { code: "invalid_article", message: error.issues[0]?.message ?? "Invalid article." } }, { status: 422 });
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore({ error: { code: "knowledge_unavailable", message: "The article could not be saved." } }, { status: 500 });
  }
}
