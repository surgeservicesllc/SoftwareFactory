import { z } from "zod";

import { getGitHubAppConfiguration } from "@/lib/github/config";
import { githubRouteErrorResponse } from "@/lib/github/errors";
import { createSupabaseGitHubWebhookClient } from "@/lib/github/service-role";
import {
  readBoundedWebhookBody,
  sha256Hex,
  verifyGitHubWebhookSignature,
} from "@/lib/github/webhook";
import { jsonNoStore } from "@/lib/server/http";

export const runtime = "nodejs";

const deliveryPattern = /^[A-Za-z0-9-]{16,128}$/;
const eventPattern = /^[a-z][a-z0-9_]{0,62}$/;
const actionSchema = z.string().regex(eventPattern);
const externalIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const installationSchema = z.object({
  id: externalIdSchema,
  updated_at: z.string().datetime({ offset: true }).optional(),
});
const repositorySchema = z.object({
  archived: z.boolean().optional(),
  default_branch: z.string().max(255).optional(),
  disabled: z.boolean().optional(),
  id: externalIdSchema,
  full_name: z.string().min(3).max(201).regex(/^[^/\s]+\/[^/\s]+$/),
  name: z.string().min(1).max(100).optional(),
  owner: z.object({ login: z.string().min(1).max(100) }).optional(),
  updated_at: z.string().datetime({ offset: true }),
  visibility: z.enum(["public", "private", "internal"]).optional(),
});
const repositoryIdSchema = z.object({ id: externalIdSchema });
const installationRepositorySchema = z.object({
  archived: z.boolean(),
  default_branch: z.string().min(1).max(255),
  disabled: z.boolean(),
  full_name: z.string().min(3).max(201).regex(/^[^/\s]+\/[^/\s]+$/),
  html_url: z.string().url(),
  id: externalIdSchema,
  name: z.string().min(1).max(100),
  node_id: z.string().max(255).nullable().optional(),
  owner: z.object({ login: z.string().min(1).max(100) }),
  permissions: z.record(z.string(), z.boolean()).optional(),
  private: z.boolean(),
  pushed_at: z.string().datetime({ offset: true }).nullable().optional(),
  updated_at: z.string().datetime({ offset: true }),
  visibility: z.enum(["public", "private", "internal"]),
});
const senderSchema = z.object({
  id: externalIdSchema,
  login: z.string().min(1).max(100),
});
const pullRequestSchema = z.object({
  id: externalIdSchema,
  number: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  state: z.enum(["closed", "open"]),
  draft: z.boolean().optional(),
  html_url: z.string().url(),
});
const checkStatusSchema = z.enum([
  "completed",
  "in_progress",
  "pending",
  "queued",
  "requested",
  "waiting",
]);
const checkConclusionSchema = z.enum([
  "action_required",
  "cancelled",
  "failure",
  "neutral",
  "skipped",
  "stale",
  "startup_failure",
  "success",
  "timed_out",
]);
const checkSchema = z.object({
  id: externalIdSchema,
  status: checkStatusSchema,
  conclusion: checkConclusionSchema.nullable().optional(),
});
const webhookEnvelopeSchema = z.object({
  action: actionSchema.optional(),
  installation: installationSchema.optional(),
  repository: repositorySchema.optional(),
  repositories_added: z.array(z.union([repositoryIdSchema, installationRepositorySchema])).max(500).optional(),
  repositories_removed: z.array(repositoryIdSchema).max(500).optional(),
  ref: z.string().min(1).max(512).optional(),
  after: z.string().regex(/^[0-9a-f]{40,64}$/).optional(),
  state: z.enum(["error", "failure", "pending", "success"]).optional(),
  sha: z.string().regex(/^[0-9a-f]{40,64}$/).optional(),
  pull_request: pullRequestSchema.optional(),
  check_run: checkSchema.optional(),
  check_suite: checkSchema.optional(),
  workflow_run: checkSchema.optional(),
  sender: senderSchema.optional(),
});
type WebhookPayload = z.infer<typeof webhookEnvelopeSchema>;

