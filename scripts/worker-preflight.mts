import { CodexAuthError, describeCodexAuth, resolveCodexAuth } from "@/lib/worker/auth";
import {
  verifyWorkerProviderAccess,
  verifyWorkerRuntime,
  WorkerPreflightError,
} from "@/lib/worker/preflight";

const model = process.env.SOFTWAREFACTORY_CODEX_MODEL?.trim();

try {
  const executeProbe = process.argv.includes("--execute");
  if (!executeProbe) {
    await verifyWorkerRuntime({ model: model ?? "" });
    process.stdout.write(
      "Codex worker startup preflight passed; authentication is deferred to the claimed run.\n",
    );
  } else {
    const auth = resolveCodexAuth();
    // Explicit provider preflight is the only pre-claim path that inspects an
    // ambient credential. Ordinary execution resolves the claimed admission.
    process.stdout.write(`${describeCodexAuth(auth)}\n`);
    if (auth.mode === "subscription") {
      // A billed completion cannot prove a zero-token setup, and running one
      // would contradict the configuration it claims to verify.
      process.stdout.write(
        "Skipping the execution probe: it is a billed API completion, and this worker is "
        + "configured for zero-token subscription execution. A live canary run is the proof.\n",
      );
    }
    await verifyWorkerProviderAccess({ auth, model: model ?? "", executeProbe });
    process.stdout.write(`Codex worker execution preflight passed (${auth.mode}).\n`);
  }
} catch (error) {
  const code = error instanceof WorkerPreflightError || error instanceof CodexAuthError
    ? error.code
    : "client_error";
  const message = error instanceof WorkerPreflightError || error instanceof CodexAuthError
    ? error.message
    : "The Codex worker preflight failed unexpectedly.";
  process.stderr.write(`Codex worker preflight failed (${code}): ${message}\n`);
  process.exitCode = 1;
}
