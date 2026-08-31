import Link from "next/link";

import { cn } from "@/lib/cn";

/**
 * The AI Factory mark, in one place.
 *
 * It appeared twice — once in the global header, once in the console sidebar —
 * drawn differently each time, so the same product had two logos depending on
 * which half of the page you looked at. This is the single drawing every
 * caller renders, which is also the only way a change to it stays a single
 * change.
 *
 * One line, not two. It was a stacked lockup — "AI SOFTWARE" over an accented
 * "FACTORY" — and the owner's reference (2026-08-22) is a single white
 * wordmark beside the glyph, so the second line and its accent are gone rather
 * than restyled.
 *
 * The wordmark reads "FACTORY", not "AI Factory" (owner reference,
 * 2026-08-23). The glyph beside it already carries "AI", so spelling it again
 * in the words made the lockup read "AI AI FACTORY" once the two are taken
 * together, which is what the reference removes.
 *
 * The wordmark is `aria-hidden` inside a labelled link, and the label names the
 * whole lockup — glyph and word — rather than only the half that is text: a
 * visible name and an accessible name that disagree is the defect WCAG 2.5.3
 * is about, and "AI Factory home" still contains the visible "FACTORY", so the
 * link keeps announcing the product rather than a bare noun.
 */

export function BrandMark({
  href = "/",
  label = "AI Factory home",
  className,
  /** The global header follows the saved site theme; the console follows its product theme. */
  tone = "chrome",
  /**
   * Glyph only, for the collapsed console rail.
   *
   * The wordmark is already `aria-hidden` and the link carries the accessible
   * name, so dropping it costs a screen reader nothing — and keeping it would
   * make a 64px rail as wide as its longest word.
   */
  glyphOnly = false,
}: {
  href?: string;
  label?: string;
  className?: string;
  tone?: "chrome" | "console";
  glyphOnly?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        // `min-w-0`, not `shrink-0`: the mark shares a 320px bar with the
        // account controls, and a brand that refuses to give is what pushes
        // them off the right edge. The glyph holds its size; the words yield.
        "flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-2",
        "focus-visible:outline-offset-2 focus-visible:outline-[var(--site-accent)]",
        className,
      )}
    >
      <svg
        viewBox="0 0 40 44"
        className={cn(
          "size-9 shrink-0 sm:size-10",
          tone === "chrome" ? "text-[var(--site-text)]" : "text-foreground",
        )}
        aria-hidden="true"
      >
        <defs>
          {/*
            A gradient id must be unique per document: two elements sharing one
            id makes the second reference resolve to the first's definition,
            which is how a mark silently loses its gradient when the header and
            the sidebar are on screen together.
          */}
          <linearGradient id="brand-mark-stroke" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7c5cff" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
        <path
          d="M20 1.5 37 11v22L20 42.5 3 33V11z"
          fill="none"
          stroke="url(#brand-mark-stroke)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <text
          x="20"
          y="26.5"
          textAnchor="middle"
          fontSize="13"
          fontWeight="700"
          fill="currentColor"
        >
          AI
        </text>
      </svg>

      {glyphOnly ? null : (
      <span
        aria-hidden="true"
        className={cn(
          "min-w-0 truncate text-[17px] font-extrabold uppercase leading-none",
          "tracking-[-0.005em] sm:text-[19px]",
          tone === "chrome" ? "text-[var(--site-text)]" : "text-foreground",
        )}
      >
        Factory
      </span>
      )}
    </Link>
  );
}
