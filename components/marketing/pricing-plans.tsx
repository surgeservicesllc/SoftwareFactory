"use client";

import { Check, Minus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { resolveAccent } from "@/components/marketing/icon";
import { SurfacePanel } from "@/components/marketing/primitives";
import { cn } from "@/lib/cn";
import {
  formatPlanPrice,
  matrixCell,
  matrixRows,
  yearlySavingPercent,
  type MarketingPricingPlan,
} from "@/lib/marketing/types";

type Cadence = "monthly" | "yearly";

/**
 * Which plans the deployment can actually charge for, per cadence — derived
 * server-side from the configured Stripe prices. A slug absent here keeps its
 * stored link (today, /sign-in): the card only becomes a checkout button when
 * a real price stands behind it.
 */
export type PurchasablePlans = Readonly<Record<string, Readonly<Record<Cadence, boolean>>>>;

export function PricingPlans({
  plans,
  purchasable = {},
}: {
  plans: readonly MarketingPricingPlan[];
  purchasable?: PurchasablePlans;
}) {
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [checkoutMessage, setCheckoutMessage] = useState("");
  const router = useRouter();

  const startCheckout = async (slug: string) => {
    setPendingSlug(slug);
    setCheckoutMessage("");
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: slug, cadence }),
      });
      if (response.status === 401) {
        // Not signed in: sign in first, then come back to buy.
        router.push(`/sign-in?returnTo=${encodeURIComponent("/pricing")}`);
        return;
      }
      const payload = (await response.json().catch(() => null)) as
        | { url?: string; error?: { message?: string } }
        | null;
      if (!response.ok || !payload?.url) {
        setCheckoutMessage(payload?.error?.message ?? "Checkout could not be started.");
        setPendingSlug(null);
        return;
      }
      window.location.assign(payload.url);
    } catch {
      setCheckoutMessage("Checkout could not be started.");
      setPendingSlug(null);
    }
  };
  const toggleId = useId();
  const rows = matrixRows(plans);

  const bestSaving = plans.reduce<number>((highest, plan) => {
    const saving = yearlySavingPercent(plan);
    return saving && saving > highest ? saving : highest;
  }, 0);

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-center gap-3">
        <span
          className={cn(
            "text-sm font-medium transition-colors",
            cadence === "monthly" ? "text-foreground" : "text-faint",
          )}
        >
          Pay Monthly
        </span>
        <button
          type="button"
          role="switch"
          id={toggleId}
          aria-checked={cadence === "yearly"}
          aria-label="Pay yearly"
          onClick={() => setCadence(cadence === "monthly" ? "yearly" : "monthly")}
          className={cn(
            "relative h-7 w-14 rounded-full border transition-colors",
            cadence === "yearly"
              ? "border-[#4d5cff] bg-gradient-to-r from-[#7c5cff] to-[#4d8dff]"
              : "border-line-strong bg-surface-raised",
          )}
        >
          <span
            className={cn(
              "absolute top-1 size-5 rounded-full bg-foreground transition-transform",
              cadence === "yearly" ? "translate-x-8" : "translate-x-1",
            )}
            aria-hidden="true"
          />
        </button>
        <span
          className={cn(
            "text-sm font-medium transition-colors",
            cadence === "yearly" ? "text-foreground" : "text-faint",
          )}
        >
          Pay Yearly
        </span>
        {bestSaving > 0 ? (
          <span className="rounded-lg bg-gradient-to-r from-[#7c5cff] to-[#4d8dff] px-3 py-1.5 text-xs font-semibold text-white">
            Save up to {bestSaving}%
          </span>
        ) : null}
      </div>

      {checkoutMessage ? (
        <p role="alert" className="text-center text-sm text-[var(--danger)]">
          {checkoutMessage}
        </p>
      ) : null}

      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => {
          const tone = resolveAccent(plan.accent);
          const cardFeatures = plan.features.filter((feature) => feature.label);

          return (
            <li key={plan.slug} className="relative">
              {plan.highlighted && plan.highlightLabel ? (
                <span className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 rounded-md bg-gradient-to-r from-[#7c5cff] to-[#4d8dff] px-3 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white">
                  {plan.highlightLabel}
                </span>
              ) : null}
              <SurfacePanel
                className={cn(
                  "flex h-full flex-col p-5 sm:p-6",
                  plan.highlighted && "border-[#4d5cff] shadow-[0_0_50px_rgba(93,92,255,0.18)]",
                )}
              >
                <h3 className="text-lg font-semibold text-[var(--site-accent-text)]">{plan.name}</h3>

                <p className="mt-4 flex flex-wrap items-baseline gap-1.5">
                  <span className="text-[38px] font-bold leading-none tracking-[-0.04em] text-foreground">
                    {formatPlanPrice(plan, cadence)}
                  </span>
                  {plan.priceNote ? (
                    <span className="text-xs text-faint">
                      {plan.monthlyPriceCents === 0 ? "/ " : ""}
                      {plan.priceNote}
                    </span>
                  ) : null}
                </p>
                {cadence === "yearly" && yearlySavingPercent(plan) ? (
                  <p className="mt-1 text-[10px] font-medium text-[var(--accent-text)]">
                    billed yearly · saves {yearlySavingPercent(plan)}%
                  </p>
                ) : null}

                <p className="mt-4 text-xs leading-5 text-muted">{plan.blurb}</p>

                {purchasable[plan.slug]?.[cadence] ? (
                  <button
                    type="button"
                    onClick={() => void startCheckout(plan.slug)}
                    disabled={pendingSlug !== null}
                    className={cn(
                      "mt-5 inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60",
                      plan.highlighted
                        ? "bg-gradient-to-r from-[#7c5cff] to-[#4d8dff] text-white"
                        : "border border-[var(--site-accent)] bg-transparent text-[var(--site-accent-text)]",
                    )}
                  >
                    {pendingSlug === plan.slug ? "Opening checkout…" : plan.ctaLabel}
                  </button>
                ) : (
                  <Link
                    href={plan.ctaHref}
                    className={cn(
                      "mt-5 inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold transition-opacity hover:opacity-90",
                      plan.highlighted
                        ? "bg-gradient-to-r from-[#7c5cff] to-[#4d8dff] text-white"
                        : "border border-[var(--site-accent)] bg-transparent text-[var(--site-accent-text)]",
                    )}
                  >
                    {plan.ctaLabel}
                  </Link>
                )}

                <ul className="mt-6 space-y-3">
                  {cardFeatures.map((feature) => (
                    <li key={feature.label} className="flex items-start gap-2.5">
                      <span
                        className={cn(
                          "mt-0.5 grid size-4 shrink-0 place-items-center rounded border",
                          tone.border,
                          tone.text,
                        )}
                      >
                        <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                      </span>
                      <span className="text-[11px] leading-5 text-muted">{feature.label}</span>
                    </li>
                  ))}
                </ul>
              </SurfacePanel>
            </li>
          );
        })}
      </ul>

      {rows.length ? (
        <>
          {/*
            One block per plan, below the width where a comparison grid stops
            being readable.

            The grid was a 720px-minimum table in a horizontal scroller, which
            is unusable on a 320px screen even when the scrolling works — and it
            did not: a table's min-width propagates into the root's scroll width
            regardless of the scroller clamping it, so the whole page scrolled
            sideways. Stacking is what the content actually wants here, and it
            carries the same rows, values and included/excluded marks, so
            nothing is hidden from a small screen.
          */}
          <div className="space-y-4 md:hidden">
            {plans.map((plan) => (
              <SurfacePanel key={plan.slug} className="p-5">
                <h3 className="text-sm font-semibold text-[var(--site-accent-text)]">
                  {plan.name}
                </h3>
                <dl className="mt-3 space-y-2">
                  {rows.map((row) => {
                    const cell = matrixCell(plan, row);
                    return (
                      <div
                        key={`${plan.slug}-${row}`}
                        className="flex items-start justify-between gap-3 border-b border-line pb-2 last:border-b-0 last:pb-0"
                      >
                        <dt className="min-w-0 text-xs leading-5 text-muted">{row}</dt>
                        <dd className="shrink-0 text-xs leading-5">
                          {cell.value ? (
                            <span className="text-muted">{cell.value}</span>
                          ) : cell.included ? (
                            <>
                              <Check
                                className={cn("size-4", resolveAccent(plan.accent).text)}
                                aria-hidden="true"
                              />
                              <span className="sr-only">Included</span>
                            </>
                          ) : (
                            <>
                              <Minus className="size-4 text-faint" aria-hidden="true" />
                              <span className="sr-only">Not included</span>
                            </>
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </SurfacePanel>
            ))}
          </div>

          <SurfacePanel className="hidden overflow-hidden md:block">
          {/* Focusable so the comparison can be scrolled without a pointer. */}
          <div
            className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            tabIndex={0}
            role="region"
            aria-label="Plan comparison, scrolls horizontally"
          >
            <table className="w-full min-w-[720px] border-collapse text-left">
              <caption className="sr-only">
                Feature comparison across every plan, at {cadence} billing
              </caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="px-5 py-4 text-sm font-semibold text-foreground">
                    Compare Plans
                  </th>
                  {plans.map((plan) => (
                    <th key={plan.slug} scope="col" className="px-5 py-4 text-center">
                      <span className="block text-sm font-semibold text-[var(--site-accent-text)]">
                        {plan.name}
                      </span>
                      {plan.highlightLabel ? (
                        <span className="mt-0.5 block text-[10px] font-normal text-faint">
                          {plan.highlightLabel}
                        </span>
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row} className="border-b border-line last:border-b-0">
                    <th scope="row" className="px-5 py-3 text-xs font-normal text-muted">
                      {row}
                    </th>
                    {plans.map((plan) => {
                      const cell = matrixCell(plan, row);
                      return (
                        <td key={`${plan.slug}-${row}`} className="px-5 py-3 text-center">
                          {cell.value ? (
                            <span className="text-xs text-muted">{cell.value}</span>
                          ) : cell.included ? (
                            <>
                              <Check
                                className={cn("mx-auto size-4", resolveAccent(plan.accent).text)}
                                aria-hidden="true"
                              />
                              <span className="sr-only">Included</span>
                            </>
                          ) : (
                            <>
                              <Minus className="mx-auto size-4 text-faint" aria-hidden="true" />
                              <span className="sr-only">Not included</span>
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </SurfacePanel>
        </>
      ) : null}
    </div>
  );
}
