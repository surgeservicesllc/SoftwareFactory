const credentialPatterns = [
  /-----BEGIN\s+[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END\s+[A-Z ]*PRIVATE KEY-----/gi,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/gi,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bsb_secret_[A-Za-z0-9_-]{20,}\b/gi,
  /\bvercel_[A-Za-z0-9_-]{20,}\b/gi,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}\b/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
] as const;

export function redactText(
  value: unknown,
  options: { maximumLength?: number; secrets?: readonly string[] } = {},
) {
  const maximumLength = options.maximumLength ?? 4_000;
  let text = typeof value === "string" ? value : String(value ?? "");
  for (const secret of options.secrets ?? []) {
    if (secret.length >= 8) text = text.split(secret).join("[REDACTED]");
  }
  for (const pattern of credentialPatterns) {
    text = text.replace(pattern, "[REDACTED]");
  }
  text = text.replace(
    /(^|\n)(\s*(?:export\s+)?[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY)[A-Z0-9_]*\s*=\s*)[^\r\n]+/gi,
    "$1$2[REDACTED]",
  );
  return text.length <= maximumLength
    ? text
    : `${text.slice(0, maximumLength)}\n[TRUNCATED]`;
}

export function safeErrorMessage(error: unknown) {
  return redactText(error instanceof Error ? error.message : error, { maximumLength: 1_000 });
}

export function hasLikelySecret(value: string) {
  return credentialPatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  }) || /(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY)[A-Z0-9_]*\s*[:=]\s*["']?(?!\s*(?:$|<|\$\{|YOUR_|EXAMPLE_|REDACTED|PLACEHOLDER|TODO|TBD|NOT_SET|UNSET))[A-Za-z0-9/+_.=-]{12,}/i.test(value);
}
