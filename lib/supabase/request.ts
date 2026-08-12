import "server-only";

export class RequestOriginError extends Error {
  readonly code = "invalid_request_origin";
  readonly status = 403;

  constructor() {
    super("The request origin is not allowed.");
    this.name = "RequestOriginError";
  }
}

/**
 * Cookie-authenticated mutations must originate from the application itself.
 * SameSite cookies are defense in depth, not the only CSRF control.
 */
export function assertSameOriginRequest(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) throw new RequestOriginError();

  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    throw new RequestOriginError();
  }

  if (origin !== requestOrigin) throw new RequestOriginError();
}

export function normalizeReturnPath(
  value: string | null | undefined,
  fallback = "/",
): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  try {
    const parsed = new URL(value, "https://softwarefactory.invalid");
    if (parsed.origin !== "https://softwarefactory.invalid") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
