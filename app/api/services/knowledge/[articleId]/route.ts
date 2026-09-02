import { z } from "zod";

import {
  CRM_KB_ARTICLE_COLUMNS,
  KB_AUDIENCES,
  KB_SLUG_PATTERN,
  toKbArticleView,
  type CrmKbArticleRow,
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
 * One article: read whole, edited in place, published or withdrawn, or
 * deleted. Publishing sets the moment once; withdrawing clears it. Every
 * write records who made it on the row.
 */

const idSchema = z.string().uuid();

const patchSchema = z
  .object({
    title: z.string().trim().min(2).max(160).optional(),
    body: z.string().trim().min(1).max(20_000).optional(),
    slug: z.string().trim().min(2).max(80).regex(KB_SLUG_PATTERN).optional(),
    category: z.string().trim().min(1).max(60).nullable().optional(),
    audience: z.enum(KB_AUDIENCES).optional(),
    published: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change." });

type Context = { params: Promise<{ articleId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const articleId = idSchema.parse((await context.params).articleId);
    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client
      .from("crm_kb_articles")
      .select(CRM_KB_ARTICLE_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .eq("id", articleId)
      .maybeSingle();
    if (error) return databaseErrorResponse(error);
    if (!data) return jsonNoStore({ error: { code: "article_not_found", message: "No such article." } }, { status: 404 });
    return jsonNoStore({ article: toKbArticleView(data as unknown as CrmKbArticleRow) });
  } catch (error) {
    if (error instanceof z.ZodError) return jsonNoStore({ error: { code: "article_not_found", message: "No such article." } }, { status: 404 });
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore({ error: { code: "knowledge_unavailable", message: "The article could not be loaded." } }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOriginRequest(request);
    const articleId = idSchema.parse((await context.params).articleId);
    const payload = patchSchema.parse(await readBoundedJson(request, 64_000));
    const { activeOrganization, client, user } = await requireActiveOrganization();

    const changes: Record<string, unknown> = { updated_by: user.id };
    if (payload.title !== undefined) changes.title = payload.title;
    if (payload.body !== undefined) changes.body = payload.body;
    if (payload.slug !== undefined) changes.slug = payload.slug;
    if (payload.category !== undefined) changes.category = payload.category;
    if (payload.audience !== undefined) changes.audience = payload.audience;
    if (payload.published !== undefined) {
      if (payload.published) {
        // Publishing keeps the first moment: re-saving a published article is not a new publication.
        const current = await client.from("crm_kb_articles").select("published_at").eq("organization_id", activeOrganization.id).eq("id", articleId).maybeSingle();
        if (current.error) return databaseErrorResponse(current.error);
        if (!current.data) return jsonNoStore({ error: { code: "article_not_found", message: "No such article." } }, { status: 404 });
        changes.published_at = (current.data as { published_at: string | null }).published_at ?? new Date().toISOString();
      } else {
        changes.published_at = null;
      }
    }

    const { data, error } = await client
      .from("crm_kb_articles")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", articleId)
      .select(CRM_KB_ARTICLE_COLUMNS)
      .maybeSingle();
    if (error) {
      if (error.code === "23505") {
        return jsonNoStore({ error: { code: "slug_taken", message: "Another article already uses that slug." } }, { status: 409 });
      }
      return databaseErrorResponse(error);
    }
    if (!data) return jsonNoStore({ error: { code: "article_not_found", message: "No such article." } }, { status: 404 });
    return jsonNoStore({ article: toKbArticleView(data as unknown as CrmKbArticleRow) });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore({ error: { code: "invalid_article", message: error.issues[0]?.message ?? "Invalid change." } }, { status: 422 });
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore({ error: { code: "knowledge_unavailable", message: "The article could not be saved." } }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOriginRequest(request);
    const articleId = idSchema.parse((await context.params).articleId);
    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client
      .from("crm_kb_articles")
      .delete()
      .eq("organization_id", activeOrganization.id)
      .eq("id", articleId)
      .select("id")
      .maybeSingle();
    if (error) return databaseErrorResponse(error);
    if (!data) return jsonNoStore({ error: { code: "article_not_found", message: "No such article." } }, { status: 404 });
    return jsonNoStore({ deleted: articleId });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) return jsonNoStore({ error: { code: "article_not_found", message: "No such article." } }, { status: 404 });
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore({ error: { code: "knowledge_unavailable", message: "The article could not be deleted." } }, { status: 500 });
  }
}
