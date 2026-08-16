import { createHash } from "node:crypto";

import { z } from "zod";

import { botFabricErrorResponse } from "@/lib/bots/route";
import { jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { generateConnectCode, isCredentialStoreConfigured } from "@/lib/server/secret-box";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

/**
 * Starts a provider sign-in.
 *
 * The design constraint worth restating: Anthropic and OpenAI have no
 * third-party OAuth. The only supported way to obtain a *subscription*
 * credential is their own CLI running their own login in the operator's
 * browser. Embedding a "Sign in with Claude" button would mean impersonating
 * the Claude Code CLI's private OAuth client, which is undocumented and not
 * ours to use.
 *
 * So the flow inverts. This mints a single-use code and returns one command.
 * The operator's machine runs the provider's real login, and posts the result
 * back against that code. Nobody types a variable name, hunts a dashboard, or
 * sees a token — and no client id is borrowed.
 *
 * The code is returned exactly once, here, and stored only as a digest. Losing
 * it means starting again, which is the correct trade for a bearer credential.
 */

export const runtime = "nodejs";

/**
 * `claude_2` and friends are account slots: the same login as the base
 * purpose, stored under a distinct purpose so several subscription accounts
 * can be signed in simultaneously. Bounded to the slots the console offers;
 * the vault's purpose pattern (`^[a-z][a-z0-9_]{1,62}$`) admits them without
 * any schema change.
 */
const PURPOSES = ["claude", "claude_2", "claude_3", "codex", "codex_2", "codex_3"] as const;

const requestSchema = z.object({
  purpose: z.enum(PURPOSES),
}).strict();

/** What the operator runs. Built here so the console never assembles a command. */
function connectCommand(purpose: string, code: string, origin: string) {
  return `npx -y tsx scripts/connect.mts ${purpose} --code ${code} --host ${origin}`;
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);

    const parsed = requestSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_request", message: "Choose a provider to sign in to." } },
        { status: 400 },
      );
    }

    // Reported before a session is minted. A code that could never be redeemed
    // is worse than a refusal, because the failure would surface minutes later
    // on the operator's machine with no explanation.
    if (!isCredentialStoreConfigured()) {
      return jsonNoStore(
        {
          error: {
            code: "credential_store_not_configured",
            message:
              "SOFTWAREFACTORY_CREDENTIAL_KEY is not set, so a signed-in credential could not be stored.",
          },
        },
        { status: 503 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();

    const code = generateConnectCode();
    const { error } = await client.rpc("open_provider_connect_session", {
      p_organization_id: activeOrganization.id,
      p_purpose: parsed.data.purpose,
      p_code_digest: createHash("sha256").update(code).digest("hex"),
      p_ttl_seconds: 600,
    });

    if (error) {
      return jsonNoStore(
        { error: { code: "connect_session_failed", message: "The sign-in could not be started." } },
        { status: 403 },
      );
    }

    const origin = new URL(request.url).origin;

    return jsonNoStore({
      purpose: parsed.data.purpose,
      // Shown once and never stored in the clear. The console must not persist
      // it either; a reload should require starting again.
      command: connectCommand(parsed.data.purpose, code, origin),
      expiresInSeconds: 600,
    });
  } catch (error) {
    return botFabricErrorResponse(
      error,
      "connect_session_failed",
      "The sign-in could not be started.",
    );
  }
}
