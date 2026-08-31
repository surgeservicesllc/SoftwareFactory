import { setTimeout as sleep } from "node:timers/promises";

import { describeCodexAuth } from "@/lib/worker/auth";
import { CodexSdkAdapter } from "@/lib/worker/codex";
import { describeClaimOutcome } from "@/lib/worker/drain-report";
import { readWorkerConfiguration, WorkerConfigurationError } from "@/lib/worker/env";
import { resolveAdmittedCodexAuth } from "@/lib/worker/execution-admission";
import { GitHubAppInstallationTokenProvider, GitHubDraftPublisher } from "@/lib/worker/github";
import { safeErrorMessage } from "@/lib/worker/redact";
import { SupabaseWorkerStore } from "@/lib/worker/supabase-store";
import { DeterministicValidator } from "@/lib/worker/validation";
import { SoftwareFactoryWorker } from "@/lib/worker/worker";
import { GitWorkspaceManager } from "@/lib/worker/workspace";

const once = process.argv.includes("--once");
let stopping = false;
process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });

async function main() {
  if (process.env.SOFTWAREFACTORY_WORKER_ENABLED?.trim() !== "true") {
    process.stdout.write("SoftwareFactory Codex worker is disabled. Set SOFTWAREFACTORY_WORKER_ENABLED=true to start it.\n");
    return;
  }

  const configuration = readWorkerConfiguration();
  // Credential selection is claim-scoped. An admitted protocol-v3 job opens
  // only its immutable account credential; a legacy job resolves the ambient
  // credential after claim and still fails closed when it is absent/invalid.
  process.stdout.write("Codex authentication will be resolved from the claimed run.\n");

  const store = SupabaseWorkerStore.create({
    url: configuration.supabaseUrl,
    serviceRoleKey: configuration.supabaseServiceRoleKey,
    provider: "openai",
    model: configuration.model,
    targetCommandId: configuration.targetCommandId,
  });
  let registered = false;
  let cleanExit = false;
  try {
    const validator = new DeterministicValidator();
    await validator.assertAvailable(configuration.workRoot);
    const worker = new SoftwareFactoryWorker(configuration.workerId, configuration.heartbeatMs, {
      store,
      tokenProvider: new GitHubAppInstallationTokenProvider(),
      workspace: new GitWorkspaceManager(configuration.workRoot, configuration.commitIdentity),
      codex: async (job) => {
        if (job.executionAdmission && (
          job.provider !== job.executionAdmission.provider
          || job.model !== job.executionAdmission.model
        )) {
          throw new Error("The claimed Phase 1C provider/model does not match its execution admission.");
        }
        const auth = job.executionAdmission
          ? await resolveAdmittedCodexAuth({
              supabaseUrl: configuration.supabaseUrl,
              serviceRoleKey: configuration.supabaseServiceRoleKey,
              organizationId: job.organizationId,
              admission: job.executionAdmission,
            })
          : configuration.resolveLegacyCodexAuth();
        process.stdout.write(`${describeCodexAuth(auth)}\n`);
        return CodexSdkAdapter.create(auth);
      },
      validator,
      publisher: new GitHubDraftPublisher(undefined, undefined, undefined, configuration.requiredChecks),
    });

    await store.register(configuration.workerId, "phase1c-v1");
    registered = true;
    process.stdout.write(`SoftwareFactory Codex worker ${configuration.workerId} is ready.\n`);
    let processed = 0;
    do {
      await store.workerHeartbeat(configuration.workerId, null);
      const outcome = await worker.runOnce();
      if (outcome === "processed") processed += 1;
      if (once) break;
      if (outcome === "idle") await sleep(configuration.pollMs);
    } while (!stopping);
    cleanExit = true;
    process.stdout.write(`${describeClaimOutcome(processed)}\n`);
  } finally {
    if (registered) {
      await store.finish(configuration.workerId, cleanExit ? "idle" : "error");
    }
  }
}

main().catch((error) => {
  const message = error instanceof WorkerConfigurationError
    ? error.message
    : safeErrorMessage(error);
  process.stderr.write(`SoftwareFactory Codex worker stopped: ${message}\n`);
  process.exitCode = 1;
});
