export type SupabasePublicEnvironment = {
  publishableKey: string;
  url: string;
};

export class SupabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseConfigurationError";
  }
}

function decodeBase64Url(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

    if (typeof globalThis.atob === "function") {
      return globalThis.atob(padded);
    }

    return null;
  } catch {
    return null;
  }
}

export function isSupabaseServiceRoleCredential(value: string): boolean {
  if (value.startsWith("sb_secret_")) return true;

  const segments = value.split(".");
  if (segments.length !== 3) return false;

  const decoded = decodeBase64Url(segments[1]);
  if (!decoded) return false;

  try {
    const payload = JSON.parse(decoded) as { role?: unknown };
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

export function validateSupabasePublicEnvironment(
  rawUrl: string | undefined,
  rawPublishableKey: string | undefined,
): SupabasePublicEnvironment {
  const url = rawUrl?.trim();
  const publishableKey = rawPublishableKey?.trim();

  if (!url || !publishableKey) {
    throw new SupabaseConfigurationError(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  if (isSupabaseServiceRoleCredential(publishableKey)) {
    throw new SupabaseConfigurationError(
      "A Supabase service-role credential must never be assigned to a NEXT_PUBLIC_ environment variable.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new SupabaseConfigurationError(
      "NEXT_PUBLIC_SUPABASE_URL must be a valid URL.",
    );
  }

  const isLocal =
    parsedUrl.hostname === "127.0.0.1" || parsedUrl.hostname === "localhost";
  if (
    parsedUrl.protocol !== "https:" &&
    !(isLocal && parsedUrl.protocol === "http:")
  ) {
    throw new SupabaseConfigurationError(
      "NEXT_PUBLIC_SUPABASE_URL must use HTTPS (HTTP is allowed only for local development).",
    );
  }

  return {
    publishableKey,
    url: parsedUrl.toString().replace(/\/$/, ""),
  };
}
