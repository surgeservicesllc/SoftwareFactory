import "server-only";

export class SupabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseConfigurationError";
  }
}

type SupabasePublicEnvironment = {
  publishableKey: string;
  url: string;
};

function isServiceRoleCredential(value: string) {
  if (value.startsWith("sb_secret_")) return true;

  const segments = value.split(".");
  if (segments.length !== 3) return false;

  try {
    const payload = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8"),
    ) as { role?: unknown };
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

export function getSupabasePublicEnvironment(): SupabasePublicEnvironment {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();

  if (!url || !publishableKey) {
    throw new SupabaseConfigurationError(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  if (isServiceRoleCredential(publishableKey)) {
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

  const isLocal = parsedUrl.hostname === "127.0.0.1" || parsedUrl.hostname === "localhost";
  if (parsedUrl.protocol !== "https:" && !(isLocal && parsedUrl.protocol === "http:")) {
    throw new SupabaseConfigurationError(
      "NEXT_PUBLIC_SUPABASE_URL must use HTTPS (HTTP is allowed only for local development).",
    );
  }

  return { publishableKey, url: parsedUrl.toString().replace(/\/$/, "") };
}
