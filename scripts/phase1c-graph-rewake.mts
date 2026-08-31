import { createClient } from "@supabase/supabase-js";

import { dispatchGraphWorker } from "@/lib/orchestration/dispatch";
import {
  deliverPendingGrokGraphRewake,
  GraphRewakeError,
} from "@/lib/worker/graph-rewake";
import { safeErrorMessage } from "@/lib/worker/redact";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new GraphRewakeError(`${name} is required for the exact graph re-wake.`);
  return value;
}

async function main() {
  const commandId = required("SOFTWAREFACTORY_TARGET_COMMAND_ID");
  const workerId = required("SOFTWAREFACTORY_WORKER_ID");
  const client = createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } },
  );
  const outcome = await deliverPendingGrokGraphRewake({
    client,
    workerId,
    commandId,
    graphWorkerEnabled: process.env.SOFTWAREFACTORY_GRAPH_WORKER_ENABLED === "true",
    dispatch: dispatchGraphWorker,
  });
  if (outcome.state === "dispatched") {
    process.stdout.write(`Accepted the exact canonical graph re-wake for ${outcome.graphId}.\n`);
  } else if (outcome.state === "not_pending") {
    process.stdout.write("No pending admitted Grok graph re-wake exists for the exact command.\n");
  } else {
    process.stdout.write(
      "The graph worker is disabled, so no re-wake was sent and no intent was consumed.\n",
    );
  }
}

main().catch((error) => {
  process.stderr.write(`SoftwareFactory graph re-wake stopped: ${safeErrorMessage(error)}\n`);
  process.exitCode = 1;
});
