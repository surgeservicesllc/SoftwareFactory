import { notFound } from "next/navigation";

import { LifecycleConsole } from "@/components/graph/lifecycle-console";
import { factoryStageBySlug } from "@/lib/graph/factory-stages";
import { SDLC_STAGES, type SdlcStage } from "@/lib/sdlc/lifecycle";

/**
 * One stage, across every run.
 *
 * The segment resolves two ways, and the order matters. First the owner's
 * board slugs — `requirement`, `build`, `deploy` — which are the ten steps a
 * person is shown and the names the goal document uses. Then the stored stage
 * names themselves, so `/lifecycle/IMPLEMENTATION` keeps working for anything
 * already linking to it, including the run panel.
 *
 * Two names belong to both vocabularies — REVIEW and TEST are stored stages and
 * board slugs — so they take the board branch and render the same stage under
 * its numbered heading. That is the better answer, and it is why the board
 * lookup runs first rather than last.
 *
 * A slug naming neither gets a 404, not an empty page implying the stage is
 * merely quiet. Both lists are read from their own modules, so a stage added
 * to the enum becomes reachable here without an edit.
 */
function resolve(segment: string) {
  const board = factoryStageBySlug(segment);
  if (board) {
    return {
      stages: board.covers,
      title: `${board.number}. ${board.name}`,
      description: board.purpose,
    };
  }
  const stored = SDLC_STAGES.find(
    (candidate) => candidate.toLowerCase() === segment.trim().toLowerCase(),
  );
  return stored ? { stages: [stored as SdlcStage], title: null, description: null } : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ stage: string }>;
}) {
  const { stage } = await params;
  const match = resolve(stage);
  if (!match) return { title: "Lifecycle" };
  return { title: `${match.title ?? match.stages[0]} · Lifecycle` };
}

export default async function LifecycleStagePage({
  params,
}: {
  params: Promise<{ stage: string }>;
}) {
  const { stage } = await params;
  const match = resolve(stage);
  if (!match) notFound();

  /*
   * A board step carries its own heading — the number and the plain-language
   * purpose. A stored stage name does not: it renders exactly as it did before
   * board slugs existed, so nothing that already links to one changes.
   */
  return match.title
    ? (
        <LifecycleConsole
          stages={match.stages}
          heading={{ title: match.title, description: match.description! }}
        />
      )
    : <LifecycleConsole stage={match.stages[0]} />;
}
