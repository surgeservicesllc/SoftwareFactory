import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { GitHubAppSlot } from "@/lib/github/config";

/**
 * How long a minted install state (and its paired browser cookie) stays valid.
 * Ten minutes proved too tight in production: an owner finishing a GitHub
 * organization install on a tablet ran past it, and the callback rejected a
 * signature-valid state as expired (live 2026-08-16, `github_state_invalid`).
 * Thirty minutes still keeps the state short-lived, signed, user-bound, and
 * browser-bound.
 */
const STATE_LIFETIME_SECONDS = 30 * 60;

export const GITHUB_INSTALL_STATE_COOKIE = "softwarefactory_github_install_state";

export type GitHubInstallStateCookieOptions = {
  httpOnly: true;
  maxAge: number;
  path: "/";
  sameSite: "lax";
  secure: boolean;
};

/**
 * Attributes for the short-lived double-submit cookie that binds a GitHub App
 * installation callback to the browser that started it.
 *
 * `path: "/"` is deliberate. The cookie is set on the redirect that leaves for
 * GitHub and read back on the top-level return to `/api/github/install/callback`;
 * scoping it to a sub-path only narrows where the browser will replay it and,
 * worse, makes a default-path deletion silently miss it. A root path keeps set,
 * read, and delete describing the same cookie on every browser.
 *
 * `sameSite: "lax"` is exactly right for an OAuth-style return: the cookie is
 * withheld from cross-site subrequests but sent on the top-level GET navigation
 * GitHub redirects the browser through. The reliability fix for iOS/iPadOS is
 * not a looser SameSite — it is setting this cookie on a navigation response
 * rather than a background `fetch()` response, which Safari's tracking
 * prevention is entitled to drop.
 */
export function githubInstallStateCookieOptions(): GitHubInstallStateCookieOptions {
  return {
    httpOnly: true,
    maxAge: STATE_LIFETIME_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  };
}

export type GitHubInstallState = {
  appId: number;
  appSlot: GitHubAppSlot;
  exp: number;
  iat: number;
  nonce: string;
  organizationId: string;
  returnTo: string;
  userId: string;
};

export class GitHubStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubStateError";
  }
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function normalizeReturnTo(value: string | null | undefined) {
  if (!value) return "/solutions/connections";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    throw new GitHubStateError("The return path is invalid.");
  }

  const parsed = new URL(value, "https://softwarefactory.invalid");
  if (parsed.origin !== "https://softwarefactory.invalid") {
    throw new GitHubStateError("The return path must stay inside SoftwareFactory.");
  }
  if (!["/solutions/connections", "/solutions/projects", "/solutions/files"].includes(parsed.pathname)) {
    throw new GitHubStateError("The return path is not allowed for GitHub setup.");
  }
  return `${parsed.pathname}${parsed.search}`;
}

/**
 * The GitHub App installation URL the browser is redirected to, carrying the
 * signed state token GitHub echoes back to the callback.
 */
export function buildGitHubInstallAuthorizationUrl(appSlug: string, stateToken: string): string {
  const url = new URL(
    `https://github.com/apps/${encodeURIComponent(appSlug)}/installations/new`,
  );
  url.searchParams.set("state", stateToken);
  return url.toString();
}

export function createGitHubInstallState(
  input: Pick<
    GitHubInstallState,
    "appId" | "appSlot" | "organizationId" | "returnTo" | "userId"
  >,
  secret: string,
  now = Date.now(),
) {
  const issuedAt = Math.floor(now / 1000);
  const state: GitHubInstallState = {
    appId: input.appId,
    appSlot: input.appSlot,
    exp: issuedAt + STATE_LIFETIME_SECONDS,
    iat: issuedAt,
    nonce: randomBytes(32).toString("base64url"),
    organizationId: input.organizationId,
    returnTo: normalizeReturnTo(input.returnTo),
    userId: input.userId,
  };
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  return {
    expiresAt: new Date(state.exp * 1000).toISOString(),
    nonce: state.nonce,
    token: `${payload}.${sign(payload, secret)}`,
  };
}

/**
 * Reads only the server-issued routing hint needed to choose which configured
 * secret verifies the state. Callers must not trust either value until the
 * complete state has passed `verifyGitHubInstallState`.
 */
export function readGitHubInstallStateTarget(token: string): {
  appId: number;
  appSlot: GitHubAppSlot;
} {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) {
    throw new GitHubStateError("GitHub installation state is invalid.");
  }

  let state: unknown;
  try {
    state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new GitHubStateError("GitHub installation state is invalid.");
  }
  if (!state || typeof state !== "object") {
    throw new GitHubStateError("GitHub installation state is invalid.");
  }

  const candidate = state as Partial<GitHubInstallState>;
  if (
    !Number.isSafeInteger(candidate.appId)
    || Number(candidate.appId) <= 0
    || (candidate.appSlot !== "primary" && candidate.appSlot !== "candidate")
  ) {
    throw new GitHubStateError("GitHub installation state is invalid.");
  }
  return { appId: candidate.appId as number, appSlot: candidate.appSlot };
}

export function verifyGitHubInstallState(
  token: string,
  expectedNonce: string | undefined,
  expectedUserId: string,
  secret: string,
  now = Date.now(),
): GitHubInstallState {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || !safeEqual(signature, sign(payload, secret))) {
    throw new GitHubStateError("GitHub installation state is invalid.");
  }

  let state: unknown;
  try {
    state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new GitHubStateError("GitHub installation state is invalid.");
  }

  if (!state || typeof state !== "object") {
    throw new GitHubStateError("GitHub installation state is invalid.");
  }
  const candidate = state as Partial<GitHubInstallState>;
  const nowSeconds = Math.floor(now / 1000);
  if (
    !Number.isSafeInteger(candidate.appId)
    || Number(candidate.appId) <= 0
    || (candidate.appSlot !== "primary" && candidate.appSlot !== "candidate")
    || typeof candidate.exp !== "number"
    || typeof candidate.iat !== "number"
    || typeof candidate.nonce !== "string"
    || typeof candidate.organizationId !== "string"
    || typeof candidate.returnTo !== "string"
    || typeof candidate.userId !== "string"
    || candidate.iat > nowSeconds + 30
    || candidate.exp - candidate.iat > STATE_LIFETIME_SECONDS
    || candidate.nonce.length < 32
  ) {
    throw new GitHubStateError("GitHub installation state is invalid.");
  }
  // Distinct failure notices: all three verify with the same signed evidence,
  // but each asks the person for a different next step, and the single blended
  // message hid which one actually happened when a live install failed.
  if (candidate.exp <= nowSeconds) {
    throw new GitHubStateError(
      "The GitHub installation link expired before it was finished. Start the connection again from the Connections page.",
    );
  }
  if (!expectedNonce) {
    throw new GitHubStateError(
      "This browser session did not start the GitHub installation. Start the connection again from the Connections page, and finish it in the same browser.",
    );
  }
  if (
    !safeEqual(candidate.nonce, expectedNonce)
    || !safeEqual(candidate.userId, expectedUserId)
  ) {
    throw new GitHubStateError("GitHub installation state does not match this session.");
  }

  return {
    appId: candidate.appId as number,
    appSlot: candidate.appSlot,
    exp: candidate.exp,
    iat: candidate.iat,
    nonce: candidate.nonce,
    organizationId: candidate.organizationId,
    returnTo: normalizeReturnTo(candidate.returnTo),
    userId: candidate.userId,
  };
}
