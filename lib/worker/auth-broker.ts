import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import {
  composeDeviceLoginUrl,
  extractDeviceUserCode,
} from "@/lib/ai-accounts/device-login";
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

export type VerifiableAccount = Readonly<{
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
  listAccountsForVerification: () => Promise<VerifiableAccount[]>;
  readStoredCredential: (organizationId: string, purpose: string) => Promise<string | null>;
  markAccountVerified: (organizationId: string, accountId: string) => Promise<boolean>;
  markAccountNeedsReauth: (
    organizationId: string, accountId: string, reason: string,
  ) => Promise<boolean>;
  /**
   * Records which provider account signed in — an email address or workspace
   * name, never a credential (the database refuses secret shapes). Optional
   * because identity is decoration on a completed sign-in, never a gate.
   */
  setProviderIdentity?: (accountId: string, identity: string) => Promise<boolean>;
}>;

/**
 * One login attempt as the runner sees it: started once, watched for a URL
 * and then a token, fed exactly one code, and always disposed.
 */
export type LoginCli = Readonly<{
  waitForLoginUrl: (timeoutMs: number) => Promise<string>;
  submitCode: (code: string) => Promise<void>;
  waitForToken: (timeoutMs: number) => Promise<string>;
  /**
   * Whether the login already finished without any relayed code — a
   * device-code flow completes on the provider's side once the person
   * approves, so there is nothing to paste back. Optional: flows that need
   * the relay simply do not implement it.
   */
  pollCompleted?: () => Promise<boolean>;
  /** The display identity the CLI recorded for this login, if it did. */
  readIdentity?: () => Promise<string | null>;
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
    // A relay code that exists before this worker has even opened a login
    // belongs to a previous worker's login attempt — its OAuth exchange died
    // with that worker, and no fresh login can verify it. Failing fast turns
    // a two-minute mystery stall into an immediate, actionable message.
    const staleCode = await store.readRelayCode(session.sessionId);
    if (staleCode) {
      await store.fail(
        session.sessionId,
        "The previous sign-in attempt went stale before it could be verified. Click Connect and sign in again.",
      );
      return "failed";
    }

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
    let completedWithoutRelay = false;
    while (now() < relayDeadline) {
      // A device-code login finishes on the provider's side the moment the
      // person approves; when the CLI says so, there is nothing to relay.
      if (cli.pollCompleted && (await cli.pollCompleted())) {
        completedWithoutRelay = true;
        break;
      }
      sealedRelay = await store.readRelayCode(session.sessionId);
      if (sealedRelay) break;
      await sleep(timeouts.relayPollMs);
    }
    if (!completedWithoutRelay) {
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
    }
    await store.markVerifying(session.sessionId);

    const token = await cli.waitForToken(timeouts.tokenMs);
    await store.complete(session.sessionId, dependencies.sealCredential(session, token));

    // Decoration, never a gate: the account connects whether or not the CLI
    // recorded which provider identity signed in.
    if (cli.readIdentity && store.setProviderIdentity) {
      const identity = await cli.readIdentity().catch(() => null);
      if (identity) {
        await store.setProviderIdentity(session.accountId, identity).catch(() => false);
      }
    }
    return "connected";
  } catch (error) {
    const message = error instanceof Error ? error.message : "The sign-in failed.";
    // Named in the run log, because a swallowed failure here is exactly how a
    // session gets stuck mid-state with nobody able to say why. The message
    // is ours or the store's — never raw CLI output.
    process.stdout.write(`Session ${session.sessionId.slice(0, 8)}… failed: ${message}\n`);
    // The store sanitizes again server-side; this is belt and braces.
    await store.fail(session.sessionId, message.slice(0, 400)).catch((failError) => {
      const failMessage = failError instanceof Error ? failError.message : "unknown";
      process.stdout.write(
        `Session ${session.sessionId.slice(0, 8)}… could not even be marked failed: ${failMessage}\n`,
      );
    });
    return "failed";
  } finally {
    await cli?.dispose().catch(() => undefined);
  }
}

/**
 * What "this credential is the right kind" means per provider. Shape only:
 * the sweep proves the seal opens and the contents look like the credential
 * the account claims, never that the provider still honors it — that verdict
 * comes from real use, and arrives through `markAccountNeedsReauth`.
 */
