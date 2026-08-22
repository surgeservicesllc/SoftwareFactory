"use client";

import { cn } from "@/lib/cn";
import type { StatusSlice, TimelinePoint } from "@/lib/job-seeker/overview";

/**
 * The Overview's three charts, drawn as inline SVG.
 *
 * No charting library: these are three fixed shapes over small, already-derived
 * arrays, and a dependency would cost more than it saves — in bundle, in
 * upgrade surface, and in the freedom to make them theme-aware and accessible
 * on this project's own terms.
 *
 * Two rules hold across all three. Colour never carries a fact on its own:
 * every series is also labelled in text beside the drawing, and the SVG itself
 * is `aria-hidden` with the real content in a list or table the reader gets
 * instead. And nothing is drawn from a rounded percentage — rounded shares do
 * not sum to the whole, and a ring built from them ends with a wedge of
 * nothing.
 */

/** Enough hues to separate eleven stages, in a fixed order so it is stable. */
const SERIES_COLORS = [
  "var(--accent)",
  "#5b8def",
  "#a78bfa",
  "#f59e0b",
  "#34d399",
  "#f472b6",
  "#22d3ee",
  "#fb7185",
  "#c084fc",
  "#4ade80",
  "#94a3b8",
] as const;

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

/**
 * The application-status ring.
 *
 * A stroked circle per slice, offset around the circumference — the same
 * counts `byStage` reports, so the ring and the legend cannot disagree. The
 * total sits in the middle, because "how many applications" is the question
 * the shape is answering.
 */
export function StatusRing({
  slices,
  total,
  className,
}: {
  slices: readonly StatusSlice[];
  total: number;
  className?: string;
}) {
  // A 100-unit circumference makes every dash value a percentage directly.
  const radius = 100 / (2 * Math.PI);
  const size = 42;
  const center = size / 2;

  return (
    <div className={cn("flex flex-wrap items-center gap-5", className)}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="size-40 shrink-0"
        role="img"
        aria-label={`${total} applications by status`}
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--surface-inset)"
          strokeWidth={7}
        />
        {slices.map((slice, index) => (
          <circle
            key={slice.stage}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={seriesColor(index)}
            strokeWidth={7}
            // `pathLength` normalizes the circumference to 100 whatever the
            // radius is, so the dash maths never has to know the geometry.
            pathLength={100}
            strokeDasharray={`${slice.fraction * 100} ${100 - slice.fraction * 100}`}
            strokeDashoffset={-slice.offset * 100}
            // Start at twelve o'clock rather than three, which is where a
            // reader expects a ring to begin.
            transform={`rotate(-90 ${center} ${center})`}
          />
        ))}
        <text
          x={center}
          y={center - 1}
          textAnchor="middle"
          className="fill-[var(--text)] text-[5px] font-semibold"
        >
          {total}
        </text>
        <text
          x={center}
          y={center + 4}
          textAnchor="middle"
          className="fill-[var(--text-faint)] text-[2.6px]"
        >
          Total
        </text>
      </svg>

      <ul className="min-w-44 flex-1 space-y-1.5">
        {slices.map((slice, index) => (
          <li key={slice.stage} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: seriesColor(index) }}
            />
            <span className="min-w-0 flex-1 truncate text-muted">{slice.label}</span>
            <span className="shrink-0 text-foreground">
              {slice.count} <span className="text-faint">({slice.percent}%)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The match-score distribution: horizontal bars against a shared axis.
 *
 * The axis is scaled to the largest band rather than to the total, so a
 * distribution where one band dominates still shows the others as more than
 * hairlines — and the tick labels say what the scale is, so the exaggeration
 * cannot be read as a count.
 */
export function ScoreDistribution({
  bands,
  className,
}: {
  bands: ReadonlyArray<{ label: string; count: number; percent: number }>;
  className?: string;
}) {
  const peak = bands.reduce((max, band) => Math.max(max, band.count), 0);
  const axisMax = niceCeiling(peak);
  const ticks = [0, axisMax / 4, axisMax / 2, (axisMax * 3) / 4, axisMax];

  return (
    <div className={cn("space-y-2", className)}>
      <ul className="space-y-2">
        {bands.map((band) => (
          <li key={band.label} className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-right text-sm text-muted">{band.label}</span>
            <span className="relative h-5 flex-1 overflow-hidden rounded bg-[var(--surface-inset)]">
              <span
                className="block h-full rounded bg-[var(--accent)]"
                style={{ width: axisMax > 0 ? `${(band.count / axisMax) * 100}%` : "0%" }}
              />
            </span>
            <span className="w-10 shrink-0 text-sm text-foreground">{band.count}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="w-16 shrink-0" />
        <span className="flex flex-1 justify-between text-xs text-faint">
          {ticks.map((tick) => <span key={tick}>{Math.round(tick)}</span>)}
        </span>
        <span className="w-10 shrink-0" />
      </div>
      <p className="pl-[4.75rem] text-xs text-faint">Number of jobs</p>
    </div>
  );
}

/**
 * Applications over time: a cumulative line with its own axis.
 *
 * Drawn from a point per day including the empty ones, so a quiet fortnight
 * reads as flat rather than being compressed out of existence. The `<title>`
 * and the summary underneath carry the same facts for anyone who is not
 * reading the shape.
 */
export function ApplicationsOverTime({
  points,
  peak,
  className,
}: {
  points: readonly TimelinePoint[];
  peak: number;
  className?: string;
}) {
  const width = 320;
  const height = 120;
  const padding = { bottom: 18, left: 26, right: 6, top: 8 };
  const axisMax = niceCeiling(peak);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const x = (index: number) =>
    padding.left + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (value: number) =>
    padding.top + plotHeight - (axisMax > 0 ? (value / axisMax) * plotHeight : 0);

  const line = points.map((point, index) => `${x(index)},${y(point.cumulative)}`).join(" ");
  const area = points.length > 0
    ? `${padding.left},${y(0)} ${line} ${x(points.length - 1)},${y(0)}`
    : "";
  const ticks = [0, axisMax / 2, axisMax];
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-32 w-full"
        role="img"
        aria-label={
          last
            ? `${last.cumulative} applications submitted in total by ${formatDay(last.date)}`
            : "No applications submitted"
        }
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--border)"
              strokeWidth={0.5}
            />
            <text
              x={padding.left - 4}
              y={y(tick) + 3}
              textAnchor="end"
              className="fill-[var(--text-faint)] text-[7px]"
            >
              {Math.round(tick)}
            </text>
          </g>
        ))}
        {points.length > 1 ? (
          <>
            <polygon points={area} fill="var(--accent)" opacity={0.12} />
            <polyline
              points={line}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : null}
        {first ? (
          <text
            x={padding.left}
            y={height - 5}
            className="fill-[var(--text-faint)] text-[7px]"
          >
            {formatDay(first.date)}
          </text>
        ) : null}
        {last ? (
          <text
            x={width - padding.right}
            y={height - 5}
            textAnchor="end"
            className="fill-[var(--text-faint)] text-[7px]"
          >
            {formatDay(last.date)}
          </text>
        ) : null}
      </svg>
    </div>
  );
}

/** A round axis maximum, so ticks land on readable numbers. */
function niceCeiling(value: number): number {
  if (value <= 0) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

function formatDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return date.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
}
