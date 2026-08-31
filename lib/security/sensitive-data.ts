const sensitiveKeys = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "bearer",
  "clientsecret",
  "credential",
  "credentials",
  "password",
  "passwd",
  "privatekey",
  "refreshtoken",
  "servicerolekey",
  "signingsecret",
  "webhooksecret",
]);

const likelySecretPatterns = [
  /-----BEGIN\s+[A-Z ]*PRIVATE KEY-----/i,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/i,
  /sk-[A-Za-z0-9_-]{20,}/,
  // Secret and restricted alike; `pk_` is publishable and deliberately not
  // here. lib/billing accepts an rk_ key as a valid secret, so leaving it
  // out made this detector disagree with the code that consumes the key.
  /[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/i,
  /sb_secret_[A-Za-z0-9_-]{20,}/i,
  /vercel_[A-Za-z0-9_-]{20,}/i,
  /AKIA[0-9A-Z]{16}/,
  /bearer\s+[A-Za-z0-9._~+/-]{20,}/i,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
];

const sensitiveAssignmentPattern = /^\s*(?:(?:export\s+)?(?:const|let|var)\s+|export\s+)?["']?([A-Z][A-Z0-9_]*)["']?\s*[:=]\s*(.*?)\s*[,;]?\s*$/i;
const sensitiveJsonAssignmentPattern = /["']([A-Z][A-Z0-9_]*)["']\s*:\s*(["'])(.*?)\2/gi;
const placeholderAssignmentValuePattern = /^(?:<[^<>\r\n]+>|\$\{[A-Z_][A-Z0-9_]*\}|\$[A-Z_][A-Z0-9_]*|\$\{\{[^{}\r\n]+\}\}|\{\{[^{}\r\n]+\}\}|\[\s*(?:REDACTED|PLACEHOLDER|REPLACE[-_ ]?ME|CHANGE[-_ ]?ME|TODO|TBD|NOT[-_ ]?SET|UNSET)\s*\]|(?:YOUR|EXAMPLE|PLACEHOLDER|REPLACE[-_ ]?ME|CHANGE[-_ ]?ME|TODO|TBD|REDACTED|NOT[-_ ]?SET|UNSET)(?:[-_ ][A-Z0-9]+)*|X{3,}|(?:process\.env\.|env\.)[A-Z_][A-Z0-9_]*)$/i;
const credentialUriPattern = /^[A-Z][A-Z0-9+.-]*:\/\/[^/:\s@]+:([^@\s]+)@[^\s/]+/i;

export type SensitiveDataFinding = {
  path: string;
  reason: "sensitive_key" | "likely_secret_value";
};

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string) {
  const normalized = normalizeKey(key);
  return sensitiveKeys.has(normalized)
    || normalized.endsWith("password")
    || normalized.endsWith("apikey")
    || normalized.endsWith("privatekey")
    || normalized.endsWith("privatekeybase64")
    || normalized.endsWith("credential")
    || normalized.endsWith("servicerolekey")
    || normalized.endsWith("secretaccesskey")
    || normalized.endsWith("secretkey")
    || normalized.endsWith("secret")
    || normalized.endsWith("token");
}

function hasCredentialUriValue(key: string, value: string) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey.endsWith("url") && !normalizedKey.endsWith("dsn")) return false;

  const credentials = value.match(credentialUriPattern);
  const password = credentials?.[1];
  return Boolean(password && !placeholderAssignmentValuePattern.test(password));
}

function normalizeAssignedValue(rawValue: string) {
  let value = rawValue.trim().replace(/[,;]\s*$/, "").trim();
  value = value.replace(/\s+#.*$/, "").trim();

  if (value.length >= 2) {
    const firstCharacter = value[0];
    const lastCharacter = value[value.length - 1];
    if ((firstCharacter === '"' && lastCharacter === '"')
      || (firstCharacter === "'" && lastCharacter === "'")) {
      value = value.slice(1, -1).trim();
    }
  }

  return value;
}

function containsSensitiveAssignment(value: string) {
  const lineAssignmentDetected = value.split(/\r?\n/).some((line) => {
    const assignment = line.match(sensitiveAssignmentPattern);
    if (!assignment) return false;

    const key = assignment[1] ?? "";
    const assignedValue = normalizeAssignedValue(assignment[2] ?? "");
    if (!assignedValue || placeholderAssignmentValuePattern.test(assignedValue)) return false;
    return isSensitiveKey(key) || hasCredentialUriValue(key, assignedValue);
  });
  if (lineAssignmentDetected) return true;

  for (const assignment of value.matchAll(sensitiveJsonAssignmentPattern)) {
    const key = assignment[1] ?? "";
    const assignedValue = normalizeAssignedValue(assignment[3] ?? "");
    if (!assignedValue || placeholderAssignmentValuePattern.test(assignedValue)) continue;
    if (isSensitiveKey(key) || hasCredentialUriValue(key, assignedValue)) return true;
  }
  return false;
}

export function containsLikelySecret(value: string) {
  return likelySecretPatterns.some((pattern) => pattern.test(value))
    || containsSensitiveAssignment(value);
}

export function findSensitiveData(value: unknown, path = "$", depth = 0): SensitiveDataFinding | null {
  if (depth > 24) return null;

  if (typeof value === "string") {
    return containsLikelySecret(value) ? { path, reason: "likely_secret_value" } : null;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const finding = findSensitiveData(value[index], `${path}[${index}]`, depth + 1);
      if (finding) return finding;
    }
    return null;
  }

  if (value && typeof value === "object") {
    for (const [key, nestedValue] of Object.entries(value)) {
      const nestedPath = `${path}.${key}`;
      if (isSensitiveKey(key)) return { path: nestedPath, reason: "sensitive_key" };
      const finding = findSensitiveData(nestedValue, nestedPath, depth + 1);
      if (finding) return finding;
    }
  }

  return null;
}
