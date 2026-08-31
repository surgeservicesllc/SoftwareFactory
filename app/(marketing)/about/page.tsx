import { Compass, Gem, Heart, User } from "lucide-react";
import type { Metadata } from "next";

import { HeroVisual } from "@/components/marketing/hero-visual";
import { IconTile, resolveAccent } from "@/components/marketing/icon";
import {
  ContentSourceNotice,
  Eyebrow,
  GradientText,
  MarketingSection,
  SectionHeading,
  StatRow,
  SurfacePanel,
} from "@/components/marketing/primitives";
import { getMarketingContent, getMarketingMetadata } from "@/lib/marketing/queries";
import { featuresInGroup } from "@/lib/marketing/types";

export async function generateMetadata(): Promise<Metadata> {
  return getMarketingMetadata("about");
}

export default async function AboutPage() {
  const content = await getMarketingContent("about");
  const values = featuresInGroup(content.features, "value");
  const page = content.page;

  return (
    <>
      <MarketingSection className="pt-10 sm:pt-14">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div>
            {page?.eyebrow ? <Eyebrow>{page.eyebrow}</Eyebrow> : null}
            <h1 className="mt-5 text-balance text-[38px] font-bold leading-[1.06] tracking-[-0.04em] text-foreground sm:text-[52px]">
              {page?.headline}{" "}
              {page?.headlineAccent ? <GradientText>{page.headlineAccent}</GradientText> : null}
            </h1>
            {page?.subheadline ? (
              <p className="mt-6 max-w-xl text-[15px] leading-7 text-muted">{page.subheadline}</p>
            ) : null}
            <div className="mt-9">
              <StatRow stats={content.stats} />
            </div>
          </div>
          <HeroVisual variant="cube" />
        </div>
      </MarketingSection>

      <MarketingSection className="mt-6">
        <ContentSourceNotice source={content.source} />
      </MarketingSection>

      <MarketingSection className="mt-10">
        <SurfacePanel className="grid grid-cols-1 gap-10 p-6 sm:p-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,2fr)]">
          <div className="lg:border-r lg:border-line lg:pr-8">
            <div className="flex items-center gap-3">
              <IconTile icon="sparkles" accent="violet" className="border-[#3b2f6b]" />
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-foreground">Our Mission</h2>
            </div>
            <p className="mt-5 text-sm leading-7 text-muted">
              To empower every team to <GradientText>build better software</GradientText>,{" "}
              <GradientText>faster</GradientText>, with AI-driven tools, automation and a
              collaborative platform designed for the <GradientText>future</GradientText>.
            </p>
            <div className="mt-6 flex items-center gap-2 text-sm text-faint">
              <Compass className="size-4 text-[#4d8dff]" aria-hidden="true" />
              Idea to impact, with review and control intact.
            </div>
          </div>

          <div>
            <div className="flex items-center gap-3">
              <IconTile icon="gem" accent="blue" className="border-[#26406b]" />
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-foreground">Our Values</h2>
            </div>
            <ul className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-5">
              {values.map((value) => (
                <li key={value.title}>
                  <div className="flex items-center gap-2">
                    <span className={resolveAccent(value.accent).text}>
                      <IconTile
                        icon={value.icon}
                        accent={value.accent}
                        size="sm"
                        className="border-transparent bg-transparent"
                      />
                    </span>
                    <h3 className="text-[13px] font-semibold text-foreground">{value.title}</h3>
                  </div>
                  <p className="mt-2 text-sm leading-5 text-faint">{value.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </SurfacePanel>
      </MarketingSection>

      <MarketingSection className="mt-14">
        <SectionHeading
          title="Our Leadership"
          description="A team of builders, innovators and leaders passionate about the future of software."
        />
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {content.team.map((member) => (
            <li key={member.name}>
              <SurfacePanel className="flex h-full overflow-hidden">
                <div
                  className="relative w-[38%] shrink-0 bg-gradient-to-b from-[#141b2c] to-[#0a0f1a]"
                  aria-hidden="true"
                >
                  <span className="absolute inset-0 grid place-items-center text-[#3b4658]">
                    <User className="size-10" strokeWidth={1.4} />
                  </span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col p-4">
                  <h3 className="truncate text-sm font-semibold text-foreground">{member.name}</h3>
                  <p className="mt-1 text-sm text-faint">{member.role}</p>
                  <div className="mt-3 flex gap-2">
                    {member.linkedinUrl ? (
                      <a
                        href={member.linkedinUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`${member.name} on LinkedIn`}
                        className="grid size-7 place-items-center rounded-md border border-line font-mono text-xs font-bold lowercase text-[var(--site-accent-text)] transition-colors hover:border-line-strong"
                      >
                        <span aria-hidden="true">in</span>
                      </a>
                    ) : null}
                    {member.twitterUrl ? (
                      <a
                        href={member.twitterUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`${member.name} on X`}
                        className="grid size-7 place-items-center rounded-md border border-line font-mono text-sm font-bold text-[var(--site-accent-text)] transition-colors hover:border-line-strong"
                      >
                        <span aria-hidden="true">X</span>
                      </a>
                    ) : null}
                  </div>
                  <p className="mt-3 text-xs leading-4 text-faint">{member.bio}</p>
                </div>
              </SurfacePanel>
            </li>
          ))}
        </ul>
      </MarketingSection>

      <MarketingSection className="mt-10">
        <SurfacePanel className="flex flex-col items-center gap-6 px-6 py-6 lg:flex-row lg:gap-10">
          <div className="flex shrink-0 items-center gap-3">
            <Heart className="size-5 text-[#e879f9]" aria-hidden="true" />
            <p className="text-sm font-medium text-muted">Trusted by innovative teams worldwide</p>
          </div>
          <ul className="flex flex-1 flex-wrap items-center justify-center gap-x-10 gap-y-4 lg:justify-between">
            {content.logos.map((logo) => (
              <li
                key={logo.name}
                className="text-[17px] font-semibold tracking-[-0.01em] text-faint transition-colors hover:text-foreground"
              >
                {logo.wordmark}
              </li>
            ))}
          </ul>
        </SurfacePanel>
      </MarketingSection>

      <MarketingSection className="mt-10">
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm leading-5 text-muted">
          <Gem className="size-4 shrink-0 text-[#4d8dff]" aria-hidden="true" />
          Company metrics shown above are illustrative targets for this build, not audited figures.
        </div>
      </MarketingSection>
    </>
  );
}
