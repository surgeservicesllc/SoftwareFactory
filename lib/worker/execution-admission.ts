import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { resolveClaudeAuth, type ClaudeAuthResolution } from "@/lib/providers/claude-auth";
import { openSecret } from "@/lib/security/secret-box-core";
import { resolveCodexAuth, type CodexAuthResolution } from "@/lib/worker/auth";

export const executionAdmissionSchema = z.object({
  id: z.string().uuid(),
  lane: z.enum(["graph_model", "phase1c"]),
  provider: z.enum(["anthropic", "openai"]),
  model: z.string().trim().min(1).max(128),
  credential_purpose: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
  credential_ref: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
  provider_credential_id: z.string().uuid(),
  provider_credential_rotated_at: z.string().datetime({ offset: true }),
  ai_account_id: z.string().uuid(),
  admission_sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export type ExecutionAdmission = z.infer<typeof executionAdmissionSchema>;

function expectedSubscriptionRef(provider: "anthropic" | "openai", purpose: string): string | null {
  const family = provider === "anthropic" ? "claude" : "codex";
  const match = new RegExp(`^${family}(?:_([2-9]|[1-9][0-9]{1,3}))?$`).exec(purpose);
  if (!match) return null;
  const base = provider === "anthropic"
    ? "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN"
    : "SOFTWAREFACTORY_CODEX_AUTH_JSON";
  return match[1] ? `${base}_${match[1]}` : base;
}

export class ExecutionAdmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionAdmissionError";
  }
}

/**
 * Opens exactly the credential row the database admitted and revalidated.
 * The service RPC returns one sealed envelope only after re-checking the
 * admission hash plus the current assignment/bot/role/account/credential
 * revisions. Neither an ambient variable nor a neighboring account slot is
 * considered as fallback.
 */
export async function loadAdmittedCredential(input: Readonly<{
  supabaseUrl: string;
  serviceRoleKey: string;
  organizationId: string;
  admission: ExecutionAdmission;
}>): Promise<string> {
  const expectedRef = expectedSubscriptionRef(
    input.admission.provider,
    input.admission.credential_purpose,
  );
  if (!expectedRef || expectedRef !== input.admission.credential_ref) {
    throw new ExecutionAdmissionError("The admitted credential slot does not match its provider account.");
  }

  const client = createClient(input.supabaseUrl, input.serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const { data, error } = await client.rpc("read_grok_execution_credential_as_worker", {
    p_organization_id: input.organizationId,
    p_admission_id: input.admission.id,
    p_admission_sha256: input.admission.admission_sha256,
  });
  if (error || typeof data !== "string" || data.length === 0) {
    throw new ExecutionAdmissionError("The admitted provider credential is no longer current or readable.");
  }
  try {
    return openSecret(data, {
      organizationId: input.organizationId,
      purpose: input.admission.credential_purpose,
    });
  } catch {
    throw new ExecutionAdmissionError("The admitted provider credential could not be opened.");
  }
}

export async function resolveAdmittedClaudeAuth(input: Readonly<{
  supabaseUrl: string;
  serviceRoleKey: string;
  organizationId: string;
  admission: ExecutionAdmission;
}>): Promise<ClaudeAuthResolution> {
  if (input.admission.lane !== "graph_model" || input.admission.provider !== "anthropic") {
    throw new ExecutionAdmissionError("A non-Anthropic admission cannot enter the Claude executor.");
  }
  const credential = await loadAdmittedCredential(input);
  return resolveClaudeAuth({ SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN: credential });
}

export async function resolveAdmittedCodexAuth(input: Readonly<{
  supabaseUrl: string;
  serviceRoleKey: string;
  organizationId: string;
  admission: ExecutionAdmission;
}>): Promise<CodexAuthResolution> {
  if (input.admission.lane !== "phase1c" || input.admission.provider !== "openai") {
    throw new ExecutionAdmissionError("A non-OpenAI admission cannot enter the Codex executor.");
  }
  const credential = await loadAdmittedCredential(input);
  return resolveCodexAuth({ SOFTWAREFACTORY_CODEX_AUTH_JSON: credential });
}
