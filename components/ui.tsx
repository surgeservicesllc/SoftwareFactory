import {
  AlertTriangle,
  ArrowUpRight,
  DatabaseZap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/cn";

export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border border-[#324050] bg-[#141b25] px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.13em] text-[#8290a1]",
        className,
      )}
    >
      Demo data
    </span>
  );
}

export function NotConnectedBadge({ label = "Not Connected" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#3a3033] bg-[#25191c] px-2 py-1 text-[10px] font-semibold text-[#e7969d]">
      <span className="size-1.5 rounded-full bg-[#ff6b72]" aria-hidden="true" />
      {label}
    </span>
  );
}

const statusStyles = {
  safe: "border-[#31421d] bg-[#17210e] text-[#c6f135]",
  info: "border-[#233f4a] bg-[#10232b] text-[#60d8ff]",
  warning: "border-[#4b3c23] bg-[#2c2112] text-[#ffbe55]",
  danger: "border-[#4a292e] bg-[#2b171b] text-[#ff7d84]",
  neutral: "border-[#303a47] bg-[#171d26] text-[#9aa7b7]",
} as const;

export function StatusBadge({
  children,
  tone = "neutral",
  dot = true,
}: {
  children: React.ReactNode;
  tone?: keyof typeof statusStyles;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold",
        statusStyles[tone],
      )}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current opacity-90" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 border-b border-[#1b2430] pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        <p className="eyebrow mb-2">{eyebrow}</p>
        <h1 className="text-balance text-2xl font-semibold tracking-[-0.04em] text-white sm:text-[30px]">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7f8b9a]">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function Panel({
  children,
  className,
}: Readonly<{ children: React.ReactNode; className?: string }>) {
  return <section className={cn("panel rounded-xl", className)}>{children}</section>;
}

export function SectionTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-[#eef2f5]">{title}</h2>
        {description ? <p className="mt-1 text-xs leading-5 text-[#6f7c8c]">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "neutral",
  demo = true,
  className,
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone?: "neutral" | "safe" | "warning" | "danger" | "info";
  demo?: boolean;
  className?: string;
}) {
  const toneClass = {
    neutral: "text-[#9aa7b7] bg-[#19212c] border-[#283342]",
    safe: "text-[#c6f135] bg-[#17210e] border-[#2d3e1b]",
    warning: "text-[#ffbe55] bg-[#2a2113] border-[#463821]",
    danger: "text-[#ff7d84] bg-[#29181d] border-[#43272c]",
    info: "text-[#60d8ff] bg-[#10232b] border-[#213d48]",
  }[tone];

  return (
    <article className={cn("panel group relative min-h-[148px] overflow-hidden rounded-xl p-4 transition-colors hover:border-[#303c4c]", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className={cn("grid size-8 place-items-center rounded-lg border", toneClass)}>
          <Icon className="size-4" strokeWidth={1.8} aria-hidden="true" />
        </div>
        {demo ? <DemoBadge /> : null}
      </div>
      <div className="mt-5">
        <p className="data-value text-[26px] font-semibold leading-none text-[#f6f8fa]">{value}</p>
        <p className="mt-2 text-xs font-medium text-[#aab4c0]">{label}</p>
        <p className="mt-1 text-[10px] leading-4 text-[#5e6a79]">{detail}</p>
      </div>
    </article>
  );
}

export function EmptyState({
  title,
  description,
  actionHref,
  actionLabel,
}: {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="grid min-h-52 place-items-center rounded-xl border border-dashed border-[#2a3544] bg-[#0b1017] px-5 py-10 text-center">
      <div className="max-w-sm">
        <div className="mx-auto grid size-10 place-items-center rounded-lg border border-[#2b3746] bg-[#151c27] text-[#7e8b9b]">
          <DatabaseZap className="size-[18px]" aria-hidden="true" />
        </div>
        <h3 className="mt-4 text-sm font-semibold text-[#e7ebef]">{title}</h3>
        <p className="mt-2 text-xs leading-5 text-[#6f7c8c]">{description}</p>
        {actionHref && actionLabel ? (
          <Link
            href={actionHref}
            className="mt-4 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#34411c] bg-[#c6f135]/[0.07] px-3 text-xs font-semibold text-[#dffb7b]"
          >
            {actionLabel}
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function DemoNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#34414f] bg-[#111822] px-4 py-3 text-xs leading-5 text-[#8e9bab]">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#ffbe55]" aria-hidden="true" />
      <div>
        <DemoBadge className="mr-2 align-middle" />
        {children}
      </div>
    </div>
  );
}
