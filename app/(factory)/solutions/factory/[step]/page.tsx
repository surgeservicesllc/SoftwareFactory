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
}: {
  params: Promise<{ step: string }>;
}) {
  const { step } = await params;
  const match = factoryStep(step);
  if (!match) notFound();
  const viewer = await readViewer();
  return (
    <FactoryStepConsole
      step={match}
      viewer={viewer.signedIn
        ? { email: viewer.email, displayName: viewer.displayName }
        : undefined}
    />
  );
}
