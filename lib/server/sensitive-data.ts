import "server-only";

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
  /sk-[A-Za-z0-9_-]{20,}/,
  /sb_secret_[A-Za-z0-9_-]{20,}/i,
  /vercel_[A-Za-z0-9_-]{20,}/i,
  /AKIA[0-9A-Z]{16}/,
  /bearer\s+[A-Za-z0-9._~+/-]{20,}/i,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
];

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
    || normalized.endsWith("credential")
    || normalized.endsWith("secret")
    || normalized.endsWith("token");
}

export function containsLikelySecret(value: string) {
  return likelySecretPatterns.some((pattern) => pattern.test(value));
}

export function findSensitiveData(value: unknown, path = "$", depth = 0): SensitiveDataFinding | null {
  if (depth > 24) {
    return null;
  }

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
      if (isSensitiveKey(key)) {
        return { path: nestedPath, reason: "sensitive_key" };
      }
      const finding = findSensitiveData(nestedValue, nestedPath, depth + 1);
      if (finding) return finding;
    }
  }

  return null;
}
