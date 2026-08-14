import { createElement } from "react";

import {
  BarChart3,
  BookOpen,
  Brain,
  ClipboardList,
  Clock,
  Cloud,
  CloudUpload,
  Code2,
  Database,
  Download,
  Gem,
  Globe,
  Infinity as InfinityIcon,
  LayoutTemplate,
  Lightbulb,
  Lock,
  PlayCircle,
  Puzzle,
  Rocket,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * Content rows store an icon *slug*, not a component, so marketing copy can be
 * edited in the database without a deploy. Unknown slugs fall back to a neutral
 * mark rather than breaking the page.
 */
const ICONS: Readonly<Record<string, LucideIcon>> = {
  "bar-chart": BarChart3,
  "book-open": BookOpen,
  brain: Brain,
  clipboard: ClipboardList,
  clock: Clock,
  cloud: Cloud,
  "cloud-upload": CloudUpload,
  code: Code2,
  database: Database,
  download: Download,
  gem: Gem,
  globe: Globe,
  infinity: InfinityIcon,
  layout: LayoutTemplate,
  lightbulb: Lightbulb,
  lock: Lock,
  play: PlayCircle,
  puzzle: Puzzle,
  rocket: Rocket,
  "shield-check": ShieldCheck,
  sparkles: Sparkles,
  star: Star,
  "trending-up": TrendingUp,
  users: Users,
  zap: Zap,
};

export function resolveIcon(slug: string): LucideIcon {
  return ICONS[slug] ?? Sparkles;
}

export const ACCENTS = {
  violet: { text: "text-[#a78bfa]", border: "border-[#3b2f6b]", bg: "bg-[#171233]", glow: "#a78bfa" },
  blue: { text: "text-[#60a5fa]", border: "border-[#26406b]", bg: "bg-[#0f1c33]", glow: "#60a5fa" },
  sky: { text: "text-[#38bdf8]", border: "border-[#1e4a63]", bg: "bg-[#0b2130]", glow: "#38bdf8" },
  emerald: { text: "text-[#34d399]", border: "border-[#1d5045]", bg: "bg-[#0a2620]", glow: "#34d399" },
  fuchsia: { text: "text-[#e879f9]", border: "border-[#5a2a63]", bg: "bg-[#241030]", glow: "#e879f9" },
  amber: { text: "text-[#fbbf24]", border: "border-[#5c4318]", bg: "bg-[#2a1f09]", glow: "#fbbf24" },
} as const;

export type AccentName = keyof typeof ACCENTS;

export function resolveAccent(name: string) {
  return ACCENTS[(name as AccentName)] ?? ACCENTS.violet;
}

export function IconTile({
  icon,
  accent = "violet",
  size = "md",
  className,
}: {
  icon: string;
  accent?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const tone = resolveAccent(accent);
  const box = size === "lg" ? "size-12" : size === "sm" ? "size-8" : "size-10";
  const glyph = size === "lg" ? "size-6" : size === "sm" ? "size-4" : "size-5";

  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-xl border",
        box,
        tone.border,
        tone.bg,
        tone.text,
        className,
      )}
    >
      {createElement(resolveIcon(icon), {
        className: glyph,
        strokeWidth: 1.8,
        "aria-hidden": "true",
      })}
    </span>
  );
}
