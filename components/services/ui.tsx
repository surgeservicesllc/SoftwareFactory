import { cn } from "@/lib/cn";

/**
 * The Services CRM's own visual vocabulary: lifecycle and stage colours,
 * account avatars, money. One definition each, so a "customer" is the same
 * green on the overview, the table, the board and the 360° page. These
 * render inside `.services-theme`; the scoped CSS translates these lifecycle
 * tones for the default dark palette and preserves their light equivalents.
 */

export function dollars(cents: number | null): string {
  if (cents === null) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

const STATUS_TONES: Record<string, string> = {
  lead: "border-amber-200 bg-amber-50 text-amber-800",
  prospect: "border-sky-200 bg-sky-50 text-sky-800",
  customer: "border-emerald-200 bg-emerald-50 text-emerald-800",
  inactive: "border-slate-200 bg-slate-50 text-slate-500",
};

export function AccountStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize",
        STATUS_TONES[status] ?? STATUS_TONES.inactive,
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {status}
    </span>
  );
}

/** Stage colour families: badge on the themed surface and the board header bar. */
export const STAGE_TONES: Record<string, { badge: string; bar: string }> = {
  new: { badge: "border-slate-200 bg-slate-50 text-slate-600", bar: "bg-slate-400" },
  contacted: { badge: "border-sky-200 bg-sky-50 text-sky-700", bar: "bg-sky-500" },
  inspection: { badge: "border-amber-200 bg-amber-50 text-amber-700", bar: "bg-amber-500" },
  proposal: { badge: "border-violet-200 bg-violet-50 text-violet-700", bar: "bg-violet-500" },
  negotiation: { badge: "border-orange-200 bg-orange-50 text-orange-700", bar: "bg-orange-500" },
  won: { badge: "border-emerald-200 bg-emerald-50 text-emerald-700", bar: "bg-emerald-500" },
  lost: { badge: "border-rose-200 bg-rose-50 text-rose-700", bar: "bg-rose-400" },
};

export function StageBadge({ stage, className }: { stage: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize",
        (STAGE_TONES[stage] ?? STAGE_TONES.new).badge,
        className,
      )}
    >
      {stage}
    </span>
  );
}

const AVATAR_TONES = [
  "bg-emerald-600",
  "bg-teal-600",
  "bg-sky-600",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-amber-600",
  "bg-cyan-600",
];

function initialsOf(name: string): string {
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return "•";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function toneOf(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

export function AccountAvatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    sm: "size-7 text-[11px]",
    md: "size-9 text-xs",
    lg: "size-14 text-lg",
  } as const;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-lg font-semibold text-white",
        sizes[size],
        toneOf(name),
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
