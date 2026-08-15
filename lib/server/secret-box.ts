import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Authenticated encryption for provider credentials at rest.
 *
 * `AGENTS.md` says a connection record is metadata plus a reference to
 * server-side secret material, not a credential store. That rule assumed every
 * credential was an API key an operator could put in an environment variable.
 * A subscription OAuth token is different: it is minted by a login flow, it
 * rotates, and there is no operator step where it could be typed into a
 * dashboard. Storing it is the only way "sign in" can exist at all.
 *
 * So the rule is amended rather than abandoned, and this module is the amendment:
 * a credential may be stored only sealed, only by the server, and only where the
 * key that opens it lives outside the database. A database dump on its own is
 * inert.
 *
 * AES-256-GCM, because the tag is what makes tampering detectable. Encryption
 * without authentication would let someone with write access to the row flip
 * bits and have the plaintext change rather than the open fail.
 */

export class SecretBoxError extends Error {
  readonly code: "key_missing" | "key_weak" | "malformed" | "tampered";

  constructor(code: SecretBoxError["code"], message: string) {
    super(message);
    this.name = "SecretBoxError";
    this.code = code;
  }
}

const ENVELOPE_VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * The master key, from the environment and nowhere else.
 *
 * Deliberately never defaulted. A development fallback would be a key committed
 * to source control, and every environment that forgot to set one would share
 * it — which is indistinguishable from no encryption while looking encrypted.
 */
function masterKey(): Buffer {
  const raw = process.env.SOFTWAREFACTORY_CREDENTIAL_KEY?.trim();
  if (!raw) {
    throw new SecretBoxError(
      "key_missing",
      "SOFTWAREFACTORY_CREDENTIAL_KEY is not set, so credentials cannot be sealed or opened.",
    );
  }

  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new SecretBoxError("key_weak", "SOFTWAREFACTORY_CREDENTIAL_KEY must be base64.");
  }

  if (key.length < KEY_BYTES) {
    // A short key is the failure that looks like success: everything encrypts
    // and decrypts fine, with far less strength than the algorithm implies.
    throw new SecretBoxError(
      "key_weak",
      "SOFTWAREFACTORY_CREDENTIAL_KEY must decode to at least 32 bytes.",
    );
  }
  return key;
}

/**
 * Derives a distinct key per (organization, purpose).
 *
 * Without this, one master key encrypts every row, and a ciphertext lifted from
 * one organization's row would open in another's. The derivation binds the key
 * to who it belongs to before any encryption happens.
 */
function deriveKey(organizationId: string, purpose: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", masterKey(), Buffer.from(organizationId, "utf8"),
      Buffer.from(`softwarefactory:${purpose}`, "utf8"), KEY_BYTES),
  );
}

/**
 * Seals a credential.
 *
 * The organization and purpose travel as additional authenticated data as well
 * as through the key derivation. That is belt and braces on purpose: moving a
 * sealed value to another organization's row, or reusing a Claude token as a
 * Codex one, fails to open rather than silently succeeding.
 */
export function sealSecret(
  plaintext: string,
  context: { readonly organizationId: string; readonly purpose: string },
): string {
  if (!plaintext) throw new SecretBoxError("malformed", "Refusing to seal an empty secret.");

  const key = deriveKey(context.organizationId, context.purpose);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${context.organizationId}:${context.purpose}`, "utf8"));

  const sealed = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENVELOPE_VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    sealed.toString("base64"),
  ].join(".");
}

/**
 * Opens a sealed credential.
 *
 * Throws on any tampering, on a wrong organization, and on a wrong purpose.
 * There is deliberately no "best effort" mode: a caller that could not open a
 * credential must not proceed with a partial or guessed one.
 */
export function openSecret(
  envelope: string,
  context: { readonly organizationId: string; readonly purpose: string },
): string {
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
    throw new SecretBoxError("malformed", "The sealed credential is not a recognised envelope.");
  }

  const [, ivPart, tagPart, dataPart] = parts;
  const iv = Buffer.from(ivPart, "base64");
  const tag = Buffer.from(tagPart, "base64");
  const data = Buffer.from(dataPart, "base64");

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretBoxError("malformed", "The sealed credential has an invalid envelope.");
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm", deriveKey(context.organizationId, context.purpose), iv,
    );
    decipher.setAAD(Buffer.from(`${context.organizationId}:${context.purpose}`, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof SecretBoxError) throw error;
    // The underlying error distinguishes bad tag from bad key, which is a
    // detail an attacker would enjoy. Both are the same answer here.
    throw new SecretBoxError(
      "tampered",
      "The sealed credential could not be opened; it was altered, or belongs elsewhere.",
    );
  }
}

/** Whether sealing is possible at all, for rendering Not Connected honestly. */
export function isCredentialStoreConfigured(): boolean {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Constant-time comparison for one-time connect codes.
 *
 * A connect code is a bearer credential for the few minutes it lives, so
 * comparing it with `===` would leak its prefix through timing.
 */
export function codesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** A connect code: 160 bits, URL-safe, never derived from anything guessable. */
export function generateConnectCode(): string {
  return randomBytes(20).toString("base64url");
}
