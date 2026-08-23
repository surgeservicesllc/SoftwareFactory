import { notFound } from "next/navigation";

import { LifecycleConsole } from "@/components/graph/lifecycle-console";
import { SDLC_STAGES, type SdlcStage } from "@/lib/sdlc/lifecycle";

/**
 * One stage, across every run.
 *
 * The slug is validated against the eight the application defines rather than
 * rendered for anything: a URL naming a stage that cannot exist gets a 404,
 * not an empty page implying the stage is merely quiet. That is what keeps
 * DISCOVER — named in the goal document, absent from the enum — from looking
 * like a real stage nothing has reached (ADR-136).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ stage: string }>;
}) {
  const { stage } = await params;
  const match = SDLC_STAGES.find((candidate) => candidate.toLowerCase() === stage.toLowerCase());
  return { title: match ? `${match} · Lifecycle` : "Lifecycle" };
}

export default async function LifecycleStagePage({
  params,
}: {
  params: Promise<{ stage: string }>;
}) {
  const { stage } = await params;
  const match = SDLC_STAGES.find((candidate) => candidate.toLowerCase() === stage.toLowerCase());
  if (!match) notFound();
  return <LifecycleConsole stage={match as SdlcStage} />;
}
