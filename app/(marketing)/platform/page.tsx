import { ArrowRight, Sparkles } from "lucide-react";
import type { Metadata } from "next";

import { HeroVisual } from "@/components/marketing/hero-visual";
import { IconTile, resolveAccent } from "@/components/marketing/icon";
import {
  ContentSourceNotice,
  CtaBand,
  Eyebrow,
  GradientText,
  MarketingSection,
  SurfacePanel,
} from "@/components/marketing/primitives";
import { getMarketingContent, getMarketingMetadata } from "@/lib/marketing/queries";
import { featuresInGroup } from "@/lib/marketing/types";

export async function generateMetadata(): Promise<Metadata> {
  return getMarketingMetadata("platform");
}

export default async function PlatformPage() {
  const content = await getMarketingContent("platform");
  const lifecycle = featuresInGroup(content.features, "lifecycle");
  const foundation = featuresInGroup(content.features, "foundation");
  const page = content.page;

  const sideStages = lifecycle.slice(0, 3);
  const trailingStages = lifecycle.slice(4);

  return (
    <>
      <MarketingSection className="pt-10 sm:pt-14">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div>
            {page?.eyebrow ? <Eyebrow>{page.eyebrow}</Eyebrow> : null}
            <h1 className="mt-5 text-balance text-[38px] font-bold leading-[1.06] tracking-[-0.04em] text-white sm:text-[52px]">
              {page?.headline}{" "}
              {page?.headlineAccent ? <GradientText>{page.headlineAccent}</GradientText> : null}
            </h1>
            {page?.subheadline ? (
              <p className="mt-6 max-w-xl text-[15px] leading-7 text-[#8593a5]">{page.subheadline}</p>
            ) : null}
          </div>

          <div className="relative">
            <HeroVisual variant="stack" />
            <ul className="pointer-events-none absolute inset-y-0 left-0 hidden w-[30%] flex-col justify-center gap-3 xl:flex">
              {sideStages.map((stage) => (
                <li
                  key={stage.title}
                  className="rounded-xl border border-[#1f2941] bg-[#0c1220]/90 p-3 backdrop-blur"
                >
                  <div className="flex items-center gap-2">
                    <IconTile icon={stage.icon} accent={stage.accent} size="sm" />
                    <p className="text-xs font-semibold text-white">{stage.title}</p>
                  </div>
                  <p className="mt-1.5 text-xs leading-4 text-[#7f8c9e]">{stage.body}</p>
                </li>
              ))}
            </ul>
            <ul className="pointer-events-none absolute inset-y-0 right-0 hidden w-[28%] flex-col justify-center gap-3 xl:flex">
              {trailingStages.map((stage) => (
                <li
                  key={stage.title}
                  className="rounded-xl border border-[#1f2941] bg-[#0c1220]/90 p-3 backdrop-blur"
                >
                  <div className="flex items-center gap-2">
                    <IconTile icon={stage.icon} accent={stage.accent} size="sm" />
                    <p className="text-xs font-semibold text-white">{stage.title}</p>
                  </div>
                  <p className="mt-1.5 text-xs leading-4 text-[#7f8c9e]">{stage.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </MarketingSection>

      <MarketingSection className="mt-6">
        <ContentSourceNotice source={content.source} />
      </MarketingSection>

      <MarketingSection className="mt-12">
        <SurfacePanel className="p-6 sm:p-8">
          <h2 className="text-center text-[22px] font-semibold tracking-[-0.03em] text-white sm:text-[26px]">
            The AI Software Factory Platform
          </h2>
          <ol className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            {lifecycle.map((stage, index) => (
              <li key={stage.title} className="relative">
                <div className="h-full rounded-2xl border border-[#1e2839] bg-[#0a0f1a] p-4">
                  <IconTile icon={stage.icon} accent={stage.accent} />
                  <h3 className="mt-4 font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-white">
                    {stage.title}
                  </h3>
                  <p className="mt-2 text-sm leading-5 text-[#7f8c9e]">{stage.body}</p>
                </div>
                {index < lifecycle.length - 1 ? (
                  <span
                    className="absolute -right-3 top-1/2 hidden -translate-y-1/2 text-[#33405a] 2xl:block"
                    aria-hidden="true"
                  >
                    <ArrowRight className="size-4" />
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </SurfacePanel>
      </MarketingSection>

      <MarketingSection className="mt-12">
        <h2 className="text-center text-[22px] font-semibold tracking-[-0.03em] text-white sm:text-[26px]">
          Built on a Secure, Scalable Foundation
        </h2>
        <SurfacePanel className="mt-6 p-6 sm:p-8">
          <ul className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            {foundation.map((item) => (
              <li key={item.title}>
                <span className={resolveAccent(item.accent).text}>
                  <IconTile
                    icon={item.icon}
                    accent={item.accent}
                    className="border-transparent bg-transparent"
                  />
                </span>
                <h3 className="mt-3 text-[13px] font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm leading-5 text-[#7f8c9e]">{item.body}</p>
              </li>
            ))}
          </ul>
        </SurfacePanel>
      </MarketingSection>

      <MarketingSection className="mt-12">
        <SurfacePanel className="relative overflow-hidden p-6 sm:p-8">
          <div
            className="pointer-events-none absolute -left-20 -top-24 size-64 rounded-full bg-[#7c5cff]/20 blur-3xl"
            aria-hidden="true"
          />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <Sparkles className="mt-1 size-7 shrink-0 text-[#a78bfa]" aria-hidden="true" />
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.03em] text-white">
                  Everything you need. All in one place.
                </h2>
                <p className="mt-1.5 text-sm text-[#8593a5]">
                  From idea to impact, the AI Software Factory Platform has you covered.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <a
                href="/features"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#2b3547] bg-[#0f1520] px-5 text-sm font-semibold text-[#c8d2df] transition-colors hover:border-[#44536a] hover:text-white"
              >
                Explore Features
              </a>
              <a
                href="/auth/sign-up"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#7c5cff] to-[#4d8dff] px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              >
                Get Started for Free
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
            </div>
          </div>
        </SurfacePanel>
      </MarketingSection>

      <MarketingSection className="mt-10">
        <CtaBand
          title="Want to see the controls behind it?"
          description="The Solutions view shows the real operating state: connected projects, delivery controls and safety posture."
          primaryHref="/solutions"
          primaryLabel="Open Solutions"
          secondaryHref="/pricing"
          secondaryLabel="See pricing"
        />
      </MarketingSection>
    </>
  );
}
