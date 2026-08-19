/**
 * Device-code login, as one composable URL.
 *
 * The Codex CLI's device flow prints a verification URL and a short one-time
 * code; the person opens the page, types the code, approves, and the CLI
 * finishes by itself — no localhost callback, nothing to copy back. The
 * broker session has exactly one channel for "what the browser should show"
 * (the reported login URL), so the code rides in that URL's fragment. A
 * fragment never travels to the provider's server, and the code itself is a
 * 15-minute pairing code that is useless without the person's own provider
 * login — not a credential.
 */

export const DEVICE_CODE_FRAGMENT = "sf-device-code";

export function composeDeviceLoginUrl(url: string, userCode: string): string {
  const base = url.split("#")[0];
  return `${base}#${DEVICE_CODE_FRAGMENT}=${encodeURIComponent(userCode)}`;
}

export function parseDeviceLogin(loginUrl: string): { url: string; userCode: string | null } {
  const [base, fragment] = loginUrl.split("#");
  if (!fragment || !fragment.startsWith(`${DEVICE_CODE_FRAGMENT}=`)) {
    return { url: loginUrl, userCode: null };
  }
  const raw = fragment.slice(DEVICE_CODE_FRAGMENT.length + 1);
  try {
    const decoded = decodeURIComponent(raw);
    return decoded.trim().length > 0
      ? { url: base, userCode: decoded }
      : { url: loginUrl, userCode: null };
  } catch {
    return { url: loginUrl, userCode: null };
  }
}

/** The one-time code as the CLI prints it: grouped uppercase, hyphenated. */
export function extractDeviceUserCode(output: string): string | null {
  const match = /(?<![A-Za-z0-9-])[A-Z0-9]{4,8}-[A-Z0-9]{4,8}(?![A-Za-z0-9-])/.exec(output);
  return match ? match[0] : null;
}
