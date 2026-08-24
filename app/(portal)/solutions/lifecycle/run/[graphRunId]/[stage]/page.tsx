import { notFound } from "next/navigation";

import { RunStageConsole } from "@/components/graph/run-stage-console";
import { SDLC_STAGES, type SdlcStage } from "@/lib/sdlc/lifecycle";

/**
 * One stage of one run — the owner's step page.
 *
 * The slug pair is validated before anything renders: a stage the vocabulary
 * does not define gets a 404 (the same rule as `/solutions/lifecycle/[stage]`),
 * and a run id that is not a UUID gets a 404 rather than a request the API
 * would refuse anyway. Whether the *run* exists is the component's question —
 * it reads the same projection as every other run surface and says honestly
 * when the id is not among the readable runs.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function matchStage(slug: string): SdlcStage | null {
  const match = SDLC_STAGES.find((candidate) => candidate.toLowerCase() === slug.toLowerCase());
  return match ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ graphRunId: string; stage: string }>;
}) {
  const { stage } = await params;
  const match = matchStage(stage);
  return { title: match ? `${match} · Run` : "Run" };
}

export default async function RunStagePage({
  params,
}: {
  params: Promise<{ graphRunId: string; stage: string }>;
}) {
  const { graphRunId, stage } = await params;
  const match = matchStage(stage);
  if (!match || !UUID_PATTERN.test(graphRunId)) notFound();
  return <RunStageConsole graphRunId={graphRunId.toLowerCase()} stage={match} />;
}
