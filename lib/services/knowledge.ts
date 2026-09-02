/**
 * What people look up (ADR-237): the pure side of the knowledge base. The
 * scorer lives in the database and returns its arithmetic; this file maps
 * rows, derives a slug the way the schema requires one, and composes the
 * copilot's answer from counts it was handed.
 */

export const KB_AUDIENCES = ["staff", "customer"] as const;
export type KbAudience = (typeof KB_AUDIENCES)[number];

export const KB_AUDIENCE_LABELS: Readonly<Record<KbAudience, string>> = {
  staff: "Staff only",
  customer: "Customers and staff",
};

export type CrmKbArticleRow = {
  id: string;
  organization_id: string;
  slug: string;
  title: string;
  body: string;
  category: string | null;
  audience: KbAudience;
  published_at: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type KbArticleView = {
  id: string;
  slug: string;
  title: string;
  body: string;
  category: string | null;
  audience: KbAudience;
  publishedAt: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export const CRM_KB_ARTICLE_COLUMNS =
  "id, organization_id, slug, title, body, category, audience, published_at, created_by, updated_by, created_at, updated_at";

export function toKbArticleView(row: CrmKbArticleRow): KbArticleView {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    body: row.body,
    category: row.category,
    audience: row.audience,
    publishedAt: row.published_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type CrmKbSearchRow = {
  id: string;
  slug: string;
  title: string;
  category: string | null;
  audience: KbAudience;
  published_at: string | null;
  updated_at: string;
  rank: number;
  title_hits: number;
  body_hits: number;
  excerpt: string;
};

export type KbSearchHit = {
  id: string;
  slug: string;
  title: string;
  category: string | null;
  audience: KbAudience;
  publishedAt: string | null;
  updatedAt: string;
  rank: number;
  titleHits: number;
  bodyHits: number;
  excerpt: string;
};

export function toKbSearchHit(row: CrmKbSearchRow): KbSearchHit {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category,
    audience: row.audience,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    rank: Number(row.rank),
    titleHits: Number(row.title_hits),
    bodyHits: Number(row.body_hits),
    excerpt: row.excerpt,
  };
}

export type CrmPortalArticleRow = {
  id: string;
  slug: string;
  title: string;
  category: string | null;
  body: string;
  published_at: string;
  rank: number;
  excerpt: string;
};

export type PortalArticleView = {
  id: string;
  slug: string;
  title: string;
  category: string | null;
  body: string;
  publishedAt: string;
  rank: number;
  excerpt: string;
};

export function toPortalArticleView(row: CrmPortalArticleRow): PortalArticleView {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category,
    body: row.body,
    publishedAt: row.published_at,
    rank: Number(row.rank),
    excerpt: row.excerpt,
  };
}

/**
 * The slug the schema accepts: lower-case words joined by single hyphens,
 * 2–80 characters. Derived from the title when the author does not supply
 * one, and never invented: a title with no usable characters yields null
 * so the caller can say so rather than save "article-1".
 */
export function slugify(value: string): string | null {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug.length >= 2 ? slug : null;
}

export const KB_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** "Why is this first?" — the rank, in words a person can check against the article. */
export function explainRank(hit: { rank: number; titleHits: number; bodyHits: number }): string {
  if (hit.rank === 0) return "no search words";
  const parts: string[] = [];
  if (hit.titleHits > 0) parts.push(`${hit.titleHits} in the title ×3`);
  if (hit.bodyHits > 0) parts.push(`${hit.bodyHits} in the body`);
  return `${hit.rank}: ${parts.join(" + ")}`;
}

/**
 * The copilot's answer: the articles that matched the question, most
 * relevant first, and where to read them. Says when nothing matched — and
 * when nothing is written at all — rather than inventing an answer.
 */
export function composeKnowledgeAnswer(facts: {
  terms: string[];
  total: number;
  hits: Array<{ title: string; audience: KbAudience; published: boolean; excerpt: string; rank: number }>;
}): string {
  if (facts.total === 0) {
    return "Nothing has been written in the knowledge base yet. The first article goes on the Knowledge page.";
  }
  if (facts.terms.length === 0) {
    return `${facts.total} ${facts.total === 1 ? "article is" : "articles are"} in the knowledge base. Ask with a word from the topic — "what do we tell customers about ants" — and the ones that mention it come back first.`;
  }
  const words = facts.terms.map((term) => `"${term}"`).join(", ");
  if (facts.hits.length === 0) {
    return `No article mentions ${words}. ${facts.total} ${facts.total === 1 ? "article is" : "articles are"} written; the gap is on the Knowledge page.`;
  }
  const named = facts.hits.slice(0, 3).map((hit) => {
    const state = hit.published ? (hit.audience === "customer" ? "published to customers" : "published, staff only") : "draft";
    const excerpt = hit.excerpt.trim().replace(/\s+/g, " ");
    return `"${hit.title}" (${state}, rank ${hit.rank}): ${excerpt.length > 140 ? `${excerpt.slice(0, 137)}…` : excerpt}`;
  });
  const count = facts.hits.length;
  return `${count} ${count === 1 ? "article mentions" : "articles mention"} ${words}. ${named.join(" ")} The full text is on the Knowledge page.`;
}
