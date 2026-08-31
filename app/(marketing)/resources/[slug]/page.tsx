import { ArrowLeft, BookOpenCheck, Clock, PlayCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MARKETING_RESOURCES } from "@/lib/marketing/content";

/**
 * One resource from the library.
 *
 * These entries previously carried `href: "#"` — eight links on a public page
 * that went nowhere. The listing was real (title, summary, level, reading
 * time, topic); what was missing was somewhere for it to lead.
 *
 * So this shows exactly what the library knows and says plainly that the piece
 * itself is not published yet. That is the honest version: inventing an
 * article to fill the page would be worse than the dead link it replaces, and
 * `AGENTS.md` is explicit that nothing may imply something exists when it does
 * not.
 */

const KIND_LABELS: Record<string, string> = {
  guide: "Guide",
  tutorial: "Tutorial",
  video: "Video",
  checklist: "Checklist",
  "case-study": "Case study",
  template: "Template",
};

function findResource(slug: string) {
  return MARKETING_RESOURCES.find((resource) => resource.slug === slug) ?? null;
}

/*
 * The library is known at build time, so a slug outside it is not a page that
 * might appear later — it is a wrong address. Without this, an unknown slug
 * rendered the not-found body with a 200, which tells a crawler the page
 * exists and tells a person nothing.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return MARKETING_RESOURCES.map((resource) => ({ slug: resource.slug }));
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const resource = findResource(slug);
  // Never describe an unknown slug as a real resource. The request boundary
  // establishes the 404 status before streaming; this remains a server-render
  // defense if the page is invoked through another rendering path.
  if (!resource) notFound();
  return { title: resource.title, description: resource.summary };
}

export default async function ResourcePage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const resource = findResource(slug);
  if (!resource) notFound();

  const Icon = resource.kind === "video" ? PlayCircle : BookOpenCheck;

  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <Link
        href="/resources"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-[var(--accent-text)] hover:text-[var(--accent)]"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All resources
      </Link>

      <p className="mt-6 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--accent-text)]">
        {KIND_LABELS[resource.kind] ?? resource.kind}
        {resource.topic ? ` · ${resource.topic}` : ""}
      </p>

      <h1 className="mt-3 text-balance text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
        {resource.title}
      </h1>

      <p className="mt-4 text-pretty text-[15px] leading-7 text-muted">{resource.summary}</p>

      <dl className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-line py-4 text-sm text-faint">
        {resource.readTime ? (
          <div className="flex items-center gap-2">
            <dt className="sr-only">Reading time</dt>
            <Clock className="size-4 shrink-0" aria-hidden="true" />
            <dd>{resource.readTime}</dd>
          </div>
        ) : null}
        {resource.level ? (
          <div className="flex items-center gap-2">
            <dt className="sr-only">Level</dt>
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <dd>{resource.level}</dd>
          </div>
        ) : null}
      </dl>

      {/*
        The whole point of this page. Saying "coming soon" would be a promise
        with no date behind it; this states what exists and what does not.
      */}
      <section className="mt-8 rounded-2xl border border-line-strong bg-surface p-5 sm:p-6">
        <h2 className="text-base font-semibold text-foreground">
          This one is not written yet
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          The library lists it because it is planned, and this page shows
          everything we currently hold about it. There is no article behind it
          yet, and we would rather say so than show you a page pretending
          otherwise.
        </p>
        <Link
          href="/resources"
          className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-line-strong bg-surface-raised px-4 text-sm font-semibold text-muted transition-colors hover:border-[var(--text-faint)] hover:text-foreground"
        >
          Browse what is published
        </Link>
      </section>
    </article>
  );
}
