import { createHash } from "node:crypto";

import { z } from "zod";

import { createSupabaseGitHubWebhookClient } from "@/lib/github/service-role";
import { jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { sealSecret } from "@/lib/server/secret-box";

/**
 * Receives a signed-in credential from the operator's own machine.
 *
 * This is the only route in the application that accepts credential material,
 * so its shape is defensive by default.
 *
 * **No session, and deliberately no same-origin check.** The caller is a CLI on
 * someone's laptop, not a browser. The one-time code *is* the authorization,
 * and it is verified inside the database function against a digest. Requiring a
 * cookie here would make the flow impossible; requiring an origin would only
 * block honest clients, since a CLI sets whatever origin it likes.
 *
 * **The token is sealed before it is stored and never after.** It exists in
 * memory for the duration of this handler and goes into the database encrypted.
 * It is never logged, never echoed, and never returned — not even in an error.
 *
 * **Every failure answers the same way.** Wrong code, expired code, spent code,
 * and unknown code are one response. Distinguishing them turns this endpoint
 * into an oracle for guessing codes.
 */

export const runtime = "nodejs";

const requestSchema = z.object({
  code: z.string().min(20).max(200),
  // Bounded generously: an OAuth credential document is larger than an API key
  // but nowhere near this. The cap exists so a mistake cannot post a file.
  token: z.string().min(8).max(8192),
}).strict();

const INVALID = {
  error: {
    code: "connect_session_invalid",
    message: "That sign-in link is not valid. Start a new one from the console.",
  },
} as const;

/**
 * Reserved for a failure that has nothing to do with the code presented, so it
 * cannot be used to tell one code from another.
 */
const UNAVAILABLE = {
  error: {
    code: "connect_unavailable",
    message: "Bot connection is temporarily unavailable. Try the same link again shortly.",
  },
} as const;

export async function POST(request: Request) {
  let parsed: z.infer<typeof requestSchema>;

  try {
    const body = await readBoundedJson(request, 32 * 1024);
    const result = requestSchema.safeParse(body);
    if (!result.success) {
      // Shaped like every other failure so a malformed post cannot be told
      // apart from a wrong code.
      return jsonNoStore(INVALID, { status: 400 });
    }
    parsed = result.data;
  } catch {
    return jsonNoStore(INVALID, { status: 400 });
  }

  try {
    const client = createSupabaseGitHubWebhookClient();
    const digest = createHash("sha256").update(parsed.code).digest("hex");

    // Two calls, because the seal is bound to the session's organization and
    // purpose, and only the database knows which session this code belongs to.
    // Resolve answers that without mutating; claim re-validates under a row
    // lock, so a session taken between the two simply fails to claim rather
    // than storing a credential against the wrong tenant.
    const { data: peek, error: peekError } = await client
      .rpc("resolve_provider_connect_session", { p_code_digest: digest });

    if (peekError) {
      // A failed lookup is not a bad code, and saying so cost an operator the
      // whole flow: `resolve_provider_connect_session` is absent from hosted
      // (audit run 32316446825), so every correct code has been answered "that
      // sign-in link is not valid" and every retry mints another code that
      // fails the same way.
      //
      // This does not reopen the oracle the uniform failures close. Unknown,
      // expired, spent and malformed codes still answer identically; this
      // branch cannot be reached by choosing a code, because the lookup either
      // works for every code or fails for every code.
      return jsonNoStore(UNAVAILABLE, { status: 503 });
    }
    if (!peek || !Array.isArray(peek) || peek.length === 0) {
      return jsonNoStore(INVALID, { status: 400 });
    }

    const session = peek[0] as { session_organization_id: string; session_purpose: string };

    const sealed = sealSecret(parsed.token, {
      organizationId: session.session_organization_id,
      purpose: session.session_purpose,
    });

    const { data, error } = await client.rpc("claim_provider_connect_session", {
      p_code_digest: digest,
      p_sealed_envelope: sealed,
    });

    if (error || !data || !Array.isArray(data) || data.length === 0) {
      return jsonNoStore(INVALID, { status: 400 });
    }

    return jsonNoStore({
      connected: true,
      purpose: session.session_purpose,
      message: `${session.session_purpose} is connected. You can close this terminal.`,
    });
  } catch {
    // Nothing from the failure is surfaced: the exception could carry the token
    // in a stack frame or a request context.
    return jsonNoStore(INVALID, { status: 400 });
  }
}
