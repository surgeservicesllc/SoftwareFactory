"use client";

import { BookOpenCheck, Clock, PlayCircle, Search } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";

import { SurfacePanel } from "@/components/marketing/primitives";
import { cn } from "@/lib/cn";
import type { MarketingResource, MarketingResourceKind } from "@/lib/marketing/types";

const KIND_LABELS: Readonly<Record<MarketingResourceKind, string>> = {
  guide: "Guide",
  template: "Template",
  video: "Video",
  case_study: "Case Study",
  checklist: "Checklist",
  documentation: "Docs",
  download: "Download",
};

const KIND_TONES: Readonly<Record<MarketingResourceKind, string>> = {
  guide: "border-[#3b2f6b] bg-[#171233] text-[#c4b5fd]",
  template: "border-[#26406b] bg-[#0f1c33] text-[#93c5fd]",
  video: "border-[#5a2a63] bg-[#241030] text-[#f0abfc]",
  case_study: "border-[#1d5045] bg-[#0a2620] text-[#6ee7b7]",
  checklist: "border-[#5c4318] bg-[#2a1f09] text-[#fcd34d]",
  documentation: "border-[#1e4a63] bg-[#0b2130] text-[#7dd3fc]",
  download: "border-[#1e4a63] bg-[#0b2130] text-[#7dd3fc]",
};

/**
 * Searchable resource library.
 *
 * Filtering happens on the already-loaded set, so typing never issues a request
 * and the empty state is honest about what was searched.
 */
export function ResourceLibrary({ resources }: { resources: readonly MarketingResource[] }) {
  const searchId = useId();
  const [query, setQuery] = useState("");

  const trimmed = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!trimmed) return resources.filter((resource) => resource.featured);
    return resources.filter((resource) =>
      [resource.title, resource.summary, resource.topic ?? "", KIND_LABELS[resource.kind]]
        .join(" ")
        .toLowerCase()
        .includes(trimmed),
    );
  }, [resources, trimmed]);

  return (
    <>
      <div className="relative max-w-xl">
        <label htmlFor={searchId} className="sr-only">
          Search guides, templates, docs and more
        </label>
        <Search
          className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#5c6878]"
          aria-hidden="true"
        />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search guides, templates, docs and more..."
          className="h-12 w-full rounded-xl border border-[#2b3547] bg-[#0a0f18] pl-11 pr-4 text-sm text-[#dce2e8] placeholder:text-[#5c6878] focus:border-[#5d6bff] focus:outline-none"
        />
      </div>

      <div className="mt-10 flex items-end justify-between gap-4">
        <h2 className="text-[22px] font-semibold tracking-[-0.03em] text-white sm:text-[26px]">
          {trimmed ? `Results for “${query.trim()}”` : "Featured Resources"}
        </h2>
        <p className="shrink-0 text-xs text-[#7f8c9e]" aria-live="polite">
          {matches.length} {matches.length === 1 ? "resource" : "resources"}
        </p>
      </div>

      {matches.length ? (
        <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {matches.map((resource) => (
            <li key={resource.slug} className="relative">
              <SurfacePanel className="flex h-full flex-col overflow-hidden">
                <div className="relative h-32 bg-gradient-to-br from-[#141b2c] via-[#131a30] to-[#0a0f1a]">
                  <span
                    className={cn(
                      "absolute left-3 top-3 rounded-md border px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em]",
                      KIND_TONES[resource.kind],
                    )}
                  >
                    {KIND_LABELS[resource.kind]}
                  </span>
                  {resource.kind === "video" ? (
                    <PlayCircle
                      className="absolute left-1/2 top-1/2 size-11 -translate-x-1/2 -translate-y-1/2 text-white/80"
                      aria-hidden="true"
                    />
                  ) : (
                    <BookOpenCheck
                      className="absolute left-1/2 top-1/2 size-9 -translate-x-1/2 -translate-y-1/2 text-[#31405c]"
                      aria-hidden="true"
                    />
                  )}
                </div>

                <div className="flex flex-1 flex-col p-4">
                  <h3 className="text-[13px] font-semibold leading-5 text-white">
                    {/*
                      The link wrapped the title text alone, leaving a 15px-tall
                      tap target on a card several hundred pixels tall. The
                      stretched pseudo-element makes the whole card the target
                      without nesting a second interactive element inside it,
                      and the title is still the accessible name.

                      Several entries carry `href: "#"`, which is a link that
                      goes nowhere. That is a real defect, but not one this
                      change can fix: there is no `/resources/[slug]` page for
                      them to point at, so the destination has to be decided
                      rather than guessed. Recorded in todo.md.
                    */}
                    <Link
                      href={resource.href}
                      className="after:absolute after:inset-0 after:z-10 after:content-[''] hover:text-[#c4b5fd] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c5cff]"
                    >
                      {resource.title}
                    </Link>
                  </h3>                  <p className="mt-2 flex-1 text-[11px] leading-5 text-[#7f8c9e]">{resource.summary}</p>
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[#151c28] pt-3 text-[10px] text-[#7f8c9e]">
                    {resource.readTime ? (
                      <span className="flex items-center gap-1.5">
                        <Clock className="size-3" aria-hidden="true" />
                        {resource.readTime}
                      </span>
                    ) : null}
                    {resource.level ? (
                      <span className="flex items-center gap-1.5">
                        <BookOpenCheck className="size-3" aria-hidden="true" />
                        {resource.level}
                      </span>
                    ) : null}
                  </div>
                </div>
              </SurfacePanel>
            </li>
          ))}
        </ul>
      ) : (
        <SurfacePanel className="mt-5 grid min-h-40 place-items-center p-8 text-center">
          <div>
            <p className="text-sm font-semibold text-white">No resources match “{query.trim()}”</p>
            <p className="mt-2 text-xs text-[#7f8c9e]">
              Try a broader term, or clear the search to see what is featured.
            </p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="mt-4 inline-flex min-h-9 items-center rounded-xl border border-[#2b3547] px-4 text-xs font-semibold text-[#c8d2df] hover:border-[#44536a] hover:text-white"
            >
              Clear search
            </button>
          </div>
        </SurfacePanel>
      )}
    </>
  );
}
