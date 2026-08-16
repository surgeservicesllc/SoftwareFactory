import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { relayCodePurpose } from "@/lib/ai-accounts/purposes";
import { openSecret, sealSecret } from "@/lib/security/secret-box-core";

/**
 * The worker side of the auth broker: claim a pending sign-in, run the
 * provider's real login CLI headlessly, relay the person's confirmation code
 * into it, and seal the minted credential into the vault — all through the
 * narrow service-role functions, and all without the credential ever being
 * logged or leaving this process unsealed.
 *
 * Probed 2026-08-16 (claude CLI 2.1.233): `claude setup-token` under
 * `script -qec` (a fake TTY) with an isolated `CLAUDE_CONFIG_DIR` prints its
 * OAuth authorize URL headlessly, then waits for a pasted code, then prints
 * the minted token. The pty wraps output at the terminal width, so the runner
 * sets a wide terminal and strips ANSI before matching.
 */

export type ClaimedAuthSession = Readonly<{
  sessionId: string;
  organizationId: string;
  accountId: string;
  provider: string;
  purpose: string;
}>;

export type AuthBrokerStore = Readonly<{
  claim: (workerId: string) => Promise<ClaimedAuthSession | null>;
  reportLoginUrl: (sessionId: string, loginUrl: string) => Promise<boolean>;
  readRelayCode: (sessionId: string) => Promise<string | null>;
  markVerifying: (sessionId: string) => Promise<boolean>;
  complete: (sessionId: string, sealedEnvelope: string) => Promise<void>;
  fail: (sessionId: string, reason: string) => Promise<void>;
  expireStale: () => Promise<number>;
}>;

/**
 * One login attempt as the runner sees it: started once, watched for a URL
 * and then a token, fed exactly one code, and always disposed.
 */
export type LoginCli = Readonly<{
  waitForLoginUrl: (timeoutMs: number) => Promise<string>;
  submitCode: (code: string) => Promise<void>;
  waitForToken: (timeoutMs: number) => Promise<string>;
  dispose: () => Promise<void>;
}>;

export type AuthBrokerDependencies = Readonly<{
  store: AuthBrokerStore;
  startLogin: (session: ClaimedAuthSession) => Promise<LoginCli>;
  openRelayCode: (session: ClaimedAuthSession, sealed: string) => string;
  sealCredential: (session: ClaimedAuthSession, token: string) => string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}>;

export type AuthBrokerTimeouts = Readonly<{
  loginUrlMs: number;
  relayCodeMs: number;
  relayPollMs: number;
  tokenMs: number;
}>;

export const DEFAULT_AUTH_BROKER_TIMEOUTS: AuthBrokerTimeouts = {
  // The CLI prints its URL within seconds; ninety allows a slow npx start.
  loginUrlMs: 90_000,
  // The human side: opening the URL, signing in, copying the code back.
  relayCodeMs: 14 * 60_000,
  relayPollMs: 4_000,
  tokenMs: 120_000,
};

export type AuthBrokerOutcome = "idle" | "connected" | "failed";

/**
 * Claims and drives at most one sign-in. Returns "idle" when nothing was
 * pending — the caller decides whether to loop.
 */