const acceptedWebhookSchemas = {
  check_run: webhookEnvelopeSchema.extend({
    action: actionSchema,
    check_run: checkSchema,
    installation: installationSchema,
    repository: repositorySchema,
  }),
  check_suite: webhookEnvelopeSchema.extend({
    action: actionSchema,
    check_suite: checkSchema,
    installation: installationSchema,
    repository: repositorySchema,
  }),
  installation: webhookEnvelopeSchema.extend({
    action: actionSchema,
    installation: installationSchema,
  }),
  installation_repositories: webhookEnvelopeSchema.extend({
    action: z.enum(["added", "removed"]),
    installation: installationSchema,
    repositories_added: z.array(installationRepositorySchema).max(500),
    repositories_removed: z.array(repositoryIdSchema).max(500),
  }),
  pull_request: webhookEnvelopeSchema.extend({
    action: actionSchema,
    installation: installationSchema,
    pull_request: pullRequestSchema,
    repository: repositorySchema,
  }),
  push: webhookEnvelopeSchema.extend({
    after: z.string().regex(/^[0-9a-f]{40,64}$/),
    installation: installationSchema,
    ref: z.string().min(1).max(512),
    repository: repositorySchema,
  }),
  repository: webhookEnvelopeSchema.extend({
    action: actionSchema,
    installation: installationSchema,
    repository: repositorySchema,
  }),
  "status": webhookEnvelopeSchema.extend({
    installation: installationSchema,
    repository: repositorySchema,
    sha: z.string().regex(/^[0-9a-f]{40,64}$/),
    state: z.enum(["error", "failure", "pending", "success"]),
  }),
  "workflow_run": webhookEnvelopeSchema.extend({
    action: actionSchema,
    installation: installationSchema,
    repository: repositorySchema,
    workflow_run: checkSchema,
  }),
};
type AcceptedEventName = keyof typeof acceptedWebhookSchemas;

const ignoredWebhookSchema = z.object({});

function isAcceptedEventName(eventName: string): eventName is AcceptedEventName {
  return Object.prototype.hasOwnProperty.call(acceptedWebhookSchemas, eventName);
}

function redactedPayload(payload: WebhookPayload) {
  return {
    action: payload.action ?? null,
    installation_id: payload.installation?.id ?? null,
    installation_updated_at: payload.installation?.updated_at ?? null,
    repository: payload.repository
      ? {
        archived: payload.repository.archived ?? null,
        default_branch: payload.repository.default_branch ?? null,
        disabled: payload.repository.disabled ?? null,
        full_name: payload.repository.full_name,
        id: payload.repository.id,
        name: payload.repository.name ?? null,
        owner_login: payload.repository.owner?.login ?? null,
        updated_at: payload.repository.updated_at,
        visibility: payload.repository.visibility ?? null,
      }
      : null,
    added_repository_ids: payload.repositories_added?.map((repository) => repository.id) ?? [],
    added_repositories: payload.repositories_added?.flatMap((repository) =>
      "full_name" in repository
        ? [{
          archived: repository.archived,
          default_branch: repository.default_branch,
          disabled: repository.disabled,
          full_name: repository.full_name,
          html_url: repository.html_url,
          id: repository.id,
          name: repository.name,
          node_id: repository.node_id ?? null,
          owner_login: repository.owner.login,
          permissions: repository.permissions ?? {},
          private: repository.private,
          pushed_at: repository.pushed_at ?? null,
          updated_at: repository.updated_at,
          visibility: repository.visibility,
        }]
        : [],
    ) ?? [],
    removed_repository_ids: payload.repositories_removed?.map((repository) => repository.id) ?? [],
    ref: payload.ref ?? null,
    after: payload.after ?? null,
    commit_status: payload.state && payload.sha
      ? { sha: payload.sha, state: payload.state }
      : null,
    pull_request: payload.pull_request
      ? {
        draft: payload.pull_request.draft ?? false,
        id: payload.pull_request.id,
        number: payload.pull_request.number,
        state: payload.pull_request.state,
      }
      : null,
    check_run: payload.check_run
      ? {
        conclusion: payload.check_run.conclusion ?? null,
        id: payload.check_run.id,
        status: payload.check_run.status,
      }
      : null,
    check_suite: payload.check_suite
      ? {
        conclusion: payload.check_suite.conclusion ?? null,
        id: payload.check_suite.id,
        status: payload.check_suite.status,
      }
      : null,
    workflow_run: payload.workflow_run
      ? {
        conclusion: payload.workflow_run.conclusion ?? null,
        id: payload.workflow_run.id,
        status: payload.workflow_run.status,
      }
      : null,
    sender: payload.sender ? { id: payload.sender.id, login: payload.sender.login } : null,
  };
}

