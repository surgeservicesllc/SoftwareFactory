import "server-only";

const DEFAULT_MAX_JSON_BYTES = 32 * 1024;

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

export function jsonNoStore(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Pragma", "no-cache");
  headers.set("Vary", "Cookie, Authorization");

  return Response.json(body, { ...init, headers });
}

export async function readBoundedJson(
  request: Request,
  maxBytes = DEFAULT_MAX_JSON_BYTES,
): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new ApiRequestError(
      415,
      "unsupported_media_type",
      "Content-Type must be application/json.",
    );
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new ApiRequestError(400, "invalid_content_length", "Invalid Content-Length header.");
    }
    if (parsedLength > maxBytes) {
      throw new ApiRequestError(413, "payload_too_large", "Request body is too large.");
    }
  }

  if (!request.body) {
    throw new ApiRequestError(400, "missing_body", "A JSON request body is required.");
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let receivedBytes = 0;
  let rawBody = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel();
        throw new ApiRequestError(413, "payload_too_large", "Request body is too large.");
      }

      rawBody += decoder.decode(value, { stream: true });
    }
    rawBody += decoder.decode();
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    throw new ApiRequestError(400, "invalid_encoding", "Request body must be valid UTF-8.");
  }

  if (!rawBody.trim()) {
    throw new ApiRequestError(400, "missing_body", "A JSON request body is required.");
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new ApiRequestError(400, "invalid_json", "Request body contains invalid JSON.");
  }
}

type DatabaseError = {
  code?: string;
  message?: string;
};

/**
 * SQLSTATE codes whose raised message is authored by a repository migration and
 * is therefore safe to return verbatim. Every other database fault stays
 * opaque, so an unexpected failure can never leak schema or provider detail.
 */
const STATUS_BY_DATABASE_ERROR_CODE: Record<string, number> = {
  "22023": 400,
  "23502": 400,
  "23514": 400,
  "42501": 403,
  "40001": 409,
  "55000": 409,
  P0002: 404,
};

export function isClientSafeDatabaseErrorCode(code: string) {
  return Object.hasOwn(STATUS_BY_DATABASE_ERROR_CODE, code);
}

export function databaseErrorResponse(error: DatabaseError) {
  const status = error.code ? (STATUS_BY_DATABASE_ERROR_CODE[error.code] ?? 500) : 500;

  const message = error.code && isClientSafeDatabaseErrorCode(error.code)
    ? (error.message ?? "The request could not be completed.")
    : "The control-plane database request failed.";

  return jsonNoStore(
    {
      error: {
        code: status === 500 ? "database_error" : (error.code ?? "request_failed"),
        message,
      },
    },
    { status },
  );
}

export function requestErrorResponse(error: ApiRequestError) {
  return jsonNoStore(
    { error: { code: error.code, message: error.message } },
    { status: error.status },
  );
}

