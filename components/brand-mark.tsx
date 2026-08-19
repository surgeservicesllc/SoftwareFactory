import Link from "next/link";

import { cn } from "@/lib/cn";

/**
 * The AI Software Factory mark, in one place.
 *
 * It appeared twice — once in the global header, once in the console sidebar —
 * drawn differently each time, so the same product had two logos depending on
 * which half of the page you looked at. This is the single drawing both now
 * render, which is also the only way a change to it stays a single change.
 *
 * The two lines are deliberately different colours rather than decoration:
 * "AI SOFTWARE" is the product and reads as text, "FACTORY" is the mark and
 * carries the accent. Both are `aria-hidden` inside one labelled link, so a
 * screen reader hears the product name once instead of spelling out a
 * two-line lockup.
 */

export function BrandMark({
  href = "/",
  label = "AI Software Factory home",
  className,
  /** The header sits on dark chrome at every breakpoint; the console follows its theme. */
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
        "focus-visible:outline-offset-2 focus-visible:outline-[#7c5cff]",
        className,
      )}
    >
      <svg viewBox="0 0 40 44" className="size-9 shrink-0 sm:size-10" aria-hidden="true">
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
          fill={tone === "chrome" ? "#ffffff" : "currentColor"}
          className={tone === "console" ? "text-foreground" : undefined}
        >
          AI
        </text>
      </svg>

      {glyphOnly ? null : (
      <span className="min-w-0 leading-none" aria-hidden="true">
        <span
          className={cn(
            "block truncate text-[15px] font-extrabold uppercase tracking-[-0.005em] sm:text-[17px]",
            tone === "chrome" ? "text-white" : "text-foreground",
          )}
        >
          AI Software
        </span>
        <span className="mt-[3px] block truncate text-[10px] font-extrabold uppercase tracking-[0.34em] text-[#d7f04a] sm:text-[11px]">
          Factory
        </span>
      </span>
      )}
    </Link>
  );
}
