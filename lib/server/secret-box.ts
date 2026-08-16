import "server-only";

/**
 * The server-guarded face of the secret box. The implementation lives in
 * `lib/security/secret-box-core.ts` so the auth-broker worker — plain Node,
 * where `server-only` throws by design — can seal and open too. Application
 * code imports this module and keeps the guard; see the core's header for
 * the rule.
 */
export {
  SecretBoxError,
  codesMatch,
  generateConnectCode,
  isCredentialStoreConfigured,
  openSecret,
  sealSecret,
} from "@/lib/security/secret-box-core";
