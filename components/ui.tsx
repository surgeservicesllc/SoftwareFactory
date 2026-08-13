import { ArrowRight, Check, Info, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/cn";

/**
 * Shared presentation primitives.
 *
 * Everything here uses the design tokens in globals.css. Text never drops
 * below 12px, and each primitive has exactly one job so pages stay readable.
 */

/* ------------------------------------------------------------------ labels */

export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border border-line px-1.5 py-0.5 text-xs font-semibold text-faint",
        className,
      )}
    >
      Demo Data
    </span>
  );
}

export function NotConnectedBadge({ label = "Not Connected" }: { label?: string }) {
  return <StatusBadge tone="danger">{label}</StatusBadge>;
}

const statusStyles = {
  safe: "border-[var(--accent-border)] bg-[var(--accent-surface)] text-[var(--accent-text)]",
  info: "border-[var(--info-border)] bg-[var(--info-surface)] text-[var(--info)]",
  warning: "border-[var(--warning-border)] bg-[var(--warning-surface)] text-[var(--warning)]",
  danger: "border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger)]",
  neutral: "border-line-strong bg-surface-raised text-muted",
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
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
        statusStyles[tone],
      )}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------- page layout */

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="max-w-2xl">
        <h1 className="text-balance text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
          {title}
        </h1>
        <p className="mt-2 text-muted">{description}</p>
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </header>
  );
}

export function Card({
  children,
  className,
}: Readonly<{ children: React.ReactNode; className?: string }>) {
  return <section className={cn("card", className)}>{children}</section>;
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
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ notices */

const noticeStyles = {
  info: "border-line-strong bg-surface-raised text-muted",
  demo: "border-line-strong bg-surface-raised text-muted",
  warning: "border-[var(--warning-border)] bg-[var(--warning-surface)] text-[var(--warning)]",
  danger: "border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger)]",
} as const;

/**
 * One notice per page. Repeating the same disclaimer on every card trains
 * people to ignore it, which makes the product less truthful, not more.
 *
 * Nothing currently renders `DemoNotice` or `DemoBadge`: every surface reads
 * live tenant records, so there is no seeded content left to label. They stay
 * exported because AGENTS.md fixes **Demo Data** as the exact required wording,
 * and any future seeded content must reuse it rather than invent a phrasing.
 */
export function Notice({
  children,
  tone = "info",
  icon: Icon = Info,
}: {
  children: React.ReactNode;
  tone?: keyof typeof noticeStyles;
  icon?: LucideIcon;
}) {
  return (
    <div className={cn("mb-6 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm", noticeStyles[tone])}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A page whose content is entirely illustrative says so once, at the top. */
export function DemoNotice({ children }: { children: React.ReactNode }) {
  return (
    <Notice tone="demo">
      <DemoBadge className="mr-2 align-middle" />
      {children}
    </Notice>
  );
}

/* -------------------------------------------------------------- data views */

export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "neutral",
  demo = false,
  className,
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone?: "neutral" | "safe" | "warning" | "danger" | "info";
  /**
   * Opt in only for seeded values. This defaults to false so a live metric can
   * never be mislabelled as demo data by forgetting to pass it.
   */
  demo?: boolean;
  className?: string;
}) {
  const toneClass = {
    neutral: "text-muted",
    safe: "text-[var(--accent)]",
    warning: "text-[var(--warning)]",
    danger: "text-[var(--danger)]",
    info: "text-[var(--info)]",
  }[tone];

  return (
    <article className={cn("card p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium text-muted">
          <Icon className={cn("size-4 shrink-0", toneClass)} aria-hidden="true" />
          {label}
        </span>
        {demo ? <DemoBadge /> : null}
      </div>
      <p className="tabular mt-3 text-3xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-sm text-faint">{detail}</p>
    </article>
  );
}

export function EmptyState({
  title,
  description,
  actionHref,
  actionLabel,
  icon: Icon,
}: {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="grid place-items-center rounded-lg border border-dashed border-line-strong px-5 py-12 text-center">
      <div className="max-w-sm">
        {Icon ? <Icon className="mx-auto size-7 text-faint" aria-hidden="true" /> : null}
        <h3 className={cn("font-semibold text-foreground", Icon && "mt-3")}>{title}</h3>
        <p className="mt-2 text-sm text-muted">{description}</p>
        {actionHref && actionLabel ? (
          <Link href={actionHref} className="btn btn-primary mt-5">
            {actionLabel}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Full-panel state for "you cannot use this page yet, here is the one thing
 * to do next". Used by every console so blocked states look the same.
 */
export function BlockedState({
  title,
  description,
  href,
  label,
  icon: Icon,
}: {
  title: string;
  description: string;
  href?: string;
  label?: string;
  icon?: LucideIcon;
}) {
  return (
    <Card className="grid min-h-64 place-items-center p-8 text-center">
      <div className="max-w-md">
        {Icon ? <Icon className="mx-auto size-8 text-faint" aria-hidden="true" /> : null}
        <h2 className={cn("text-lg font-semibold text-foreground", Icon && "mt-4")}>{title}</h2>
        <p className="mt-2 text-muted">{description}</p>
        {href && label ? (
          <Link href={href} className="btn btn-primary mt-5">
            {label}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------- setup steps */

export type SetupStep = {
  title: string;
  description: string;
  href: string;
  action: string;
  done: boolean;
};

/**
 * The product's real path: connect GitHub, add a project, open its files.
 * Showing it as numbered steps means a new owner never has to guess.
 */
export function SetupSteps({ steps, current }: { steps: SetupStep[]; current: number }) {
  return (
    <ol className="grid gap-3 md:grid-cols-3">
      {steps.map((step, index) => {
        const isCurrent = index === current;
        return (
          <li
            key={step.title}
            className={cn(
              "flex flex-col rounded-lg border p-4",
              isCurrent ? "border-[var(--accent-border)] bg-[var(--accent-surface)]" : "border-line bg-surface",
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "tabular grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold",
                  step.done
                    ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                    : isCurrent
                      ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                      : "border border-line-strong text-faint",
                )}
                aria-hidden="true"
              >
                {step.done ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
              </span>
              <h3 className="font-semibold text-foreground">{step.title}</h3>
            </div>
            <p className="mt-2 flex-1 text-sm text-muted">{step.description}</p>
            <Link
              href={step.href}
              className={cn("mt-4 self-start", isCurrent ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm")}
            >
              {step.done ? "Review" : step.action}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
