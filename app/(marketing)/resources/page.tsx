import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";

import { HeroVisual } from "@/components/marketing/hero-visual";
import { IconTile, resolveIcon } from "@/components/marketing/icon";
import { NewsletterForm } from "@/components/marketing/newsletter-form";
import {
  ContentSourceNotice,
  GradientText,
  MarketingSection,
  SurfacePanel,
} from "@/components/marketing/primitives";
import { ResourceLibrary } from "@/components/marketing/resource-library";
import { getMarketingContent, getMarketingMetadata } from "@/lib/marketing/queries";
import { featuresInGroup, topicsOfKind } from "@/lib/marketing/types";

export async function generateMetadata(): Promise<Metadata> {
  return getMarketingMetadata("resources");
}

export default async function ResourcesPage() {
  const content = await getMarketingContent("resources");
  const categories = featuresInGroup(content.features, "category");
  const pillars = featuresInGroup(content.features, "pillar");
  const topics = topicsOfKind(content.topics, "topic");
  const roles = topicsOfKind(content.topics, "role");
  const page = content.page;

  return (
    <>
      <MarketingSection className="pt-10 sm:pt-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,0.7fr)] lg:items-center">
          <div>
            <h1 className="text-balance text-[34px] font-bold leading-[1.08] tracking-[-0.04em] text-white sm:text-[44px]">
              {page?.headline}{" "}
              {page?.headlineAccent ? <GradientText>{page.headlineAccent}</GradientText> : null}
            </h1>
            {page?.subheadline ? (
              <p className="mt-5 max-w-lg text-[15px] leading-7 text-[#8593a5]">{page.subheadline}</p>
            ) : null}
          </div>

          <HeroVisual variant="book" className="hidden h-[300px] lg:block" />

          {pillars.length ? (
            <ul className="space-y-5">
              {pillars.map((pillar) => {
                const Icon = resolveIcon(pillar.icon);
                return (
                  <li key={pillar.title} className="flex gap-3">
                    <Icon className="mt-0.5 size-6 shrink-0 text-[#8b9bff]" strokeWidth={1.6} aria-hidden="true" />
                    <div>
                      <h2 className="text-sm font-semibold text-white">{pillar.title}</h2>
                      <p className="mt-1 text-sm leading-5 text-[#7f8c9e]">{pillar.body}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </MarketingSection>

      <MarketingSection className="mt-8">
        <ContentSourceNotice source={content.source} />
      </MarketingSection>

      <MarketingSection className="mt-8">
        <ResourceLibrary resources={content.resources} />
      </MarketingSection>

      {categories.length ? (
        <MarketingSection className="mt-10">
          <h2 className="sr-only">Browse by category</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {categories.map((category) => (
              <li key={category.title}>
                <Link href="/resources" className="block h-full">
                  <SurfacePanel className="h-full p-4 transition-colors hover:border-[#33405a]">
                    <IconTile icon={category.icon} accent={category.accent} />
                    <h3 className="mt-4 text-[13px] font-semibold text-white">{category.title}</h3>
                    <p className="mt-2 text-sm leading-5 text-[#7f8c9e]">{category.body}</p>
                  </SurfacePanel>
                </Link>
              </li>
            ))}
          </ul>
        </MarketingSection>
      ) : null}

      <MarketingSection className="mt-10">
        <div className="grid gap-4 lg:grid-cols-3">
          {topics.length ? (
            <SurfacePanel className="p-5 sm:p-6">
              <h2 className="text-base font-semibold text-white">Popular Topics</h2>
              <ul className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5">
                {topics.map((topic) => {
                  const Icon = resolveIcon(topic.icon);
                  return (
                    <li key={topic.name}>
                      <Link href={topic.href} className="group flex min-h-11 items-start gap-2.5 py-1.5">
                        <Icon className="mt-0.5 size-4 shrink-0 text-[#8b9bff]" aria-hidden="true" />
                        <span>
                          <span className="block text-xs font-semibold text-white group-hover:text-[#c4b5fd]">
                            {topic.name}
                          </span>
                          <span className="mt-0.5 block text-xs text-[#7f8c9e]">
                            {topic.resourceCount} resources
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </SurfacePanel>
          ) : null}

          {roles.length ? (
            <SurfacePanel className="p-5 sm:p-6">
              <h2 className="text-base font-semibold text-white">Explore by Role</h2>
              <ul className="mt-5 divide-y divide-[#151c28]">
                {roles.map((role) => {
                  const Icon = resolveIcon(role.icon);
                  return (
                    <li key={role.name}>
                      <Link
                        href={role.href}
                        className="group flex min-h-11 items-center gap-3 py-3.5 first:pt-0 last:pb-0"
                      >
                        <Icon className="size-4 shrink-0 text-[#8b9bff]" aria-hidden="true" />
                        <span className="flex-1 text-xs font-medium text-white group-hover:text-[#c4b5fd]">
                          {role.name}
                        </span>
                        <span className="text-xs text-[#7f8c9e]">{role.resourceCount} resources</span>
                        <ChevronRight className="size-3.5 text-[#7f8c9e]" aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </SurfacePanel>
          ) : null}

          <SurfacePanel className="relative overflow-hidden border-[#3b2f6b] bg-gradient-to-br from-[#1b1440] to-[#0f1327] p-5 sm:p-6">
            <div
              className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-[#7c5cff]/25 blur-3xl"
              aria-hidden="true"
            />
            <div className="relative">
              <h2 className="text-base font-semibold text-white">Stay Updated</h2>
              <p className="mt-2 text-sm leading-5 text-[#b3a8d8]">
                Get the latest guides, templates and insights straight to your inbox.
              </p>
              <NewsletterForm source="resources" />
            </div>
          </SurfacePanel>
        </div>
      </MarketingSection>
    </>
  );
}
