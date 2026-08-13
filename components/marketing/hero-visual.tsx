import { BarChart3, BookOpen, Code2, PieChart, ShieldCheck, Users } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * Abstract hero artwork.
 *
 * Drawn with CSS and inline SVG rather than raster assets: nothing to license,
 * nothing to download, and it stays sharp at every breakpoint. Decorative only,
 * so the whole composition is hidden from assistive technology.
 */

function Glow({ className }: { className?: string }) {
  return <div className={cn("pointer-events-none absolute rounded-full blur-3xl", className)} aria-hidden="true" />;
}

function FloatingCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "absolute rounded-2xl border border-[#243050] bg-[#0d1424]/90 p-3 shadow-[0_18px_40px_rgba(0,0,0,0.45)] backdrop-blur",
        className,
      )}
    >
      {children}
    </div>
  );
}

function CodeLines() {
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        <span className="size-1.5 rounded-full bg-[#3d4a68]" />
        <span className="size-1.5 rounded-full bg-[#3d4a68]" />
        <span className="size-1.5 rounded-full bg-[#3d4a68]" />
      </div>
      {[70, 46, 60, 34].map((width, index) => (
        <div
          key={width}
          className="h-1.5 rounded-full bg-gradient-to-r from-[#4d8dff] to-[#7c5cff]"
          style={{ width: `${width}%`, opacity: 1 - index * 0.18 }}
        />
      ))}
    </div>
  );
}

/** The About hero: a luminous AI core with satellite surfaces around it. */
function CubeScene() {
  return (
    <>
      <Glow className="left-1/2 top-1/2 size-[420px] -translate-x-1/2 -translate-y-1/2 bg-[#4d8dff]/25" />
      <Glow className="left-1/3 top-1/3 size-56 bg-[#7c5cff]/25" />

      <FloatingCard className="left-[4%] top-[8%] w-[34%]">
        <div className="mb-2 flex items-center gap-1.5 text-[#60a5fa]">
          <Code2 className="size-3.5" />
        </div>
        <CodeLines />
      </FloatingCard>

      <FloatingCard className="right-[3%] top-[6%] w-[30%]">
        <div className="flex items-center justify-between">
          <PieChart className="size-6 text-[#a78bfa]" />
          <BarChart3 className="size-6 text-[#60a5fa]" />
        </div>
        <div className="mt-3 flex h-8 items-end gap-1">
          {[40, 70, 55, 95, 65].map((height) => (
            <span
              key={height}
              className="flex-1 rounded-sm bg-gradient-to-t from-[#4d8dff] to-[#7c5cff]"
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
      </FloatingCard>

      <FloatingCard className="bottom-[16%] left-[1%] grid size-16 place-items-center">
        <Users className="size-7 text-[#60a5fa]" />
      </FloatingCard>

      <FloatingCard className="bottom-[14%] right-[6%] grid size-16 place-items-center">
        <ShieldCheck className="size-7 text-[#a78bfa]" />
      </FloatingCard>

      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="relative grid size-40 place-items-center rounded-[28px] border border-[#3f5cff]/50 bg-gradient-to-br from-[#2b3bd6] via-[#4d5cff] to-[#7c5cff] shadow-[0_0_80px_rgba(77,141,255,0.5)]">
          <span className="text-4xl font-bold tracking-[-0.04em] text-white">AI</span>
          <div className="absolute inset-3 rounded-[20px] border border-white/15" />
        </div>
        <div
          className="mx-auto mt-3 h-3 w-52 rounded-[50%] bg-[#4d8dff]/30 blur-md"
          aria-hidden="true"
        />
      </div>
    </>
  );
}

/** The Resources hero: an open book emitting document and media tiles. */
function BookScene() {
  return (
    <>
      <Glow className="left-1/2 top-1/2 size-[380px] -translate-x-1/2 -translate-y-1/2 bg-[#7c5cff]/25" />

      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 gap-1">
        {[0, 1].map((side) => (
          <div
            key={side}
            className={cn(
              "h-40 w-32 border border-[#4b5cff]/40 bg-gradient-to-br from-[#1b2350] to-[#0f1430] p-3 shadow-[0_0_60px_rgba(124,92,255,0.35)]",
              side === 0 ? "origin-right -skew-y-6 rounded-l-xl" : "origin-left skew-y-6 rounded-r-xl",
            )}
          >
            <div className="space-y-2">
              {[80, 65, 74, 52, 68].map((width, index) => (
                <div
                  key={`${side}-${width}-${index}`}
                  className="h-1.5 rounded-full bg-gradient-to-r from-[#7c5cff] to-[#4d8dff]"
                  style={{ width: `${width}%`, opacity: 0.85 - index * 0.1 }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <FloatingCard className="left-[6%] top-[16%] grid size-14 place-items-center">
        <BookOpen className="size-6 text-[#a78bfa]" />
      </FloatingCard>
      <FloatingCard className="bottom-[26%] left-[2%] grid size-14 place-items-center">
        <BarChart3 className="size-6 text-[#60a5fa]" />
      </FloatingCard>
      <FloatingCard className="bottom-[14%] left-[22%] grid size-14 place-items-center">
        <Code2 className="size-6 text-[#38bdf8]" />
      </FloatingCard>
    </>
  );
}

/** The Platform hero: a stacked capability tower. */
function StackScene({ layers }: { layers: readonly string[] }) {
  return (
    <>
      <Glow className="left-1/2 top-1/2 size-[380px] -translate-x-1/2 -translate-y-1/2 bg-[#4d8dff]/22" />
      <div className="absolute left-1/2 top-1/2 w-[72%] -translate-x-1/2 -translate-y-1/2 space-y-2">
        {layers.map((layer, index) => (
          <div
            key={layer}
            className="flex items-center gap-3 rounded-xl border border-[#3a4a8a]/60 bg-gradient-to-r from-[#182046] to-[#101736] px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
            style={{
              marginLeft: `${Math.abs(index - 2) * 5}%`,
              marginRight: `${Math.abs(index - 2) * 5}%`,
            }}
          >
            <span className="size-2 rounded-full bg-gradient-to-r from-[#7c5cff] to-[#4d8dff]" />
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c3cdf5]">
              {layer}
            </span>
          </div>
        ))}
        <div className="mx-auto mt-4 h-4 w-3/4 rounded-[50%] bg-[#4d8dff]/25 blur-md" />
      </div>
    </>
  );
}

export function HeroVisual({
  variant,
  className,
}: {
  variant: "cube" | "book" | "stack";
  className?: string;
}) {
  return (
    <div
      className={cn("relative h-[320px] w-full overflow-hidden sm:h-[400px] lg:h-[440px]", className)}
      aria-hidden="true"
    >
      {variant === "cube" ? <CubeScene /> : null}
      {variant === "book" ? <BookScene /> : null}
      {variant === "stack" ? (
        <StackScene layers={["AI Agents", "Automation", "Data & Context", "Security", "Infrastructure"]} />
      ) : null}
    </div>
  );
}
