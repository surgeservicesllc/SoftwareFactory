import { notFound } from "next/navigation";

import { StageConsole } from "@/components/stage-console";
import { SDLC_LIFECYCLE, stageFromSlug } from "@/lib/sdlc/lifecycle";

/**
 * The ten stage landing pages.
 *
 * One route, not ten files. The reference asks for a consistent template on
 * every stage, and ten hand-written pages is the reliable way to end up with
 * ten slightly different ones — the tenth written a month after the first,
 * against a schema that has moved. The stage is a parameter; the page is the
 * same page.
 *
 * `generateStaticParams` enumerates the ten from the lifecycle table, so the
 * set of valid URLs and the set of stages cannot drift apart, and anything else
 * under `/solutions/factory` is a 404 rather than an empty stage that renders
 * as one that has not started.
 */

export function generateStaticParams() {
  return SDLC_LIFECYCLE.map((stage) => ({ stage: stage.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ stage: string }>;
}) {
  const { stage: slug } = await params;
  const definition = stageFromSlug(slug);
  if (!definition) return { title: "Stage not found" };
  return {
    title: `${definition.number} ${definition.title}`,
    description: definition.purpose,
  };
}

export default async function LifecycleStagePage({
  params,
}: {
  params: Promise<{ stage: string }>;
}) {
  const { stage: slug } = await params;
  const definition = stageFromSlug(slug);
  if (!definition) notFound();

  return <StageConsole stage={definition.stage} />;
}
