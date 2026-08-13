import { ArrowRight, Info } from "lucide-react";
import Link from "next/link";

import { IconTile } from "@/components/marketing/icon";
import { cn } from "@/lib/cn";
import type { MarketingSource, MarketingStat } from "@/lib/marketing/types";

/** Violet→blue gradient used for headline spans and primary calls to action. */
export function GradientText({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "bg-gradient-to-r from-[#7c5cff] via-[#6d8bff] to-[#4d8dff] bg-clip-text text-transparent",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[#2b2350] bg-[#140f2b] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#b9a6ff]">
      <span className="size-1.5 rounded-full bg-[#a78bfa]" aria-hidden="true" />
      {children}
    </span>
  );
}

export function MarketingSection({
  children,
  className,
  ...rest
}: React.ComponentPropsWithoutRef<"section">) {
  return (
    <section className={cn("mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8", className)} {...rest}>
      {children}
    </section>
  );
}

export function SurfacePanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-[#1c2433] bg-[#0c111a] shadow-[0_24px_60px_rgba(0,0,0,0.28)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  align = "left",
  action,
}: {
  title: React.ReactNode;
  description?: string;
  align?: "left" | "center";
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        align === "center" ? "items-center text-center" : "sm:flex-row sm:items-end sm:justify-between",
      )}
    >
      <div className={cn(align === "center" && "max-w-2xl")}>
        <h2 className="text-balance text-[22px] font-semibold tracking-[-0.03em] text-white sm:text-[28px]">
          {title}
        </h2>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#8593a5]">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function PrimaryCta({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#7c5cff] to-[#4d8dff] px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function SecondaryCta({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#2b3547] bg-[#0f1520] px-5 text-sm font-semibold text-[#c8d2df] transition-colors hover:border-[#44536a] hover:text-white",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function StatRow({ stats }: { stats: readonly MarketingStat[] }) {
  if (!stats.length) return null;

  return (
    <dl className="flex flex-wrap items-start gap-x-10 gap-y-6">
      {stats.map((stat, index) => (
        <div
          key={stat.label}
          className={cn(
            "flex min-w-[132px] flex-col-reverse",
            index > 0 && "border-l border-[#1e2634] pl-10",
          )}
        >
          <dt className="mt-2 pl-1 text-xs text-[#7f8c9e]">{stat.label}</dt>
          <dd className="flex items-center gap-2 text-[26px] font-semibold leading-none tracking-[-0.03em] text-white">
            <IconTile
              icon={stat.icon}
              accent="violet"
              size="sm"
              className="border-transparent bg-transparent"
            />
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function CtaBand({
  title,
  description,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
}: {
  title: string;
  description: string;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return (
    <SurfacePanel className="relative overflow-hidden p-6 sm:p-8">
      <div
        className="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full bg-[#7c5cff]/20 blur-3xl"
        aria-hidden="true"
      />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-2xl">
          <h2 className="text-balance text-xl font-semibold tracking-[-0.03em] text-white sm:text-[24px]">
            {title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#8593a5]">{description}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {secondaryHref && secondaryLabel ? (
            <SecondaryCta href={secondaryHref}>{secondaryLabel}</SecondaryCta>
          ) : null}
          <PrimaryCta href={primaryHref}>
            {primaryLabel}
            <ArrowRight className="size-4" aria-hidden="true" />
          </PrimaryCta>
        </div>
      </div>
    </SurfacePanel>
  );
}

/**
 * Truthful provenance for page content.
 *
 * Marketing copy served from the seeded fallback is labelled **Demo Data**;
 * copy read from Supabase renders nothing. Never remove this without also
 * removing the fallback.
 */
export function ContentSourceNotice({ source }: { source: MarketingSource }) {
  if (source === "supabase") return null;

  return (
    <div className="flex items-start gap-3 rounded-xl border border-[#34414f] bg-[#111822] px-4 py-3 text-xs leading-5 text-[#8e9bab]">
      <Info className="mt-0.5 size-4 shrink-0 text-[#ffbe55]" aria-hidden="true" />
      <p>
        <span className="mr-2 inline-flex items-center rounded border border-[#324050] bg-[#141b25] px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.13em] text-[#8290a1]">
          Demo data
        </span>
        This page is rendering seeded content. Connect Supabase and apply the marketing content
        migration to serve it from the database.
      </p>
    </div>
  );
}
