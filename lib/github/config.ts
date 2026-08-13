import "server-only";

import { createPrivateKey } from "node:crypto";

export class GitHubConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubConfigurationError";
  }
}

export type GitHubAppConfiguration = {
  appId: number;
  appSlug: string;
  callbackUrl: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  stateSecret: string;
  webhookSecret: string;
};

export type GitHubCommitIdentity = Readonly<{
  email: string;
  name: string;
}>;

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new GitHubConfigurationError(`${name} is not configured.`);
  }
  return value;
}

function decodePrivateKey() {
  const encoded = process.env.GITHUB_APP_PRIVATE_KEY_BASE64?.trim();
  const raw = encoded
    ? Buffer.from(encoded, "base64").toString("utf8")
    : requiredEnvironment("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n");

  try {
    createPrivateKey(raw);
  } catch {
    throw new GitHubConfigurationError(
      "GITHUB_APP_PRIVATE_KEY must contain a valid server-side PEM private key.",
    );
  }

  return raw;
}

function parseHttpsUrl(name: string, value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new GitHubConfigurationError(`${name} must be a valid URL.`);
  }

  const localHttp = parsed.protocol === "http:"
    && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (parsed.protocol !== "https:" && !localHttp) {
    throw new GitHubConfigurationError(`${name} must use HTTPS outside local development.`);
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new GitHubConfigurationError(`${name} must not include credentials or a fragment.`);
  }

  return parsed.toString();
}

function isValidCommitIdentityEmail(value: string) {
  if (value.length > 254 || !/^[\x21-\x7e]+$/.test(value)) return false;

  const separator = value.lastIndexOf("@");
  if (separator <= 0 || separator !== value.indexOf("@")) return false;
  const localPart = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  if (
    localPart.length > 64
    || localPart.startsWith(".")
    || localPart.endsWith(".")
    || localPart.includes("..")
    || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(localPart)
  ) {
    return false;
  }

  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) => (
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)
  ));
}

export function getGitHubCommitIdentity(): GitHubCommitIdentity {
  const name = requiredEnvironment("GITHUB_COMMIT_IDENTITY_NAME");
  const email = requiredEnvironment("GITHUB_COMMIT_IDENTITY_EMAIL");

  if (
    name.length > 100
    || Buffer.byteLength(name, "utf8") > 128
    || /[\x00-\x1f\x7f<>]/.test(name)
  ) {
    throw new GitHubConfigurationError(
      "GITHUB_COMMIT_IDENTITY_NAME must be a valid Git commit identity name.",
    );
  }
  if (!isValidCommitIdentityEmail(email)) {
    throw new GitHubConfigurationError(
      "GITHUB_COMMIT_IDENTITY_EMAIL must be a valid Git commit identity email address.",
    );
  }

  return Object.freeze({ email, name });
}

export function getGitHubAppConfiguration(): GitHubAppConfiguration {
  const appIdValue = requiredEnvironment("GITHUB_APP_ID");
  const appId = Number(appIdValue);
  if (!Number.isSafeInteger(appId) || appId <= 0) {
    throw new GitHubConfigurationError("GITHUB_APP_ID must be a positive integer.");
  }

  const appSlug = requiredEnvironment("GITHUB_APP_SLUG");
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$/.test(appSlug)) {
    throw new GitHubConfigurationError("GITHUB_APP_SLUG is invalid.");
  }

  const stateSecret = requiredEnvironment("GITHUB_APP_STATE_SECRET");
  const webhookSecret = requiredEnvironment("GITHUB_APP_WEBHOOK_SECRET");
  if (Buffer.byteLength(stateSecret, "utf8") < 32) {
    throw new GitHubConfigurationError("GITHUB_APP_STATE_SECRET must contain at least 32 bytes.");
  }
  if (Buffer.byteLength(webhookSecret, "utf8") < 32) {
    throw new GitHubConfigurationError("GITHUB_APP_WEBHOOK_SECRET must contain at least 32 bytes.");
  }
  if (stateSecret === webhookSecret) {
    throw new GitHubConfigurationError(
      "GITHUB_APP_STATE_SECRET and GITHUB_APP_WEBHOOK_SECRET must be distinct secrets.",
    );
  }

  return {
    appId,
    appSlug,
    callbackUrl: parseHttpsUrl(
      "GITHUB_APP_CALLBACK_URL",
      requiredEnvironment("GITHUB_APP_CALLBACK_URL"),
    ),
    clientId: requiredEnvironment("GITHUB_APP_CLIENT_ID"),
    clientSecret: requiredEnvironment("GITHUB_APP_CLIENT_SECRET"),
    privateKey: decodePrivateKey(),
    stateSecret,
    webhookSecret,
  };
}

export function getSupabaseServiceRoleKey() {
  const key = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
  if (key.startsWith("sb_secret_")) return key;

  let role: unknown = null;
  const segments = key.split(".");
  if (segments.length === 3) {
    try {
      role = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"))?.role;
    } catch {
      role = null;
    }
  }
  if (role !== "service_role") {
    throw new GitHubConfigurationError(
      "SUPABASE_SERVICE_ROLE_KEY must be a server-only service-role credential.",
    );
  }
  return key;
}
