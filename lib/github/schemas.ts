import { z } from "zod";

const GITHUB_WEB_ORIGIN = "https://github.com";

// Deployment URLs become durable, browser-readable release evidence. Refuse
// known credential value shapes before recording them, even when a provider
// put the value in the path rather than conventional URL userinfo.
const DEPLOYMENT_URL_CREDENTIAL_PATTERNS = [
  /-----BEGIN\s+[A-Z ]*PRIVATE KEY-----/i,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/i,
  /sk-[A-Za-z0-9_-]{20,}/,
  /sk_(?:live|test)_[A-Za-z0-9]{16,}/i,
  /sb_secret_[A-Za-z0-9_-]{20,}/i,
  /vercel_[A-Za-z0-9_-]{20,}/i,
  /AKIA[0-9A-Z]{16}/,
  /bearer(?:%20|\s)+[A-Za-z0-9._~+/-]{20,}/i,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
] as const;

function hasCredentialShapedDeploymentUrl(value: string, pathname: string) {
  let decodedPathname = pathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    // An invalid escape is already non-canonical input. The URL parser may
    // retain it, so refuse it rather than comparing two ambiguous strings.
    return true;
  }
  return DEPLOYMENT_URL_CREDENTIAL_PATTERNS.some(
    (pattern) => pattern.test(value) || pattern.test(decodedPathname),
  );
}

/**
 * Returns one comparison-safe production URL, or null for unsafe input.
 *
 * Only transport identity is canonicalized: HTTPS scheme, host casing, and
 * the default HTTPS port. Path casing remains significant release evidence.
 */
export function canonicalizeProductionDeploymentUrl(value: string): string | null {
  if (!value || value !== value.trim() || value.length > 2_048 || /[\u0000-\u001f\u007f\\]/.test(value)) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (
    url.protocol.toLowerCase() !== "https:"
    || !url.hostname
    || url.username
    || url.password
    || url.search
    || url.hash
    || hasCredentialShapedDeploymentUrl(value, url.pathname)
  ) {
    return null;
  }

  const port = !url.port || url.port === "443" ? "" : `:${url.port}`;
  return `https://${url.hostname.toLowerCase()}${port}${url.pathname}`;
}

export const productionDeploymentUrlSchema = z.string().max(2_048).refine(
  (value) => canonicalizeProductionDeploymentUrl(value) !== null,
  { message: "Expected a safe HTTPS production deployment URL." },
);

function isSafeGitHubWebUrl(value: string) {
  try {
    const url = new URL(value);
    return url.origin === GITHUB_WEB_ORIGIN
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export const githubWebUrlSchema = z.string().url().refine(isSafeGitHubWebUrl, {
  message: "Expected a GitHub web URL.",
});
