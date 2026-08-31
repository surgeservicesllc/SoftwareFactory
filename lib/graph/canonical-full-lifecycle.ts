import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildLaunchPlan, type LaunchPlan } from "@/lib/graph/launch-plan";
import {
  FULL_LIFECYCLE_TEMPLATE_KEY,
  FULL_LIFECYCLE_TEMPLATE_VERSION,
  phase1CTargetSchema,
} from "@/lib/graph/phase1c-gate-bridge";
import {
  parseRepositoryReleasePolicy,
  RELEASE_POLICY_PATH,
} from "@/lib/graph/release-policy";
import { budgetForTemplate, findTemplate, type GraphTemplate } from "@/lib/graph/templates";
import { createGitHubInstallationToken } from "@/lib/github/client";
import { getGitHubAppConfigurationForAppId } from "@/lib/github/config";
import { getGitHubBranchReference, getGitHubFile } from "@/lib/github/repository";

type DatabaseError = Readonly<{ code?: string; message?: string }>;

export type CanonicalLifecycleFailure = Readonly<{
  ok: false;
  status: number;
  code: string;
  message: string;
  details?: readonly string[];
  databaseError?: DatabaseError;
}>;

export type CanonicalLifecyclePlan = Readonly<{
  ok: true;
  template: GraphTemplate;
  plan: LaunchPlan;
}>;

export type CanonicalLifecycleReleaseIdentity = Readonly<{
  ok: true;
  target: ReturnType<typeof phase1CTargetSchema.parse>;
  baseSha: string;
  requiredChecks: readonly string[];
}>;

/**
 * Compile the one release graph the Factory is allowed to execute.
 *
 * Grok's provider-labelled task graph is routing intent. It is deliberately
 * never passed to the graph write boundary: the runtime executes the existing
 * Full Lifecycle v2 contract whose MODEL and ANCHOR semantics are already
 * enforced by the worker and Phase 1C bridge.
 */
export function buildCanonicalFullLifecyclePlan(
  goal: string,
): CanonicalLifecyclePlan | CanonicalLifecycleFailure {
  const template = findTemplate(FULL_LIFECYCLE_TEMPLATE_KEY);
  if (!template) {
    return {
      ok: false,
      status: 500,
      code: "full_lifecycle_template_missing",
      message: "The canonical Full Lifecycle template is not registered in this build.",
    };
  }
  if (template.version !== FULL_LIFECYCLE_TEMPLATE_VERSION) {
    return {
      ok: false,
      status: 409,
      code: "full_lifecycle_version_mismatch",
      message: "Full Lifecycle must launch from the current release-lineage template version.",
    };
  }
  const built = buildLaunchPlan(
    { ...template, summary: goal.trim() },
    budgetForTemplate(template),
  );
  if (!built.ok) {
    return {
      ok: false,
      status: 422,
      code: "template_does_not_compile",
      message: "The canonical Full Lifecycle template could not be compiled.",
      details: built.errors,
    };
  }
  return { ok: true, template, plan: built.plan };
}

/**
 * Resolve the exact connected repository snapshot and repository-owned check
 * policy used by both the ordinary Full Lifecycle route and Grok Bot.
 */
export async function resolveCanonicalFullLifecycleReleaseIdentity(
  client: SupabaseClient,
  organizationId: string,
  projectId: string,
): Promise<CanonicalLifecycleReleaseIdentity | CanonicalLifecycleFailure> {
  const targetRead = await client.rpc("resolve_phase1c_command_target", {
    p_organization_id: organizationId,
    p_project_id: projectId,
  }).single();
  if (targetRead.error) {
    return {
      ok: false,
      status: 500,
      code: "database_error",
      message: "The release repository binding could not be resolved.",
      databaseError: targetRead.error,
    };
  }
  const target = phase1CTargetSchema.safeParse(targetRead.data);
  if (!target.success || target.data.project_id !== projectId) {
    return {
      ok: false,
      status: 409,
      code: "release_repository_not_connected",
      message: "Full Lifecycle requires one exact active GitHub repository binding.",
    };
  }
  const coordinates = target.data.repository_full_name.split("/");
  if (coordinates.length !== 2 || !coordinates[0] || !coordinates[1]) {
    return {
      ok: false,
      status: 409,
      code: "release_repository_invalid",
      message: "The release repository identity is invalid.",
    };
  }
  const installationToken = await createGitHubInstallationToken(
    getGitHubAppConfigurationForAppId(target.data.app_id),
    target.data.external_installation_id,
    {
      permissions: { contents: "read", metadata: "read" },
      repositoryIds: [target.data.external_repository_id],
    },
  );
  const reference = await getGitHubBranchReference(
    installationToken.token,
    coordinates[0],
    coordinates[1],
    target.data.base_branch,
  );
  const baseSha = reference.object.sha.toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(baseSha)) {
    return {
      ok: false,
      status: 503,
      code: "release_base_identity_invalid",
      message: "GitHub did not return an exact release base commit identity.",
    };
  }
  const policyFile = await getGitHubFile(
    installationToken.token,
    coordinates[0],
    coordinates[1],
    baseSha,
    RELEASE_POLICY_PATH,
  );
  const policy = parseRepositoryReleasePolicy(policyFile.content);
  if (!policy) {
    return {
      ok: false,
      status: 409,
      code: "release_policy_invalid",
      message: `The exact base commit must contain a valid ${RELEASE_POLICY_PATH}.`,
    };
  }
  return {
    ok: true,
    target: target.data,
    baseSha,
    requiredChecks: policy.requiredChecks,
  };
}
