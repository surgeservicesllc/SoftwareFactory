import { CalendarDays, CheckCircle2, Quote, User } from "lucide-react";
import type { Metadata } from "next";

import { IconTile, resolveIcon } from "@/components/marketing/icon";
import { PricingPlans } from "@/components/marketing/pricing-plans";
import {
  ContentSourceNotice,
  GradientText,
  MarketingSection,
  SecondaryCta,
  SurfacePanel,
} from "@/components/marketing/primitives";
import { getMarketingContent, getMarketingMetadata } from "@/lib/marketing/queries";
import { featuresInGroup } from "@/lib/marketing/types";

export async function generateMetadata(): Promise<Metadata> {
  return getMarketingMetadata("pricing");
}

export default async function PricingPage() {
  const content = await getMarketingContent("pricing");
  const pillars = featuresInGroup(content.features, "pillar");
  const security = featuresInGroup(content.features, "security");
  const testimonial = content.testimonials[0];
  const page = content.page;

  return (
    <>
      <MarketingSection className="pt-10 sm:pt-14">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-start">
          <div>
            <h1 className="text-balance text-[36px] font-bold leading-[1.08] tracking-[-0.04em] text-white sm:text-[46px]">
              {page?.headline}{" "}
              {page?.headlineAccent ? <GradientText>{page.headlineAccent}</GradientText> : null}
            </h1>
            {page?.subheadline ? (
              <p className="mt-5 max-w-xl text-[15px] leading-7 text-[#8593a5]">{page.subheadline}</p>
            ) : null}
            <ul className="mt-6 flex flex-wrap gap-6">
              {["No setup fees", "Cancel anytime"].map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm text-[#c1cbd8]">
                  <CheckCircle2 className="size-4 text-[#a78bfa]" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {pillars.length ? (
            <SurfacePanel className="p-5 sm:p-6">
              <h2 className="text-sm font-semibold text-white">Everything you need to build</h2>
              <ul className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
                {pillars.map((pillar) => (
                  <li key={pillar.title} className="text-center">
                    <IconTile
                      icon={pillar.icon}
                      accent={pillar.accent}
                      size="lg"
                      className="mx-auto"
                    />
                    <h3 className="mt-3 text-xs font-semibold text-white">{pillar.title}</h3>
                    <p className="mt-1 text-xs leading-4 text-balance break-words text-[#7f8c9e]">{pillar.body}</p>
                  </li>
                ))}
              </ul>
            </SurfacePanel>
          ) : null}
        </div>
      </MarketingSection>

      <MarketingSection className="mt-6">
        <ContentSourceNotice source={content.source} />
      </MarketingSection>

      <MarketingSection className="mt-10">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
          <PricingPlans plans={content.plans} />

          <aside className="space-y-4">
            {security.length ? (
              <SurfacePanel className="p-5">
                <h2 className="text-sm font-semibold text-white">Enterprise-Grade Security</h2>
                <ul className="mt-5 space-y-3.5">
                  {security.map((item) => {
                    const Icon = resolveIcon(item.icon);
                    return (
                      <li key={item.title} className="flex items-start gap-2.5">
                        <Icon className="mt-0.5 size-4 shrink-0 text-[#34d399]" aria-hidden="true" />
                        <span className="text-sm leading-5 text-[#c1cbd8]">{item.title}</span>
                      </li>
                    );
                  })}
                </ul>
              </SurfacePanel>
            ) : null}

            {testimonial ? (
              <SurfacePanel className="p-5">
                <Quote className="size-6 text-[#3d4a5c]" aria-hidden="true" />
                <blockquote className="mt-3 text-[13px] leading-6 text-[#c8d2df]">
                  {testimonial.quote}
                </blockquote>
                <figcaption className="mt-4 flex items-center gap-3">
                  <span
                    className="grid size-9 shrink-0 place-items-center rounded-full border border-[#25303f] bg-[#111826] text-[#5d6b7f]"
                    aria-hidden="true"
                  >
                    <User className="size-4" />
                  </span>
                  <span>
                    <span className="block text-xs font-semibold text-white">
                      {testimonial.authorName}
                    </span>
                    <span className="block text-xs text-[#7f8c9e]">{testimonial.authorTitle}</span>
                  </span>
                </figcaption>
              </SurfacePanel>
            ) : null}

            <SurfacePanel className="p-5">
              <h2 className="text-sm font-semibold text-white">Need a custom solution?</h2>
              <p className="mt-2 text-sm leading-5 text-[#8593a5]">
                Let&apos;s build a plan that&apos;s tailored to your team&apos;s unique needs.
              </p>
              <SecondaryCta href="/about" className="mt-4 w-full border-[#3b2f6b] text-[#c4b5fd]">
                Contact Sales
              </SecondaryCta>
              <p className="mt-4 flex items-center gap-2 text-sm text-[#8593a5]">
                <CalendarDays className="size-4 text-[#60a5fa]" aria-hidden="true" />
                Schedule a Call
              </p>
            </SurfacePanel>
          </aside>
        </div>
      </MarketingSection>

      <MarketingSection className="mt-10">
        <div className="flex items-center gap-3 rounded-xl border border-[#1c2433] bg-[#0b0f18] px-4 py-3 text-sm leading-5 text-[#7f8c9e]">
          <CheckCircle2 className="size-4 shrink-0 text-[#4d8dff]" aria-hidden="true" />
          Plan prices are configuration in the marketing content schema. No billing provider is
          connected, so nothing on this page charges a card.
        </div>
      </MarketingSection>
    </>
  );
}
