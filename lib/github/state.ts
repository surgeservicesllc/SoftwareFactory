import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { GitHubAppSlot } from "@/lib/github/config";

const STATE_LIFETIME_SECONDS = 10 * 60;

export const GITHUB_INSTALL_STATE_COOKIE = "softwarefactory_github_install_state";

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
    || candidate.exp <= nowSeconds
    || candidate.exp - candidate.iat > STATE_LIFETIME_SECONDS
    || candidate.nonce.length < 32
    || !expectedNonce
    || !safeEqual(candidate.nonce, expectedNonce)
    || !safeEqual(candidate.userId, expectedUserId)
  ) {
    throw new GitHubStateError("GitHub installation state is expired or does not match this session.");
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
