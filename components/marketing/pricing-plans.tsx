"use client";

import { Check, Minus } from "lucide-react";
import Link from "next/link";
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

export function PricingPlans({ plans }: { plans: readonly MarketingPricingPlan[] }) {
  const [cadence, setCadence] = useState<Cadence>("monthly");
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
            cadence === "monthly" ? "text-white" : "text-[#7f8c9e]",
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
              : "border-[#2b3547] bg-[#151c2a]",
          )}
        >
          <span
            className={cn(
              "absolute top-1 size-5 rounded-full bg-white transition-transform",
              cadence === "yearly" ? "translate-x-8" : "translate-x-1",
            )}
            aria-hidden="true"
          />
        </button>
        <span
          className={cn(
            "text-sm font-medium transition-colors",
            cadence === "yearly" ? "text-white" : "text-[#7f8c9e]",
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

      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
                <h3 className={cn("text-lg font-semibold", tone.text)}>{plan.name}</h3>

                <p className="mt-4 flex flex-wrap items-baseline gap-1.5">
                  <span className="text-[38px] font-bold leading-none tracking-[-0.04em] text-white">
                    {formatPlanPrice(plan, cadence)}
                  </span>
                  {plan.priceNote ? (
                    <span className="text-xs text-[#7f8c9e]">
                      {plan.monthlyPriceCents === 0 ? "/ " : ""}
                      {plan.priceNote}
                    </span>
                  ) : null}
                </p>
                {cadence === "yearly" && yearlySavingPercent(plan) ? (
                  <p className="mt-1 text-[10px] font-medium text-[#34d399]">
                    billed yearly · saves {yearlySavingPercent(plan)}%
                  </p>
                ) : null}

                <p className="mt-4 text-xs leading-5 text-[#8593a5]">{plan.blurb}</p>

                <Link
                  href={plan.ctaHref}
                  className={cn(
                    "mt-5 inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold transition-opacity hover:opacity-90",
                    plan.highlighted
                      ? "bg-gradient-to-r from-[#7c5cff] to-[#4d8dff] text-white"
                      : cn("border bg-transparent", tone.border, tone.text),
                  )}
                >
                  {plan.ctaLabel}
                </Link>

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
                      <span className="text-[11px] leading-5 text-[#c1cbd8]">{feature.label}</span>
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
                <h3 className={cn("text-sm font-semibold", resolveAccent(plan.accent).text)}>
                  {plan.name}
                </h3>
                <dl className="mt-3 space-y-2">
                  {rows.map((row) => {
                    const cell = matrixCell(plan, row);
                    return (
                      <div
                        key={`${plan.slug}-${row}`}
                        className="flex items-start justify-between gap-3 border-b border-[#151c28] pb-2 last:border-b-0 last:pb-0"
                      >
                        <dt className="min-w-0 text-xs leading-5 text-[#c1cbd8]">{row}</dt>
                        <dd className="shrink-0 text-xs leading-5">
                          {cell.value ? (
                            <span className="text-[#c1cbd8]">{cell.value}</span>
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
                              <Minus className="size-4 text-[#3d4a5c]" aria-hidden="true" />
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
            className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7c5cff]"
            tabIndex={0}
            role="region"
            aria-label="Plan comparison, scrolls horizontally"
          >
            <table className="w-full min-w-[720px] border-collapse text-left">
              <caption className="sr-only">
                Feature comparison across every plan, at {cadence} billing
              </caption>
              <thead>
                <tr className="border-b border-[#1c2433]">
                  <th scope="col" className="px-5 py-4 text-sm font-semibold text-white">
                    Compare Plans
                  </th>
                  {plans.map((plan) => (
                    <th key={plan.slug} scope="col" className="px-5 py-4 text-center">
                      <span className={cn("block text-sm font-semibold", resolveAccent(plan.accent).text)}>
                        {plan.name}
                      </span>
                      {plan.highlightLabel ? (
                        <span className="mt-0.5 block text-[10px] font-normal text-[#7f8c9e]">
                          {plan.highlightLabel}
                        </span>
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row} className="border-b border-[#151c28] last:border-b-0">
                    <th scope="row" className="px-5 py-3 text-xs font-normal text-[#c1cbd8]">
                      {row}
                    </th>
                    {plans.map((plan) => {
                      const cell = matrixCell(plan, row);
                      return (
                        <td key={`${plan.slug}-${row}`} className="px-5 py-3 text-center">
                          {cell.value ? (
                            <span className="text-xs text-[#c1cbd8]">{cell.value}</span>
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
                              <Minus className="mx-auto size-4 text-[#3d4a5c]" aria-hidden="true" />
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
