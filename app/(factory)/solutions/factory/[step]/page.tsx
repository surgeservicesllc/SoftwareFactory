import { notFound } from "next/navigation";

import { FactoryStepConsole } from "@/components/graph/factory-step-console";
import { readViewer } from "@/lib/auth/viewer";
import { factoryStep } from "@/lib/sdlc/factory-steps";

/**
 * One of the ten factory steps under "02. AI Factory".
 *
 * The slug is validated against the ten-step vocabulary rather than rendered
 * for anything: a URL naming a step that cannot exist gets a 404, not an
 * empty page implying the step is merely quiet. The viewer is read here so
 * the workspace topbar can name who is signed in.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ step: string }>;
}) {
  const { step } = await params;
  const match = factoryStep(step);
  return { title: match ? `${match.number}. ${match.title}` : "AI Factory" };
}

export default async function FactoryStepPage({
  params,
  searchParams,
}: {
  params: Promise<{ step: string }>;
  searchParams: Promise<{
    graphId?: string | string[];
    graphRunId?: string | string[];
    projectId?: string | string[];
  }>;
}) {
  const { step } = await params;
  const selectionParams = await searchParams;
  const match = factoryStep(step);
  if (!match) notFound();
  const viewer = await readViewer();
  // Repeated values are ambiguous identities, so they are ignored rather than
  // choosing the first value supplied by an untrusted URL.
  const one = (value: string | string[] | undefined) =>
    typeof value === "string" && value !== "" ? value : undefined;
  return (
    <FactoryStepConsole
      step={match}
      initialSelection={{
        graphId: one(selectionParams.graphId),
        graphRunId: one(selectionParams.graphRunId),
        projectId: one(selectionParams.projectId),
      }}
      viewer={viewer.signedIn
        ? { email: viewer.email, displayName: viewer.displayName }
        : undefined}
    />
  );
}
