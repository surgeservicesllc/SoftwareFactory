import { toPortalArticleView, type CrmPortalArticleRow } from "@/lib/services/knowledge";
import { jsonNoStore } from "@/lib/server/http";
import { portalErrorResponse, requirePortalUser } from "@/lib/server/customer-portal";

export const runtime = "nodejs";

/**
 * Help, for the customer (ADR-237): the published, customer-audience
 * articles of their own workspace, searched by the same scorer staff use.
 * The definer takes no organization — it resolves the caller's account —
 * so nothing here can be pointed at another workspace.
 */
export async function GET(request: Request) {
  try {
    const query = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 200);
    const { client } = await requirePortalUser();
    const { data, error } = await client.rpc("crm_portal_articles", { p_query: query.length > 0 ? query : null });
    if (error) throw error;
    const articles = ((data ?? []) as CrmPortalArticleRow[]).map(toPortalArticleView);
    return jsonNoStore({ query, articles, counts: { total: articles.length } });
  } catch (error) {
    return portalErrorResponse(error, "portal_articles_unavailable", "Help articles could not be loaded.");
  }
}
