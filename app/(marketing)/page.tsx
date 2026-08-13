import { ArrowRight, Quote, User } from "lucide-react";
import type { Metadata } from "next";

import { HeroVisual } from "@/components/marketing/hero-visual";
import { IconTile } from "@/components/marketing/icon";
import {
  ContentSourceNotice,
  CtaBand,
  Eyebrow,
  GradientText,
  MarketingSection,
  PrimaryCta,
  SecondaryCta,
  SectionHeading,
  StatRow,
  SurfacePanel,
} from "@/components/marketing/primitives";
import { getMarketingContent, getMarketingMetadata } from "@/lib/marketing/queries";
import { featuresInGroup, formatPlanPrice } from "@/lib/marketing/types";

export async function generateMetadata(): Promise<Metadata> {
  return getMarketingMetadata("home");
}

export default async function HomePage() {
  const [content, platform] = await Promise.all([
    getMarketingContent("home"),
    getMarketingContent("platform"),
  ]);

  const lifecycle = featuresInGroup(platform.features, "lifecycle");
  const foundation = featuresInGroup(platform.features, "foundation").slice(0, 3);
  const testimonial = content.testimonials[0];
  const page = content.page;

  return (
    <>
      <MarketingSection className="pt-10 sm:pt-16">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            {page?.eyebrow ? <Eyebrow>{page.eyebrow}</Eyebrow> : null}
            <h1 className="mt-5 text-balance text-[40px] font-bold leading-[1.04] tracking-[-0.045em] text-white sm:text-[58px]">
              {page?.headline}{" "}
              {page?.headlineAccent ? <GradientText>{page.headlineAccent}</GradientText> : null}
            </h1>
            {page?.subheadline ? (
              <p className="mt-6 max-w-xl text-[15px] leading-7 text-[#8593a5]">{page.subheadline}</p>
            ) : null}
            <div className="mt-8 flex flex-wrap gap-3">
              <PrimaryCta href="/sign-in">
                Get Started Free
                <ArrowRight className="size-4" aria-hidden="true" />
              </PrimaryCta>
              <SecondaryCta href="/platform">Tour the platform</SecondaryCta>
            </div>
            <div className="mt-10">
              <StatRow stats={content.stats} />
            </div>
          </div>
          <HeroVisual variant="cube" />
        </div>
      </MarketingSection>

      <MarketingSection className="mt-6">
        <ContentSourceNotice source={content.source} />
      </MarketingSection>

      <MarketingSection className="mt-14">
        <SectionHeading
          title="One platform, the whole lifecycle"
          description="Plan, build, test, deploy, operate and scale — each stage with its own agents, checks and evidence."
          action={
            <a
              href="/platform"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#a78bfa] hover:text-[#c4b5fd]"
            >
              Explore the platform
              <ArrowRight className="size-4" aria-hidden="true" />
            </a>
          }
        />
        <ul className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          {lifecycle.map((stage) => (
            <li key={stage.title}>
              <SurfacePanel className="h-full p-4 transition-colors hover:border-[#33405a]">
                <IconTile icon={stage.icon} accent={stage.accent} />
                <h3 className="mt-4 font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-white">
                  {stage.title}
                </h3>
                <p className="mt-2 text-[11px] leading-5 text-[#7f8c9e]">{stage.body}</p>
              </SurfacePanel>
            </li>
          ))}
        </ul>
      </MarketingSection>

      <MarketingSection className="mt-14">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <SurfacePanel className="p-6 sm:p-8">
            <h2 className="text-[22px] font-semibold tracking-[-0.03em] text-white">
              Built on a foundation you do not have to assemble
            </h2>
            <ul className="mt-6 grid gap-6 sm:grid-cols-3">
              {foundation.map((item) => (
                <li key={item.title}>
                  <IconTile icon={item.icon} accent={item.accent} />
                  <h3 className="mt-3 text-[13px] font-semibold text-white">{item.title}</h3>
                  <p className="mt-2 text-[11px] leading-5 text-[#7f8c9e]">{item.body}</p>
                </li>
              ))}
            </ul>
          </SurfacePanel>

          {testimonial ? (
            <SurfacePanel className="flex flex-col justify-between p-6">
              <div>
                <Quote className="size-7 text-[#3d4a5c]" aria-hidden="true" />
                <blockquote className="mt-4 text-sm leading-7 text-[#c8d2df]">
                  {testimonial.quote}
                </blockquote>
              </div>
              <figcaption className="mt-6 flex items-center gap-3">
                <span
                  className="grid size-10 shrink-0 place-items-center rounded-full border border-[#25303f] bg-[#111826] text-[#5d6b7f]"
                  aria-hidden="true"
                >
                  <User className="size-4" />
                </span>
                <span>
                  <span className="block text-xs font-semibold text-white">
                    {testimonial.authorName}
                  </span>
                  <span className="block text-[10px] text-[#7f8c9e]">{testimonial.authorTitle}</span>
                </span>
              </figcaption>
            </SurfacePanel>
          ) : null}
        </div>
      </MarketingSection>

      {content.plans.length ? (
        <MarketingSection className="mt-14">
          <SectionHeading
            title="Pricing that starts at zero"
            description="Start free, upgrade when the team grows. No setup fees, cancel anytime."
            action={
              <a
                href="/pricing"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#a78bfa] hover:text-[#c4b5fd]"
              >
                See full pricing
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
            }
          />
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {content.plans.map((plan) => (
              <li key={plan.slug}>
                <SurfacePanel className="h-full p-5">
                  <h3 className="text-sm font-semibold text-white">{plan.name}</h3>
                  <p className="mt-3 text-[28px] font-bold leading-none tracking-[-0.04em] text-white">
                    {formatPlanPrice(plan, "monthly")}
                  </p>
                  {plan.priceNote ? (
                    <p className="mt-1.5 text-[10px] text-[#7f8c9e]">{plan.priceNote}</p>
                  ) : null}
                  <p className="mt-4 text-[11px] leading-5 text-[#8593a5]">{plan.blurb}</p>
                </SurfacePanel>
              </li>
            ))}
          </ul>
        </MarketingSection>
      ) : null}

      {content.logos.length ? (
        <MarketingSection className="mt-12">
          <SurfacePanel className="flex flex-col items-center gap-6 px-6 py-6 lg:flex-row lg:gap-10">
            <p className="shrink-0 text-sm font-medium text-[#c8d2df]">
              Trusted by innovative teams worldwide
            </p>
            <ul className="flex flex-1 flex-wrap items-center justify-center gap-x-10 gap-y-4 lg:justify-between">
              {content.logos.map((logo) => (
                <li key={logo.name} className="text-[17px] font-semibold text-[#8b97a8]">
                  {logo.wordmark}
                </li>
              ))}
            </ul>
          </SurfacePanel>
        </MarketingSection>
      ) : null}

      <MarketingSection className="mt-12">
        <CtaBand
          title="Start building with AI at the core."
          description="Create a workspace in minutes. Bring your own bots, assign them roles, and keep every action auditable."
          primaryHref="/sign-in"
          primaryLabel="Get Started Free"
          secondaryHref="/solutions"
          secondaryLabel="See it in operation"
        />
      </MarketingSection>
    </>
  );
}
