import { verifyWorkerProviderAccess, WorkerPreflightError } from "@/lib/worker/preflight";

const apiKey = process.env.OPENAI_API_KEY?.trim();
const model = process.env.SOFTWAREFACTORY_CODEX_MODEL?.trim();

try {
  const executeProbe = process.argv.includes("--execute");
  await verifyWorkerProviderAccess({ apiKey: apiKey ?? "", model: model ?? "", executeProbe });
  process.stdout.write(`OpenAI worker ${executeProbe ? "execution" : "model-access"} preflight passed.\n`);
} catch (error) {
  const code = error instanceof WorkerPreflightError ? error.code : "client_error";
  const message = error instanceof WorkerPreflightError
    ? error.message
    : "The OpenAI worker preflight failed unexpectedly.";
  process.stderr.write(
    `OpenAI worker preflight failed (${code}): ${message}\n`,
  );
  process.exitCode = 1;
}
