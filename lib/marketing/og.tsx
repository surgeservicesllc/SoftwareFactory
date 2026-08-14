import { ImageResponse } from "next/og";

import { seedContentForPage } from "@/lib/marketing/content";
import { getPublicMarketingContent } from "@/lib/marketing/queries";

/**
 * Shared Open Graph / Twitter card renderer for the marketing routes.
 *
 * Each route's `opengraph-image.tsx` and `twitter-image.tsx` is a three-line
 * re-export of this module so the seven pages cannot drift apart visually.
 *
 * The card carries page copy only — eyebrow, headline, subheadline. It
 * deliberately renders no statistics, counts, or status: those values come from
 * seeded fallback content when Supabase is unhosted, and a social card has
 * nowhere to carry the **Demo Data** label that the pages themselves show. Copy
 * is copy either way, so the card stays truthful from both sources.
 */

export const size = { width: 1200, height: 630 } as const;
export const contentType = "image/png";

/**
 * Cards are rendered by crawlers, not people, and the copy behind them changes
 * at the pace of marketing edits. Re-render hourly rather than per request.
 */
export const revalidate = 3600;

const GROUND = "#080b10";
const BORDER = "#1e2634";
const MUTED = "#93a0af";
const VIOLET = "#7c5cff";
const BLUE = "#4d8dff";
const ACCENT_GRADIENT = `linear-gradient(100deg, ${VIOLET} 0%, ${BLUE} 100%)`;

/**
 * Alt text for a route's card.
 *
 * `alt` is a static module export that Next.js reads at build time, so it
 * cannot await the database. It reads the seeded title, which matches the
 * hosted copy — the contract test keeps the seed and the migration in step.
 */
export function ogAltFor(slug: string): string {
  return seedContentForPage(slug).page?.seoTitle ?? "AI Software Factory";
}

/** Trim to a word boundary so a card never ends mid-word. */
export function clampOgText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Keep long headlines inside the card instead of letting them overflow. */
export function headlineFontSize(length: number): number {
  if (length > 76) return 52;
  if (length > 52) return 60;
  return 70;
}

function Glow({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 620,
        height: 620,
        borderRadius: 620,
        backgroundImage: `radial-gradient(circle, ${color} 0%, rgba(8,11,16,0) 70%)`,
      }}
    />
  );
}

function Wordmark() {
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 52,
          height: 52,
          borderRadius: 14,
          backgroundImage: ACCENT_GRADIENT,
        }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path
            d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div
        style={{
          marginLeft: 16,
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: 3,
          color: "#ffffff",
        }}
      >
        AI SOFTWARE FACTORY
      </div>
    </div>
  );
}

/**
 * Render the card for one marketing page.
 *
 * Reads published content when Supabase is reachable and falls back to the
 * seed otherwise — `getPublicMarketingContent` never throws, so image
 * generation cannot fail the build.
 */
export async function renderMarketingOgImage(slug: string): Promise<ImageResponse> {
  const { page } = await getPublicMarketingContent(slug);

  const eyebrow = page?.eyebrow ?? "AI Software Factory";
  const headline = page?.headline ?? "Ship better software,";
  const accent = page?.headlineAccent ?? "faster, with AI.";
  const subheadline = clampOgText(
    page?.subheadline ??
      "Plan, build, test, deploy and scale from one platform, with AI agents and automation at every step.",
    150,
  );
  const fontSize = headlineFontSize(`${headline} ${accent}`.length);

  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          padding: 72,
          backgroundColor: GROUND,
          color: "#ffffff",
          overflow: "hidden",
        }}
      >
        <Glow x={-220} y={-260} color="rgba(124,92,255,0.30)" />
        <Glow x={780} y={220} color="rgba(77,141,255,0.22)" />

        <Wordmark />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
          }}
        >
          <div
            style={{
              fontSize: 21,
              fontWeight: 600,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: VIOLET,
            }}
          >
            {clampOgText(eyebrow, 48)}
          </div>
          <div
            style={{
              marginTop: 22,
              fontSize,
              fontWeight: 700,
              lineHeight: 1.1,
              color: "#ffffff",
            }}
          >
            {clampOgText(headline, 90)}
          </div>
          {accent ? (
            <div
              style={{
                fontSize,
                fontWeight: 700,
                lineHeight: 1.1,
                backgroundImage: ACCENT_GRADIENT,
                backgroundClip: "text",
                WebkitBackgroundClip: "text",
                color: "transparent",
              }}
            >
              {clampOgText(accent, 90)}
            </div>
          ) : null}
          <div
            style={{
              marginTop: 26,
              maxWidth: 900,
              fontSize: 26,
              lineHeight: 1.45,
              color: MUTED,
            }}
          >
            {subheadline}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 28,
            borderTop: `1px solid ${BORDER}`,
          }}
        >
          <div style={{ fontSize: 22, color: MUTED }}>
            Plan · Build · Test · Deploy · Scale
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              height: 8,
              width: 160,
              borderRadius: 8,
              backgroundImage: ACCENT_GRADIENT,
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
