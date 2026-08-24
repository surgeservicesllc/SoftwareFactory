import { notFound, redirect } from "next/navigation";

import { SDLC_STAGES } from "@/lib/sdlc/lifecycle";

/**
 * A run without a stage lands on its first stage.
 *
 * The per-run pages are stage pages; there is no separate overview here
 * because the Pipelines runs panel already is one. Redirecting to the first
 * stage keeps every `/run/{id}` link meaningful without inventing a second
 * summary of the same rows.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RunPage({
  params,
}: {
  params: Promise<{ graphRunId: string }>;
}) {
  const { graphRunId } = await params;
  if (!UUID_PATTERN.test(graphRunId)) notFound();
  redirect(`/solutions/lifecycle/run/${graphRunId.toLowerCase()}/${SDLC_STAGES[0].toLowerCase()}`);
}
