import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/server/service-role";

/**
 * The signed GitHub webhook boundary's service-role client. It shares one
 * implementation with the durable worker boundary so there is a single place
 * where the service-role credential is resolved.
 */
export function createSupabaseGitHubWebhookClient() {
  return createSupabaseServiceRoleClient();
}
