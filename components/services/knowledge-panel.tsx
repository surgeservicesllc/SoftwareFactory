"use client";

import { BookOpen, Globe, Search, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Card, MetricCard, Notice, PageHeader, SectionTitle } from "@/components/ui";
import {
  KB_AUDIENCE_LABELS,
  KB_AUDIENCES,
  explainRank,
  slugify,
  type KbArticleView,
  type KbAudience,
  type KbSearchHit,
} from "@/lib/services/knowledge";

/**
 * Knowledge (ADR-237): answers written once. A search is the database's
 * own scorer and the rank is printed beside every hit, so "why is this
 * first?" is answered on the page. Publishing to customers is a flag on
 * the row, and a draft is a draft for everybody.
 */

type Payload = {
  query: string;
  audience: string | null;
  publishedOnly: boolean;
  hits: KbSearchHit[];
  counts: { total: number; published: number; customer: number };
};

type Draft = {
  id: string | null;
  title: string;
  slug: string;
  category: string;
  audience: KbAudience;
  body: string;
  published: boolean;
};

const EMPTY: Draft = { id: null, title: "", slug: "", category: "", audience: "staff", body: "", published: false };

async function readFailure(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}

export function ServicesKnowledgePanel() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [audience, setAudience] = useState<"" | KbAudience>("");
  const [publishedOnly, setPublishedOnly] = useState(false);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const search = useCallback(async (q: string, aud: "" | KbAudience, pub: boolean) => {
    const params = new URLSearchParams();
    if (q.trim().length > 0) params.set("q", q.trim());
    if (aud !== "") params.set("audience", aud);
    if (pub) params.set("published", "1");
    const suffix = params.toString();
    try {
      const response = await fetch(`/api/services/knowledge${suffix ? `?${suffix}` : ""}`, { headers: { accept: "application/json" } });
      if (!response.ok) {
        setLoadError(await readFailure(response, "The knowledge base could not be loaded."));
        return;
      }
      setLoadError("");
      setPayload((await response.json()) as Payload);
    } catch {
      setLoadError("The knowledge base could not be loaded.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void search("", "", false), 0);
    return () => window.clearTimeout(kickoff);
  }, [search]);

  const open = useCallback(async (id: string) => {
    setError("");
    setMessage("");
    setConfirmDelete(false);
    const response = await fetch(`/api/services/knowledge/${id}`, { headers: { accept: "application/json" } });
    if (!response.ok) {
      setError(await readFailure(response, "The article could not be loaded."));
      return;
    }
    const { article } = (await response.json()) as { article: KbArticleView };
    setDraft({
      id: article.id,
      title: article.title,
      slug: article.slug,
      category: article.category ?? "",
      audience: article.audience,
      body: article.body,
      published: article.publishedAt !== null,
    });
  }, []);

  const save = useCallback(async () => {
    if (draft === null) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body = {
        title: draft.title.trim(),
        body: draft.body.trim(),
        ...(draft.slug.trim().length > 0 ? { slug: draft.slug.trim() } : {}),
        category: draft.category.trim().length > 0 ? draft.category.trim() : null,
        audience: draft.audience,
        published: draft.published,
      };
      const response = await fetch(draft.id === null ? "/api/services/knowledge" : `/api/services/knowledge/${draft.id}`, {
        method: draft.id === null ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setError(await readFailure(response, "The article could not be saved."));
        return;
      }
      const { article } = (await response.json()) as { article: KbArticleView };
      setDraft({ ...draft, id: article.id, slug: article.slug, published: article.publishedAt !== null });
      setMessage(draft.id === null ? `Saved “${article.title}”.` : `Updated “${article.title}”.`);
      await search(query, audience, publishedOnly);
    } finally {
      setBusy(false);
    }
  }, [audience, draft, publishedOnly, query, search]);

  const remove = useCallback(async () => {
    if (draft === null || draft.id === null) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/services/knowledge/${draft.id}`, { method: "DELETE" });
      if (!response.ok) {
        setError(await readFailure(response, "The article could not be deleted."));
        return;
      }
      setMessage(`Deleted “${draft.title}”.`);
      setDraft(null);
      setConfirmDelete(false);
      await search(query, audience, publishedOnly);
    } finally {
      setBusy(false);
    }
  }, [audience, draft, publishedOnly, query, search]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Knowledge"
        description="Answers written once. Staff search them here; the ones published to customers appear under Help in the portal. The search counts the words that hit — three for the title, one for the body — and prints the number."
      />

      {payload !== null ? (
        <div className="grid gap-3 sm:grid-cols-3" data-testid="services-knowledge-counts">
          <MetricCard label="Articles" value={String(payload.counts.total)} detail="Written in this workspace, drafts included" icon={BookOpen} />
          <MetricCard label="Published" value={String(payload.counts.published)} detail="Drafts are counted above, not here" icon={ShieldCheck} />
          <MetricCard label="Customers can read" value={String(payload.counts.customer)} detail="Published, customer audience" icon={Globe} />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section className="card" data-testid="services-knowledge">
          <SectionTitle title="Find an answer" description="A word from the topic is enough. Plurals match their singular; short words and the usual filler count nothing." />
          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void search(query, audience, publishedOnly);
            }}
          >
            <label className="flex min-w-[12rem] flex-1 flex-col text-xs text-muted">
              Search
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="mt-1 rounded-lg border border-line px-2 py-1 text-sm text-foreground"
                placeholder="ants, invoice, rescheduling…"
                aria-label="Search the knowledge base"
              />
            </label>
            <label className="flex flex-col text-xs text-muted">
              Audience
              <select
                value={audience}
                onChange={(event) => setAudience(event.target.value as "" | KbAudience)}
                className="mt-1 rounded-lg border border-line px-2 py-1 text-sm text-foreground"
                aria-label="Audience"
              >
                <option value="">Any</option>
                {KB_AUDIENCES.map((value) => (
                  <option key={value} value={value}>{KB_AUDIENCE_LABELS[value]}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={publishedOnly} onChange={(event) => setPublishedOnly(event.target.checked)} />
              Published only
            </label>
            <button type="submit" className="btn btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs">
              <Search className="size-3.5" aria-hidden="true" />
              Search
            </button>
            <button
              type="button"
              className="btn btn-primary px-3 py-1.5 text-xs"
              onClick={() => {
                setDraft({ ...EMPTY });
                setError("");
                setMessage("");
                setConfirmDelete(false);
              }}
              data-testid="services-knowledge-new"
            >
              New article
            </button>
          </form>

          {loadError ? <div className="mt-3"><Notice tone="warning">{loadError}</Notice></div> : null}

          {payload === null && !loadError ? (
            <p className="mt-4 text-sm text-muted">Loading the knowledge base…</p>
          ) : payload !== null && payload.hits.length === 0 ? (
            <p className="mt-4 text-sm text-muted" data-testid="services-knowledge-empty">
              {payload.counts.total === 0
                ? "Nothing is written yet. The first article is the one somebody asked for twice."
                : `No article mentions “${payload.query}”. That is a gap worth writing.`}
            </p>
          ) : payload !== null ? (
            <ul className="mt-4 divide-y divide-line" data-testid="services-knowledge-hits">
              {payload.hits.map((hit) => (
                <li key={hit.id} className="py-3">
                  <button
                    type="button"
                    className="text-left"
                    onClick={() => void open(hit.id)}
                    data-testid={`services-knowledge-hit-${hit.slug}`}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <BookOpen className="size-4 text-faint" aria-hidden="true" />
                      <span className="font-medium text-foreground underline-offset-2 hover:underline">{hit.title}</span>
                      <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">{KB_AUDIENCE_LABELS[hit.audience]}</span>
                      {hit.publishedAt === null ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">draft</span>
                      ) : null}
                      {hit.category ? <span className="text-xs text-faint">{hit.category}</span> : null}
                    </span>
                    <span className="mt-1 block text-xs text-muted">{hit.excerpt}</span>
                    {payload.query.length > 0 ? (
                      <span className="mt-1 block text-[11px] text-faint" data-testid={`services-knowledge-rank-${hit.slug}`}>
                        rank {explainRank(hit)}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <Card>
          <SectionTitle
            title={draft === null ? "Article" : draft.id === null ? "New article" : "Edit article"}
            description={draft === null ? "Pick an article on the left, or start a new one." : "Saved as written. Publishing to customers is the audience plus the published flag; a draft is a draft for everybody."}
          />
          {draft === null ? null : (
            <form
              className="mt-3 flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
              data-testid="services-knowledge-editor"
            >
              <label className="flex flex-col text-xs text-muted">
                Title
                <input
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value, slug: draft.id === null && draft.slug === (slugify(draft.title) ?? "") ? (slugify(event.target.value) ?? "") : draft.slug })}
                  className="mt-1 rounded-lg border border-line px-2 py-1 text-sm text-foreground"
                  required
                  minLength={2}
                  maxLength={160}
                  aria-label="Title"
                />
              </label>
              <label className="flex flex-col text-xs text-muted">
                Slug (the address; letters, digits and hyphens)
                <input
                  value={draft.slug}
                  onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
                  className="mt-1 rounded-lg border border-line px-2 py-1 font-mono text-sm text-foreground"
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  maxLength={80}
                  aria-label="Slug"
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col text-xs text-muted">
                  Category
                  <input
                    value={draft.category}
                    onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                    className="mt-1 rounded-lg border border-line px-2 py-1 text-sm text-foreground"
                    maxLength={60}
                    aria-label="Category"
                  />
                </label>
                <label className="flex flex-col text-xs text-muted">
                  Audience
                  <select
                    value={draft.audience}
                    onChange={(event) => setDraft({ ...draft, audience: event.target.value as KbAudience })}
                    className="mt-1 rounded-lg border border-line px-2 py-1 text-sm text-foreground"
                    aria-label="Article audience"
                  >
                    {KB_AUDIENCES.map((value) => (
                      <option key={value} value={value}>{KB_AUDIENCE_LABELS[value]}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="flex flex-col text-xs text-muted">
                Body
                <textarea
                  value={draft.body}
                  onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                  rows={10}
                  required
                  maxLength={20000}
                  className="mt-1 rounded-lg border border-line px-2 py-1 text-sm text-foreground"
                  aria-label="Body"
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={draft.published}
                  onChange={(event) => setDraft({ ...draft, published: event.target.checked })}
                  aria-label="Published"
                />
                Published {draft.audience === "customer" ? "— customers will see it under Help" : "— staff only"}
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={busy} className="btn btn-primary px-3 py-1.5 text-xs" data-testid="services-knowledge-save">
                  {draft.id === null ? "Save article" : "Save changes"}
                </button>
                <button type="button" className="btn btn-secondary px-3 py-1.5 text-xs" onClick={() => setDraft(null)}>
                  Close
                </button>
                {draft.id !== null ? (
                  confirmDelete ? (
                    <button type="button" disabled={busy} className="btn btn-secondary px-3 py-1.5 text-xs text-rose-700" onClick={() => void remove()} data-testid="services-knowledge-delete-confirm">
                      Confirm delete
                    </button>
                  ) : (
                    <button type="button" className="btn btn-secondary px-3 py-1.5 text-xs" onClick={() => setConfirmDelete(true)} data-testid="services-knowledge-delete">
                      Delete
                    </button>
                  )
                ) : null}
              </div>
            </form>
          )}
          {message ? <p className="mt-3 text-sm text-emerald-700" data-testid="services-knowledge-message">{message}</p> : null}
          {error ? <div className="mt-3"><Notice tone="warning">{error}</Notice></div> : null}
        </Card>
      </div>
    </div>
  );
}