export function credentialShapeProblem(provider: string, plaintext: string): string | null {
  if (provider === "anthropic") {
    return /^sk-ant-[A-Za-z0-9_-]{24,}$/.test(plaintext.trim())
      ? null
      : "The stored Claude credential is not shaped like a subscription token.";
  }
  if (provider === "openai") {
    try {
      const parsed: unknown = JSON.parse(plaintext);
      return parsed !== null && typeof parsed === "object"
        ? null
        : "The stored Codex credential is not the auth file the CLI writes.";
    } catch {
      return "The stored Codex credential is not the auth file the CLI writes.";
    }
  }
  // An unknown provider's shape is not checkable; that is a pass, not a fail.
  return null;
}

export type VerificationSweepResult = Readonly<{
  verified: number;
  demoted: number;
}>;

/**
 * Re-tests every connected subscription account's claim against the vault:
 * the row exists, the seal opens, the shape matches. A pass refreshes
 * `last_verified_at`; a named failure demotes to needs_reauth with a reason
 * a person can act on. Plaintext lives only inside this function.
 */
export async function verifyStoredAccounts(
  store: AuthBrokerStore,
  open: (sealed: string, context: { organizationId: string; purpose: string }) => string
    = (sealed, context) => openSecret(sealed, context),
): Promise<VerificationSweepResult> {
  let verified = 0;
  let demoted = 0;

  for (const account of await store.listAccountsForVerification()) {
    const demote = async (reason: string) => {
      await store.markAccountNeedsReauth(account.organizationId, account.accountId, reason);
      demoted += 1;
    };

    const sealed = await store.readStoredCredential(account.organizationId, account.purpose);
    if (!sealed) {
      await demote("The account says connected but no stored credential exists. Sign in again.");
      continue;
    }

    let plaintext: string;
    try {
      plaintext = open(sealed, {
        organizationId: account.organizationId,
        purpose: account.purpose,
      });
    } catch {
      await demote(
        "The stored credential cannot be opened; it may have been sealed under a rotated key. Sign in again.",
      );
      continue;
    }

    const problem = credentialShapeProblem(account.provider, plaintext);
    if (problem) {
      await demote(`${problem} Sign in again.`);
      continue;
    }

    if (await store.markAccountVerified(account.organizationId, account.accountId)) {
      verified += 1;
    }
  }

  return { verified, demoted };
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

  listAccountsForVerification = async (): Promise<VerifiableAccount[]> => {
    const { data, error } = await this.client.rpc("list_ai_accounts_for_verification");
    if (error) throw new Error("Listing accounts for verification failed.");
    return ((data ?? []) as Array<{
      verifiable_organization_id: string;
      verifiable_account_id: string;
      verifiable_provider: string;
      verifiable_purpose: string;
    }>).map((row) => ({
      organizationId: row.verifiable_organization_id,
      accountId: row.verifiable_account_id,
      provider: row.verifiable_provider,
      purpose: row.verifiable_purpose,
    }));
  };

  readStoredCredential = async (
    organizationId: string, purpose: string,
  ): Promise<string | null> => {
    const { data, error } = await this.client.rpc("read_provider_credential", {
      p_organization_id: organizationId,
      p_purpose: purpose,
    });
    if (error) throw new Error("Reading the stored credential failed.");
    return typeof data === "string" && data.length > 0 ? data : null;
  };

  markAccountVerified = async (
    organizationId: string, accountId: string,
  ): Promise<boolean> => {
    const { data, error } = await this.client.rpc("mark_ai_account_verified", {
      p_organization_id: organizationId,
      p_ai_account_id: accountId,
    });
    if (error) throw new Error("Recording the verification failed.");
    return data === true;
  };

  markAccountNeedsReauth = async (
    organizationId: string, accountId: string, reason: string,
  ): Promise<boolean> => {
    const { data, error } = await this.client.rpc("mark_ai_account_needs_reauth", {
      p_organization_id: organizationId,
      p_ai_account_id: accountId,
      p_reason: reason,
    });
    if (error) throw new Error("Recording the demotion failed.");
    return data === true;
  };

  setProviderIdentity = async (accountId: string, identity: string): Promise<boolean> => {
    const { data, error } = await this.client.rpc("set_ai_account_provider_identity", {
      p_ai_account_id: accountId,
      p_identity: identity,
    });
    // Decoration on a completed sign-in: a database that predates the
    // function, or a refused shape, is a false — never a thrown failure.
    if (error) return false;
    return data === true;
  };

  /**
   * The diagnosis surface: recent sessions with status and timing, never the
   * sealed code. Null means the projection itself is unavailable — a database
   * that predates it — which is a different fact from "no sessions exist",
   * and the log must be able to say which.
   */
  inspectSessions = async (
    limit = 20,
  ): Promise<Array<Record<string, unknown>> | null> => {
    const { data, error } = await this.client.rpc("inspect_ai_auth_sessions", {
      p_limit: limit,
    });
    if (error || !Array.isArray(data)) return null;
    return data as Array<Record<string, unknown>>;
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

export type Keystroke = Readonly<{ settleMs: number; chunk: string }>;

/**
 * How a confirmation code is typed into the CLI's paste prompt. The prompt
 * reads raw keypresses, and raw-mode Enter is a carriage return arriving as
 * its own keystroke — a newline glued onto the pasted text fills the field
 * and never submits it, which strands the login at "verifying" until the
 * token wait expires. So: the code settles first, then Enter alone, then one
 * more Enter in case the first was swallowed as part of a paste burst. The
 * extra press is harmless everywhere it can land — a busy exchange ignores
 * it, and a finished one has already printed the token we are matching.
 */
export function codeSubmissionKeystrokes(code: string): readonly Keystroke[] {
  return [
    { settleMs: 0, chunk: code.trim() },
    { settleMs: 400, chunk: "\r" },
    { settleMs: 1_500, chunk: "\r" },
  ];
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
      for (const stroke of codeSubmissionKeystrokes(code)) {
        if (stroke.settleMs > 0) {
          await new Promise((resolveSettle) => setTimeout(resolveSettle, stroke.settleMs));
        }
        if (exited) return;
        child.stdin.write(stroke.chunk);
      }
    },
    waitForToken: (timeoutMs) => waitForMatch(extractOauthToken, timeoutMs, "the credential"),
    readIdentity: async () => {
      // The CLI records which account authenticated in its config file —
      // display data, read before dispose removes the directory.
      try {
        const raw = JSON.parse(
          await readFile(path.join(configDir, ".claude.json"), "utf8"),
        ) as { oauthAccount?: { emailAddress?: unknown; organizationName?: unknown } };
        const email = raw.oauthAccount?.emailAddress;
        if (typeof email === "string" && email.includes("@")) return email;
        const workspace = raw.oauthAccount?.organizationName;
        return typeof workspace === "string" && workspace.trim().length > 0
          ? workspace.trim()
          : null;
      } catch {
        return null;
      }
    },
    dispose: async () => {
      child.stdout.removeListener("data", onChunk);
      child.stderr.removeListener("data", onChunk);
      if (!exited) child.kill("SIGTERM");
      await rm(configDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

/**
 * The Codex login's callback, recovered from what the person pastes. The CLI
 * listens on localhost and the person's browser ends on a dead localhost page
 * whose address bar still carries `code` and `state` — pasting that address
 * lets the worker replay it against its own listener. Returns the query
 * string, or null when the paste holds no `code=` to replay.
 */
export function extractCodexCallback(pasted: string): string | null {
  let text = pasted.trim();
  const fragment = text.indexOf("#");
  if (fragment >= 0) text = text.slice(0, fragment);
  const question = text.indexOf("?");
  if (question >= 0) text = text.slice(question + 1);
  if (!/(^|&)code=[^&]+/.test(text)) return null;
  return text;
}

/**
 * The port the Codex CLI's callback server chose, read from the login URL's
 * own redirect_uri. Falls back to the CLI's long-standing default.
 */
export function redirectPortFromLoginUrl(loginUrl: string): number {
  const match = /[?&]redirect_uri=([^&]+)/.exec(loginUrl);
  if (match) {
    const decoded = decodeURIComponent(match[1]);
    const port = /^https?:\/\/[^/]*:(\d{2,5})/.exec(decoded);
    if (port) return Number(port[1]);
  }
  return 1455;
}

export async function startCodexLogin(
  session: ClaimedAuthSession,
): Promise<LoginCli> {
  // Isolated per account, same as the Claude driver. CODEX_HOME is where the
  // CLI writes auth.json — the credential this login exists to mint.
  const configDir = await mkdtemp(
    path.join(tmpdir(), `sf-codex-${session.accountId.slice(0, 8)}-`),
  );

  // Device-code login: the CLI prints a verification URL and a one-time
  // code, the person types the code on the provider's own page, and the CLI
  // finishes by itself. The earlier localhost-callback relay demanded
  // copying a dead page's address — hostile on a tablet, where the address
  // bar shows only "localhost". The pty scaffold is deliberately duplicated
  // from startClaudeSetupToken: the Claude driver is proven live and frozen.
  const env = loginEnvironment(configDir);
  env.CODEX_HOME = configDir;
  const child = spawn(
    "script",
    ["-qec", "stty cols 500 rows 50 2>/dev/null; codex login --device-auth", "/dev/null"],
    { env, stdio: ["pipe", "pipe", "pipe"] },
  );

  let output = "";
  const listeners: Array<() => void> = [];
  const onChunk = (chunk: Buffer) => {
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

  const authFile = path.join(configDir, "auth.json");
  const authFileReady = async (): Promise<boolean> => {
    try {
      return (await readFile(authFile, "utf8")).trim().length > 0;
    } catch {
      return false;
    }
  };

  return {
    waitForLoginUrl: async (timeoutMs) => {
      // Both halves must be on screen before the browser is told anything:
      // the page to open and the code to type there. They ride as one URL;
      // the code lives in the fragment, which never travels to the server.
      const composed = await waitForMatch((text) => {
        const url = extractLoginUrl(text);
        if (!url) return null;
        const userCode = extractDeviceUserCode(stripAnsi(text));
        return userCode ? composeDeviceLoginUrl(url, userCode) : null;
      }, timeoutMs, "the device sign-in");
      return composed;
    },
    submitCode: async () => {
      // Nothing is ever pasted back in a device flow; a code arriving here
      // means the person was shown a paste box they should not have seen.
      throw new Error(
        "This sign-in completes on the provider's page — nothing needs to be pasted.",
      );
    },
    pollCompleted: authFileReady,
    waitForToken: async (timeoutMs) => {
      // The credential is the auth file the CLI writes, not anything printed.
      const deadline = Date.now() + timeoutMs;
      let exitNoticedAt = 0;
      for (;;) {
        try {
          const contents = await readFile(authFile, "utf8");
          if (contents.trim().length > 0) return contents;
        } catch {
          // Not written yet.
        }
        if (exited) {
          // A quit CLI gets a short grace for the final file flush, then the
          // session fails now rather than at the window's end.
          if (exitNoticedAt === 0) exitNoticedAt = Date.now();
          else if (Date.now() - exitNoticedAt > 5_000) {
            throw new Error("The provider login ended before the credential appeared.");
          }
        }
        if (Date.now() >= deadline) {
          throw new Error("Timed out waiting for the credential from the provider login.");
        }
        await new Promise((resolvePoll) => setTimeout(resolvePoll, 500));
      }
    },
    readIdentity: async () => {
      // The auth file's id_token carries the signed-in email; decoding the
      // payload for display needs no verification and mints nothing.
      try {
        const raw = JSON.parse(
          await readFile(path.join(configDir, "auth.json"), "utf8"),
        ) as { tokens?: { id_token?: unknown } };
        const idToken = raw.tokens?.id_token;
        if (typeof idToken !== "string") return null;
        const parts = idToken.split(".");
        if (parts.length !== 3) return null;
        const payload = JSON.parse(
          Buffer.from(parts[1], "base64url").toString("utf8"),
        ) as { email?: unknown };
        return typeof payload.email === "string" && payload.email.includes("@")
          ? payload.email
          : null;
      } catch {
        return null;
      }
    },
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
      if (session.provider === "openai") {
        return startCodexLogin(session);
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
