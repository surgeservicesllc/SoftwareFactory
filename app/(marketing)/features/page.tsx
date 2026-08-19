import { ArrowRight, Check } from "lucide-react";
import type { Metadata } from "next";

import { IconTile, resolveAccent } from "@/components/marketing/icon";
import {
  ContentSourceNotice,
  CtaBand,
  Eyebrow,
  GradientText,
  MarketingSection,
  SectionHeading,
  SurfacePanel,
} from "@/components/marketing/primitives";
import { getMarketingContent, getMarketingMetadata } from "@/lib/marketing/queries";
import { featuresInGroup } from "@/lib/marketing/types";

export async function generateMetadata(): Promise<Metadata> {
  return getMarketingMetadata("features");
}

export default async function FeaturesPage() {
  const [content, platform] = await Promise.all([
    getMarketingContent("features"),
    getMarketingContent("platform"),
  ]);

  const pillars = featuresInGroup(content.features, "pillar");
  const lifecycle = featuresInGroup(platform.features, "lifecycle");
  const foundation = featuresInGroup(platform.features, "foundation");
  const page = content.page;

  return (
    <>
      <MarketingSection className="pt-10 sm:pt-14">
        <div className="max-w-3xl">
          {page?.eyebrow ? <Eyebrow>{page.eyebrow}</Eyebrow> : null}
          <h1 className="mt-5 text-balance text-[38px] font-bold leading-[1.06] tracking-[-0.04em] text-white sm:text-[52px]">
            {page?.headline}{" "}
            {page?.headlineAccent ? <GradientText>{page.headlineAccent}</GradientText> : null}
          </h1>
          {page?.subheadline ? (
            <p className="mt-6 text-[15px] leading-7 text-[#8593a5]">{page.subheadline}</p>
          ) : null}
        </div>
      </MarketingSection>

      <MarketingSection className="mt-6">
        <ContentSourceNotice source={content.source} />
      </MarketingSection>

      <MarketingSection className="mt-10">
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {pillars.map((pillar) => (
            <li key={pillar.title}>
              <SurfacePanel className="h-full p-5 transition-colors hover:border-[#33405a]">
                <IconTile icon={pillar.icon} accent={pillar.accent} size="lg" />
                <h2 className="mt-4 text-base font-semibold text-white">{pillar.title}</h2>
                <p className="mt-2 text-xs leading-6 text-[#8593a5]">{pillar.body}</p>
              </SurfacePanel>
            </li>
          ))}
        </ul>
      </MarketingSection>

      <MarketingSection className="mt-14">
        <SectionHeading
          title="Capabilities across the whole lifecycle"
          description="Each stage brings its own agents, checks and evidence. Nothing advances without a record of what happened."
        />
        <ul className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {lifecycle.map((stage, index) => (
            <li key={stage.title}>
              <SurfacePanel className="flex h-full gap-4 p-5">
                <div className="flex flex-col items-center gap-2">
                  <IconTile icon={stage.icon} accent={stage.accent} size="lg" />
                  <span className="font-mono text-xs text-[#7f8c9e]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-white">{stage.title}</h3>
                  <p className="mt-2 text-xs leading-6 text-[#8593a5]">{stage.body}</p>
                  <p className={`mt-3 text-sm font-medium ${resolveAccent(stage.accent).text}`}>
                    Included in every plan
                  </p>
                </div>
              </SurfacePanel>
            </li>
          ))}
        </ul>
      </MarketingSection>

      <MarketingSection className="mt-14">
        <SectionHeading
          title="The foundation underneath"
          description="Security, data, integrations and scale are platform properties, not add-ons you assemble later."
        />
        <SurfacePanel className="mt-6 p-6 sm:p-8">
          <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {foundation.map((item) => (
              <li key={item.title} className="flex gap-3">
                <span
                  className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded border ${resolveAccent(item.accent).border} ${resolveAccent(item.accent).text}`}
                >
                  <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-[13px] font-semibold text-white">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-5 text-[#7f8c9e]">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </SurfacePanel>
      </MarketingSection>

      <MarketingSection className="mt-12">
        <CtaBand
          title="Every feature, on every plan that needs it."
          description="Compare what each plan includes, or open the Solutions view to see the controls in operation."
          primaryHref="/pricing"
          primaryLabel="Compare plans"
          secondaryHref="/platform"
          secondaryLabel="Tour the platform"
        />
      </MarketingSection>

      <MarketingSection className="mt-6">
        <p className="flex items-center gap-2 text-sm text-[#7f8c9e]">
          <ArrowRight className="size-3.5" aria-hidden="true" />
          Capability descriptions are marketing content. Execution remains disabled in this build.
        </p>
      </MarketingSection>
    </>
  );
}
