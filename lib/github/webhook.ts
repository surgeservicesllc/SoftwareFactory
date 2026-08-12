import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const MAX_GITHUB_WEBHOOK_BYTES = 2 * 1024 * 1024;

export function sha256Hex(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

export function verifyGitHubWebhookSignature(
  rawBody: Uint8Array,
  signatureHeader: string | null,
  secret: string,
) {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const supplied = signatureHeader.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/i.test(supplied)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const suppliedBytes = Buffer.from(supplied.toLowerCase(), "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return suppliedBytes.length === expectedBytes.length
    && timingSafeEqual(suppliedBytes, expectedBytes);
}

export async function readBoundedWebhookBody(
  request: Request,
  maxBytes = MAX_GITHUB_WEBHOOK_BYTES,
) {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxBytes) {
      throw new Error("webhook_payload_too_large");
    }
  }
  if (!request.body) throw new Error("webhook_body_missing");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new Error("webhook_payload_too_large");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
