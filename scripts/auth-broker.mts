import { z } from "zod";

import {
  productionAuthBrokerDependencies,
  runAuthBrokerOnce,
  SupabaseAuthBrokerStore,
} from "@/lib/worker/auth-broker";

/**
 * The auth-broker worker entry point.
 *
 * Runs in GitHub Actions (or any machine with the environment below), claims
 * pending sign-in sessions, and drives the provider's real login for each:
 * capture the URL, wait for the person's relayed code, mint the credential,
 * seal it into the vault. Exits when no session is pending or the overall
 * deadline passes — the workflow's cron and the dispatch from Connect both
 * start a fresh one.
 *
 * Environment: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (the
 * store), SOFTWAREFACTORY_CREDENTIAL_KEY (the seal), and a worker id.
 */

const environmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().startsWith("https://"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SOFTWAREFACTORY_CREDENTIAL_KEY: z.string().min(20),
  SOFTWAREFACTORY_WORKER_ID: z.string().trim().min(3).max(120)
    .default("auth-broker-local"),
  /** Overall wall-clock budget; the workflow timeout is the hard stop. */
  SOFTWAREFACTORY_AUTH_BROKER_DEADLINE_MS: z.coerce.number().int()
    .min(60_000).max(40 * 60_000).default(25 * 60_000),
}).passthrough();

async function main() {
  const parsed = environmentSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    process.stderr.write(`Auth broker cannot start; check: ${missing}\n`);
    process.exitCode = 1;
    return;
  }
  const env = parsed.data;

  const store = SupabaseAuthBrokerStore.create({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  });

  const expired = await store.expireStale();
  if (expired > 0) {
    process.stdout.write(`Marked ${expired} stale sign-in session(s) expired.\n`);
  }

  const deadline = Date.now() + env.SOFTWAREFACTORY_AUTH_BROKER_DEADLINE_MS;
  const dependencies = productionAuthBrokerDependencies(store);

  let handled = 0;
  for (;;) {
    if (Date.now() >= deadline) {
      process.stdout.write("Auth broker deadline reached; exiting cleanly.\n");
      break;
    }
    const outcome = await runAuthBrokerOnce(env.SOFTWAREFACTORY_WORKER_ID, dependencies);
    if (outcome === "idle") {
      process.stdout.write(
        handled === 0
          ? "No sign-in sessions were pending.\n"
          : `Handled ${handled} sign-in session(s); none left pending.\n`,
      );
      break;
    }
    handled += 1;
    process.stdout.write(`Sign-in session ${outcome}.\n`);
  }
}

main().catch((error) => {
  // Never the output itself — a failure message here must not carry anything
  // the login printed.
  const message = error instanceof Error ? error.message : "unexpected error";
  process.stderr.write(`Auth broker stopped: ${message}\n`);
  process.exitCode = 1;
});