export async function runAuthBrokerOnce(
  workerId: string,
  dependencies: AuthBrokerDependencies,
  timeouts: AuthBrokerTimeouts = DEFAULT_AUTH_BROKER_TIMEOUTS,
): Promise<AuthBrokerOutcome> {
  const { store } = dependencies;
  const sleep = dependencies.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = dependencies.now ?? Date.now;

  const session = await store.claim(workerId);
  if (!session) return "idle";

  let cli: LoginCli | null = null;
  try {
    cli = await dependencies.startLogin(session);

    const loginUrl = await cli.waitForLoginUrl(timeouts.loginUrlMs);
    const reported = await store.reportLoginUrl(session.sessionId, loginUrl);
    if (!reported) {
      // Superseded or expired between claim and URL — stop without failing a
      // session this worker no longer owns.
      return "failed";
    }

    const relayDeadline = now() + timeouts.relayCodeMs;
    let sealedRelay: string | null = null;
    while (now() < relayDeadline) {
      sealedRelay = await store.readRelayCode(session.sessionId);
      if (sealedRelay) break;
      await sleep(timeouts.relayPollMs);
    }
    if (!sealedRelay) {
      await store.fail(
        session.sessionId,
        "Nobody finished the provider sign-in before the worker's wait ran out.",
      );
      return "failed";
    }

    // Unsealed only here, written straight into the CLI, never logged.
    const code = dependencies.openRelayCode(session, sealedRelay);
    await cli.submitCode(code);
    await store.markVerifying(session.sessionId);

    const token = await cli.waitForToken(timeouts.tokenMs);
    await store.complete(session.sessionId, dependencies.sealCredential(session, token));
    return "connected";
  } catch (error) {
    const message = error instanceof Error ? error.message : "The sign-in failed.";
    // The store sanitizes again server-side; this is belt and braces.
    await store.fail(session.sessionId, message.slice(0, 400)).catch(() => undefined);
    return "failed";
  } finally {
    await cli?.dispose().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Supabase store
// ---------------------------------------------------------------------------

type SupabaseRpc = {
  rpc: (fn: string, args?: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

type ClaimRow = {
  claimed_session_id: string;
  claimed_organization_id: string;
  claimed_account_id: string;
  claimed_provider: string;
  claimed_purpose: string;
};

export class SupabaseAuthBrokerStore implements AuthBrokerStore {
  private constructor(private readonly client: SupabaseRpc) {}

  static create(input: { url: string; serviceRoleKey: string }) {
    return new SupabaseAuthBrokerStore(createClient(input.url, input.serviceRoleKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    }));
  }

  static forClient(client: SupabaseRpc) {
    return new SupabaseAuthBrokerStore(client);
  }

  claim = async (workerId: string): Promise<ClaimedAuthSession | null> => {
    const { data, error } = await this.client.rpc("claim_ai_auth_session", {
      p_worker_id: workerId,
    });
    if (error) throw new Error("Claiming a sign-in session failed.");
    const row = ((data ?? []) as ClaimRow[])[0];
    if (!row) return null;
    return {
      sessionId: row.claimed_session_id,
      organizationId: row.claimed_organization_id,
      accountId: row.claimed_account_id,
      provider: row.claimed_provider,
      purpose: row.claimed_purpose,
    };
  };

  reportLoginUrl = async (sessionId: string, loginUrl: string): Promise<boolean> => {
    const { data, error } = await this.client.rpc("report_ai_auth_login_url", {
      p_session_id: sessionId,
      p_login_url: loginUrl,
    });
    if (error) throw new Error("Reporting the login URL failed.");
    return data === true;
  };

  readRelayCode = async (sessionId: string): Promise<string | null> => {
    const { data, error } = await this.client.rpc("read_ai_auth_relay_code", {
      p_session_id: sessionId,
    });
    if (error) throw new Error("Reading the relayed code failed.");
    return typeof data === "string" && data.length > 0 ? data : null;
  };

  markVerifying = async (sessionId: string): Promise<boolean> => {
    const { data, error } = await this.client.rpc("mark_ai_auth_session_verifying", {
      p_session_id: sessionId,
    });
    if (error) throw new Error("Marking the session verifying failed.");
    return data === true;
  };

  complete = async (sessionId: string, sealedEnvelope: string): Promise<void> => {
    const { error } = await this.client.rpc("complete_ai_auth_session", {
      p_session_id: sessionId,
      p_sealed_envelope: sealedEnvelope,
    });
    if (error) throw new Error("Completing the sign-in failed.");
  };

  fail = async (sessionId: string, reason: string): Promise<void> => {
    const { error } = await this.client.rpc("fail_ai_auth_session", {
      p_session_id: sessionId,
      p_reason: reason,
    });
    if (error) throw new Error("Recording the failure failed.");
  };

  expireStale = async (): Promise<number> => {
    const { data, error } = await this.client.rpc("expire_ai_auth_sessions");
    if (error) throw new Error("Expiring stale sessions failed.");
    return typeof data === "number" ? data : 0;
  };
}

// ---------------------------------------------------------------------------
// The real CLI, under a fake TTY
// ---------------------------------------------------------------------------

const ANSI_PATTERN = new RegExp(
  // CSI sequences, then OSC sequences (terminated by BEL or ST).
  "\\x1b\\[[0-9;?]*[ -/]*[@-~]|\\x1b\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)",
  "g",
);

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

export function extractLoginUrl(output: string): string | null {
  // The pty runs 500 columns wide so the URL arrives on one line; matching
  // stops at whitespace or a quote, which ends the URL before any prompt text.
  const match = /https:\/\/[^\s"'<>`]+/.exec(stripAnsi(output));
  return match ? match[0] : null;
}

export function extractOauthToken(output: string): string | null {
  const match = /sk-ant-[A-Za-z0-9_-]{24,}/.exec(stripAnsi(output));
  return match ? match[0] : null;
}

/**
 * Environment for the login CLI: built, not inherited. This container may
 * itself be signed in to a Claude account — the development container is —
 * and an inherited config or credential would make a successful login prove
 * nothing about the account being connected.
 */
function loginEnvironment(configDir: string): NodeJS.ProcessEnv {
  const passthrough = ["PATH", "HOME", "LANG", "TERM", "NODE_OPTIONS"] as const;
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV, TERM: "xterm-256color" };
  for (const key of passthrough) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.CLAUDE_CONFIG_DIR = configDir;
  return env;
}

export async function startClaudeSetupToken(
  session: ClaimedAuthSession,
): Promise<LoginCli> {
  // Isolated per account: two accounts signing in concurrently never share a
  // config directory, which is the collision the spec names.
  const configDir = await mkdtemp(
    path.join(tmpdir(), `sf-auth-${session.accountId.slice(0, 8)}-`),
  );

  // `script` supplies the pseudo-terminal the CLI requires; the wide terminal
  // keeps the login URL on a single line for extraction.
  const child = spawn(
    "script",
    ["-qec", "stty cols 500 rows 50 2>/dev/null; claude setup-token", "/dev/null"],
    { env: loginEnvironment(configDir), stdio: ["pipe", "pipe", "pipe"] },
  );

  let output = "";
  const listeners: Array<() => void> = [];
  const onChunk = (chunk: Buffer) => {
    // Bounded: only the recent tail matters for matching, and an unbounded
    // buffer of terminal noise would grow for the whole human wait.
    output = (output + chunk.toString("utf8")).slice(-65_536);
    for (const listener of listeners) listener();
  };
  child.stdout.on("data", onChunk);
  child.stderr.on("data", onChunk);

  let exited = false;
  child.once("exit", () => {
    exited = true;
    for (const listener of listeners) listener();
  });

  function waitForMatch<T>(
    extract: (text: string) => T | null,
    timeoutMs: number,
    what: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const check = () => {
        const found = extract(output);
        if (found !== null) {
          cleanup();
          resolve(found);
          return;
        }
        if (exited) {
          cleanup();
          reject(new Error(`The provider login ended before ${what} appeared.`));
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for ${what} from the provider login.`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        const index = listeners.indexOf(check);
        if (index >= 0) listeners.splice(index, 1);
      };
      listeners.push(check);
      check();
    });
  }

  return {
    waitForLoginUrl: (timeoutMs) => waitForMatch(extractLoginUrl, timeoutMs, "the login URL"),
    submitCode: async (code) => {
      // After the code goes in, earlier output — which contains the URL, and
      // matches the URL extractor but never the token one — stays harmless.
      child.stdin.write(`${code}\n`);
    },
    waitForToken: (timeoutMs) => waitForMatch(extractOauthToken, timeoutMs, "the credential"),
    dispose: async () => {
      child.stdout.removeListener("data", onChunk);
      child.stderr.removeListener("data", onChunk);
      if (!exited) child.kill("SIGTERM");
      await rm(configDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

/** The production dependency wiring, shared by the script entry point. */
export function productionAuthBrokerDependencies(
  store: AuthBrokerStore,
): AuthBrokerDependencies {
  return {
    store,
    startLogin: async (session) => {
      if (session.provider !== "anthropic") {
        // Honest refusal instead of a hang: the Codex CLI's login is a
        // localhost callback, which no headless relay can complete today.
        throw new Error(
          "Only Claude accounts can be signed in by the worker so far.",
        );
      }
      return startClaudeSetupToken(session);
    },
    openRelayCode: (session, sealed) => openSecret(sealed, {
      organizationId: session.organizationId,
      purpose: relayCodePurpose(session.sessionId),
    }),
    sealCredential: (session, token) => sealSecret(token, {
      organizationId: session.organizationId,
      purpose: session.purpose,
    }),
  };
}