export async function POST(request: Request) {
  try {
    const configuration = getGitHubAppConfiguration();
    const rawBody = await readBoundedWebhookBody(request);
    if (!verifyGitHubWebhookSignature(
      rawBody,
      request.headers.get("x-hub-signature-256"),
      configuration.webhookSecret,
    )) {
      return jsonNoStore(
        { error: { code: "invalid_webhook_signature", message: "GitHub webhook signature is invalid." } },
        { status: 401 },
      );
    }

    const deliveryId = request.headers.get("x-github-delivery") ?? "";
    const eventName = request.headers.get("x-github-event") ?? "";
    if (!deliveryPattern.test(deliveryId) || !eventPattern.test(eventName)) {
      return jsonNoStore(
        { error: { code: "invalid_webhook_headers", message: "GitHub webhook headers are invalid." } },
        { status: 400 },
      );
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody)) as unknown;
    } catch {
      return jsonNoStore(
        { error: { code: "invalid_webhook_payload", message: "GitHub webhook payload is invalid." } },
        { status: 400 },
      );
    }
    const acceptedEvent = isAcceptedEventName(eventName);
    const parsed = acceptedEvent
      ? acceptedWebhookSchemas[eventName].safeParse(decoded)
      : ignoredWebhookSchema.safeParse(decoded);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_webhook_payload", message: "GitHub webhook payload is invalid." } },
        { status: 400 },
      );
    }
    const webhookPayload: WebhookPayload = acceptedEvent ? parsed.data : {};

    const serviceClient = createSupabaseGitHubWebhookClient();
    const externalInstallationId = webhookPayload.installation?.id ?? null;
    let installation: {
      connection_id: string;
      id: string;
      organization_id: string;
      status: string;
    } | null = null;
    if (externalInstallationId) {
      const lookup = await serviceClient
        .from("github_installations")
        .select("id,organization_id,connection_id,status")
        .eq("external_installation_id", externalInstallationId)
        .maybeSingle();
      if (lookup.error) throw lookup.error;
      installation = lookup.data;
    }

    const status = !acceptedEvent
      ? "ignored"
      : !installation
        ? "ignored"
        : installation.status === "deleted"
          ? "ignored"
        : "accepted";
    const payload = redactedPayload(webhookPayload);
    const payloadHash = sha256Hex(rawBody);
    const insertResult = await serviceClient
      .from("github_webhook_deliveries")
      .insert({
        action: webhookPayload.action ?? null,
        connection_id: installation?.connection_id ?? null,
        event_name: eventName,
        external_delivery_id: deliveryId,
        external_installation_id: externalInstallationId,
        external_repository_id: webhookPayload.repository?.id ?? null,
        installation_id: installation?.id ?? null,
        metadata: {
          accepted_event: acceptedEvent,
          known_installation: Boolean(installation),
          terminal_installation: installation?.status === "deleted",
        },
        organization_id: installation?.organization_id ?? null,
        payload,
        payload_sha256: payloadHash,
        processed_at: status === "ignored" ? new Date().toISOString() : null,
        status,
      })
      .select("id,status")
      .single();

    if (insertResult.error?.code === "23505") {
      const replay = await serviceClient
        .from("github_webhook_deliveries")
        .select("id,payload_sha256,status")
        .eq("external_delivery_id", deliveryId)
        .maybeSingle();
      if (replay.error) throw replay.error;
      if (!replay.data || replay.data.payload_sha256 !== payloadHash) {
        return jsonNoStore(
          { error: { code: "webhook_delivery_conflict", message: "The delivery id was already used for a different payload." } },
          { status: 409 },
        );
      }
      if (replay.data.status === "accepted") {
        if (
          eventName === "installation_repositories"
          && installation
          && installation.status !== "deleted"
          && payload.added_repositories.length
        ) {
          const reconciliation = await serviceClient.rpc("reconcile_github_repository_grants", {
            p_installation_id: installation.id,
            p_organization_id: installation.organization_id,
            p_repositories: payload.added_repositories,
          });
          if (reconciliation.error) throw reconciliation.error;
        }
        const retry = await serviceClient.rpc("process_github_webhook_delivery", {
          p_delivery_id: replay.data.id,
        });
        if (retry.error) throw retry.error;
      }
      return jsonNoStore({
        accepted: ["accepted", "processed"].includes(replay.data.status),
        deliveryId,
        duplicate: true,
        processed: ["accepted", "processed"].includes(replay.data.status),
        queued: false,
      });
    }
    if (insertResult.error) throw insertResult.error;

    if (status === "accepted" && insertResult.data?.id) {
      if (
        eventName === "installation_repositories"
        && installation
        && installation.status !== "deleted"
        && payload.added_repositories.length
      ) {
        const reconciliation = await serviceClient.rpc("reconcile_github_repository_grants", {
          p_installation_id: installation.id,
          p_organization_id: installation.organization_id,
          p_repositories: payload.added_repositories,
        });
        if (reconciliation.error) throw reconciliation.error;
      }
      const processResult = await serviceClient.rpc("process_github_webhook_delivery", {
        p_delivery_id: insertResult.data.id,
      });
      if (processResult.error) throw processResult.error;
    }

    return jsonNoStore(
      {
        accepted: status === "accepted",
        deliveryId,
        duplicate: false,
        processed: status === "accepted",
        queued: false,
      },
      { status: 202 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "webhook_payload_too_large") {
      return jsonNoStore(
        { error: { code: "webhook_payload_too_large", message: "GitHub webhook payload is too large." } },
        { status: 413 },
      );
    }
    if (message === "webhook_body_missing") {
      return jsonNoStore(
        { error: { code: "webhook_body_missing", message: "GitHub webhook body is required." } },
        { status: 400 },
      );
    }
    return githubRouteErrorResponse(error);
  }
}
