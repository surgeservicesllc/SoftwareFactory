import { z } from "zod";

import {
  productionAuthBrokerDependencies,
  runAuthBrokerOnce,
  SupabaseAuthBrokerStore,
  verifyStoredAccounts,
} from "@/lib/worker/auth-broker";
import { captureUsageForAccounts, SupabaseUsageRecorder } from "@/lib/worker/usage-probe";

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
    .min(60_000).max(350 * 60_000).default(25 * 60_000),
  /**
   * The commit this worker was released from. When set, the idle loop
   * compares it against the repository's current default branch and exits
   * on a mismatch, so a merge reaches the queue without cancelling anyone.
   */
  SOFTWAREFACTORY_WORKER_RELEASE_SHA: z.string().trim().length(40).optional(),
  GITHUB_REPOSITORY: z.string().trim().min(3).optional(),
}).passthrough();

/**
 * Whether a newer worker release exists on the default branch. Best-effort:
 * any network or API problem reads as "not stale", because coverage matters
 * more than promptness — the workflow timeout still bounds the run.
 */
async function newerReleaseExists(
  repository: string | undefined,
  releaseSha: string | undefined,
): Promise<boolean> {
  if (!repository || !releaseSha) return false;
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/commits/main`,
      { headers: { accept: "application/vnd.github.sha" } },
    );
    if (!response.ok) return false;
    const current = (await response.text()).trim();
    return current.length === 40 && current !== releaseSha;
  } catch {
    return false;
  }
}

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

  // The queue as this run actually sees it — status and timing only, so a
  // disagreement between a spinner and a worker stops being an argument.
  const inspected = await store.inspectSessions(10);
  if (inspected === null) {
    process.stdout.write(
      "Session projection unavailable — this database predates inspect_ai_auth_sessions "
      + "(the newest migrations have not been applied here).\n",
    );
  } else if (inspected.length === 0) {
    process.stdout.write("Session table: empty (no sign-in has ever reached the database).\n");
  } else {
    for (const row of inspected) {
      process.stdout.write(
        `Session ${String(row.inspected_session_id).slice(0, 8)}…`
        + ` provider=${row.inspected_provider}`
        + ` status=${row.inspected_status}`
        + ` worker=${row.inspected_worker_id ?? "-"}`
        + ` created=${row.inspected_created_at}`
        + ` expires=${row.inspected_expires_at}\n`,
      );
    }
  }

  // The verification sweep: every connected account's claim re-tested against
  // the vault (row exists, seal opens, shape matches). Shape-level only — a
  // pass never asserts the provider still honors the token. And never fatal:
  // a sweep that cannot read must not take down sign-in coverage — the first
  // live connected account exposed exactly that, killing every worker at
  // startup while both providers' Connect buttons starved.
  const sweep = await verifyStoredAccounts(store).catch((error) => {
    const message = error instanceof Error ? error.message : "unexpected error";
    process.stdout.write(`Verification sweep skipped: ${message}\n`);
    return { verified: 0, demoted: 0 };
  });
  if (sweep.verified > 0 || sweep.demoted > 0) {
    process.stdout.write(
      `Verified ${sweep.verified} account(s); demoted ${sweep.demoted} to needs_reauth.\n`,
    );
  }

  // The usage sweep: ask each connected account's provider how much of its
  // subscription windows are used, and record the answer (or the named
  // failure) as append-only evidence for the Bot Manager. Like verification,
  // never fatal — and resilient to a hosted database that predates the usage
  // migration, which reads as a recorder error, not a crash.
  const usageRecorder = SupabaseUsageRecorder.create({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  });
  const captureUsage = async () => {
    const usage = await captureUsageForAccounts(store, usageRecorder).catch((error) => {
      const message = error instanceof Error ? error.message : "unexpected error";
      process.stdout.write(`Usage sweep skipped: ${message}\n`);
      return { measured: 0, unavailable: 0, unsupported: 0, errors: 0 };
    });
    if (usage.measured + usage.unavailable + usage.unsupported + usage.errors > 0) {
      process.stdout.write(
        `Usage sweep: ${usage.measured} measured, ${usage.unavailable} unavailable, `
        + `${usage.unsupported} unsupported, ${usage.errors} record error(s).\n`,
      );
    }
  };
  await captureUsage();

  const deadline = Date.now() + env.SOFTWAREFACTORY_AUTH_BROKER_DEADLINE_MS;
  const dependencies = productionAuthBrokerDependencies(store);

  // Linger rather than exit on idle: a person who clicks Connect a minute
  // after this run starts must not wait for the next scheduled run. The
  // whole window stays covered; the workflow timeout is the hard stop.
  const IDLE_POLL_MS = 10_000;
  const SWEEP_EVERY_TICKS = 30;
  // Usage refresh cadence while lingering: every ~30 minutes of idle time,
  // so a long worker window keeps the Bot Manager's numbers current without
  // hammering the provider's usage endpoint.
  const USAGE_EVERY_TICKS = 180;

  let handled = 0;
  let idleTicks = 0;
  let announcedIdle = false;
  for (;;) {
    if (Date.now() >= deadline) {
      process.stdout.write(
        `Deadline reached; handled ${handled} sign-in session(s) this window.\n`,
      );
      break;
    }
    const outcome = await runAuthBrokerOnce(env.SOFTWAREFACTORY_WORKER_ID, dependencies);
    if (outcome === "idle") {
      if (!announcedIdle) {
        process.stdout.write(
          handled === 0
            ? "No sign-in sessions pending; staying available for new ones.\n"
            : `Handled ${handled} sign-in session(s); staying available for new ones.\n`,
        );
        announcedIdle = true;
      }
      idleTicks += 1;
      if (idleTicks % USAGE_EVERY_TICKS === 0) {
        await captureUsage();
      }
      if (idleTicks % SWEEP_EVERY_TICKS === 0) {
        await store.expireStale();
        if (await newerReleaseExists(
          env.GITHUB_REPOSITORY, env.SOFTWAREFACTORY_WORKER_RELEASE_SHA,
        )) {
          process.stdout.write(
            "A newer worker release exists on main; exiting so the queue hands over.\n",
          );
          break;
        }
      }
      await new Promise((resolveSleep) => setTimeout(
        resolveSleep, Math.min(IDLE_POLL_MS, Math.max(0, deadline - Date.now())),
      ));
      continue;
    }
    handled += 1;
    announcedIdle = false;
    process.stdout.write(`Sign-in session ${outcome}.\n`);
    // A finished sign-in may have connected a new account; capture its usage
    // now rather than waiting out the idle cadence.
    if (outcome === "connected") await captureUsage();
  }
}

main().catch((error) => {
  // Never the output itself — a failure message here must not carry anything
  // the login printed.
  const message = error instanceof Error ? error.message : "unexpected error";
  process.stderr.write(`Auth broker stopped: ${message}\n`);
  process.exitCode = 1;
});
