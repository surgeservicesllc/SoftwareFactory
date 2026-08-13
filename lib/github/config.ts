import "server-only";

import { createPrivateKey, createPublicKey } from "node:crypto";

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

export type GitHubAppSlot = "candidate" | "primary";

export type GitHubAppConfigurationEntry = Readonly<{
  configuration: GitHubAppConfiguration;
  slot: GitHubAppSlot;
}>;

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

function optionalEnvironment(name: string) {
  return process.env[name]?.trim() || null;
}

function decodePrivateKey(prefix: "GITHUB_APP" | "GITHUB_CANDIDATE_APP") {
  const encodedName = `${prefix}_PRIVATE_KEY_BASE64`;
  const rawName = `${prefix}_PRIVATE_KEY`;
  const encoded = optionalEnvironment(encodedName);
  const configuredRaw = optionalEnvironment(rawName);
  if (prefix === "GITHUB_CANDIDATE_APP" && encoded && configuredRaw) {
    throw new GitHubConfigurationError(
      "Configure exactly one of GITHUB_CANDIDATE_APP_PRIVATE_KEY_BASE64 or GITHUB_CANDIDATE_APP_PRIVATE_KEY.",
    );
  }
  const raw = encoded
    ? Buffer.from(encoded, "base64").toString("utf8")
    : requiredEnvironment(rawName).replace(/\\n/g, "\n");

  try {
    createPrivateKey(raw);
  } catch {
    throw new GitHubConfigurationError(
      `${rawName} must contain a valid server-side PEM private key.`,
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

function privateKeyFingerprint(privateKey: string) {
  return createPublicKey(createPrivateKey(privateKey))
    .export({ format: "der", type: "spki" })
    .toString("base64");
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

function readGitHubAppConfiguration(
  prefix: "GITHUB_APP" | "GITHUB_CANDIDATE_APP",
): GitHubAppConfiguration {
  const appIdName = `${prefix}_ID`;
  const appSlugName = `${prefix}_SLUG`;
  const callbackUrlName = `${prefix}_CALLBACK_URL`;
  const clientIdName = `${prefix}_CLIENT_ID`;
  const clientSecretName = `${prefix}_CLIENT_SECRET`;
  const stateSecretName = `${prefix}_STATE_SECRET`;
  const webhookSecretName = `${prefix}_WEBHOOK_SECRET`;
  const appIdValue = requiredEnvironment(appIdName);
  const appId = Number(appIdValue);
  if (!Number.isSafeInteger(appId) || appId <= 0) {
    throw new GitHubConfigurationError(`${appIdName} must be a positive integer.`);
  }

  const appSlug = requiredEnvironment(appSlugName);
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$/.test(appSlug)) {
    throw new GitHubConfigurationError(`${appSlugName} is invalid.`);
  }

  const stateSecret = requiredEnvironment(stateSecretName);
  const webhookSecret = requiredEnvironment(webhookSecretName);
  if (Buffer.byteLength(stateSecret, "utf8") < 32) {
    throw new GitHubConfigurationError(`${stateSecretName} must contain at least 32 bytes.`);
  }
  if (Buffer.byteLength(webhookSecret, "utf8") < 32) {
    throw new GitHubConfigurationError(`${webhookSecretName} must contain at least 32 bytes.`);
  }
  if (stateSecret === webhookSecret) {
    throw new GitHubConfigurationError(
      `${stateSecretName} and ${webhookSecretName} must be distinct secrets.`,
    );
  }

  return {
    appId,
    appSlug,
    callbackUrl: parseHttpsUrl(
      callbackUrlName,
      requiredEnvironment(callbackUrlName),
    ),
    clientId: requiredEnvironment(clientIdName),
    clientSecret: requiredEnvironment(clientSecretName),
    privateKey: decodePrivateKey(prefix),
    stateSecret,
    webhookSecret,
  };
}

const candidateEnvironmentNames = [
  "GITHUB_CANDIDATE_APP_ID",
  "GITHUB_CANDIDATE_APP_SLUG",
  "GITHUB_CANDIDATE_APP_CALLBACK_URL",
  "GITHUB_CANDIDATE_APP_CLIENT_ID",
  "GITHUB_CANDIDATE_APP_CLIENT_SECRET",
  "GITHUB_CANDIDATE_APP_PRIVATE_KEY",
  "GITHUB_CANDIDATE_APP_PRIVATE_KEY_BASE64",
  "GITHUB_CANDIDATE_APP_STATE_SECRET",
  "GITHUB_CANDIDATE_APP_WEBHOOK_SECRET",
] as const;

function validateCandidateIsolation(
  primary: GitHubAppConfiguration,
  candidate: GitHubAppConfiguration,
) {
  const reusedField = [
    ["ID", primary.appId, candidate.appId],
    ["SLUG", primary.appSlug.toLowerCase(), candidate.appSlug.toLowerCase()],
    ["CLIENT_ID", primary.clientId, candidate.clientId],
    ["CLIENT_SECRET", primary.clientSecret, candidate.clientSecret],
    ["STATE_SECRET", primary.stateSecret, candidate.stateSecret],
    ["WEBHOOK_SECRET", primary.webhookSecret, candidate.webhookSecret],
  ].find(([, primaryValue, candidateValue]) => primaryValue === candidateValue)?.[0];
  if (reusedField) {
    throw new GitHubConfigurationError(
      `GITHUB_CANDIDATE_APP_${reusedField} must be distinct from the primary GitHub App value.`,
    );
  }
  if (privateKeyFingerprint(primary.privateKey) === privateKeyFingerprint(candidate.privateKey)) {
    throw new GitHubConfigurationError(
      "GITHUB_CANDIDATE_APP_PRIVATE_KEY must be distinct from the primary GitHub App private key.",
    );
  }

  const protocolSecrets = [
    ["GITHUB_APP_CLIENT_SECRET", primary.clientSecret],
    ["GITHUB_APP_STATE_SECRET", primary.stateSecret],
    ["GITHUB_APP_WEBHOOK_SECRET", primary.webhookSecret],
    ["GITHUB_CANDIDATE_APP_CLIENT_SECRET", candidate.clientSecret],
    ["GITHUB_CANDIDATE_APP_STATE_SECRET", candidate.stateSecret],
    ["GITHUB_CANDIDATE_APP_WEBHOOK_SECRET", candidate.webhookSecret],
  ] as const;
  for (let left = 0; left < protocolSecrets.length; left += 1) {
    for (let right = left + 1; right < protocolSecrets.length; right += 1) {
      if (protocolSecrets[left]![1] === protocolSecrets[right]![1]) {
        throw new GitHubConfigurationError(
          `${protocolSecrets[left]![0]} and ${protocolSecrets[right]![0]} must be distinct secrets.`,
        );
      }
    }
  }
}

export function getGitHubAppConfiguration(): GitHubAppConfiguration {
  return readGitHubAppConfiguration("GITHUB_APP");
}

function readGitHubCandidateAppConfiguration(
  primary: GitHubAppConfiguration,
): GitHubAppConfiguration | null {
  if (!candidateEnvironmentNames.some((name) => optionalEnvironment(name) !== null)) return null;
  const candidate = readGitHubAppConfiguration("GITHUB_CANDIDATE_APP");
  validateCandidateIsolation(primary, candidate);
  return candidate;
}

export function getGitHubCandidateAppConfiguration(): GitHubAppConfiguration | null {
  return readGitHubCandidateAppConfiguration(getGitHubAppConfiguration());
}

export function getGitHubAppConfigurationForSlot(slot: GitHubAppSlot) {
  if (slot === "primary") return getGitHubAppConfiguration();
  const candidate = getGitHubCandidateAppConfiguration();
  if (!candidate) {
    throw new GitHubConfigurationError("The candidate GitHub App is not configured.");
  }
  return candidate;
}

export function getGitHubAppConfigurationEntries(): readonly GitHubAppConfigurationEntry[] {
  const primary = getGitHubAppConfiguration();
  const candidate = readGitHubCandidateAppConfiguration(primary);
  return Object.freeze([
    Object.freeze({ configuration: primary, slot: "primary" as const }),
    ...(candidate
      ? [Object.freeze({ configuration: candidate, slot: "candidate" as const })]
      : []),
  ]);
}

export function getGitHubAppConfigurationForAppId(appId: number) {
  if (!Number.isSafeInteger(appId) || appId <= 0) {
    throw new GitHubConfigurationError("GitHub App id must be a positive integer.");
  }
  const entry = getGitHubAppConfigurationEntries()
    .find((candidate) => candidate.configuration.appId === appId);
  if (!entry) {
    throw new GitHubConfigurationError("The requested GitHub App is not configured.");
  }
  return entry.configuration;
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
