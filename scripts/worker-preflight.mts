import { CodexAuthError, describeCodexAuth, resolveCodexAuth } from "@/lib/worker/auth";
import { verifyWorkerProviderAccess, WorkerPreflightError } from "@/lib/worker/preflight";

const model = process.env.SOFTWAREFACTORY_CODEX_MODEL?.trim();

try {
  const auth = resolveCodexAuth();
  // The resolved mode is the thing an operator most needs to see, and the one
  // thing that is safe to print. The credential itself never is.
  process.stdout.write(`${describeCodexAuth(auth)}\n`);

  const executeProbe = process.argv.includes("--execute");
  if (executeProbe && auth.mode === "subscription") {
    // A billed completion cannot prove a zero-token setup, and running one
    // would contradict the configuration it claims to verify.
    process.stdout.write(
      "Skipping the execution probe: it is a billed API completion, and this worker is "
      + "configured for zero-token subscription execution. A live canary run is the proof.\n",
    );
  } else {
    await verifyWorkerProviderAccess({ auth, model: model ?? "", executeProbe });
  }

  process.stdout.write(
    `Codex worker ${executeProbe ? "execution" : "startup"} preflight passed (${auth.mode}).\n`,
  );
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
