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
const webhookSchema = z.object({
  action: z.string().max(63).optional(),
  installation: z.object({ id: z.number().int().positive() }).optional(),
  repository: z.object({
    archived: z.boolean().optional(),
    default_branch: z.string().max(255).optional(),
    disabled: z.boolean().optional(),
    id: z.number().int().positive(),
    full_name: z.string().max(201),
    name: z.string().max(100).optional(),
    owner: z.object({ login: z.string().max(100) }).optional(),
    visibility: z.enum(["public", "private", "internal"]).optional(),
  }).optional(),
  repositories_added: z.array(z.object({ id: z.number().int().positive() })).max(500).optional(),
  repositories_removed: z.array(z.object({ id: z.number().int().positive() })).max(500).optional(),
  ref: z.string().max(512).optional(),
  after: z.string().regex(/^[0-9a-f]{40,64}$/).optional(),
  state: z.enum(["error", "failure", "pending", "success"]).optional(),
  sha: z.string().regex(/^[0-9a-f]{40,64}$/).optional(),
  pull_request: z.object({
    id: z.number().int().positive(),
    number: z.number().int().positive(),
    state: z.string().max(32),
    draft: z.boolean().optional(),
    html_url: z.string().url(),
  }).optional(),
  check_run: z.object({
    id: z.number().int().positive(),
    status: z.string().max(32),
    conclusion: z.string().max(64).nullable().optional(),
  }).optional(),
  check_suite: z.object({
    id: z.number().int().positive(),
    status: z.string().max(32),
    conclusion: z.string().max(64).nullable().optional(),
  }).optional(),
  workflow_run: z.object({
    id: z.number().int().positive(),
    status: z.string().max(32),
    conclusion: z.string().max(64).nullable().optional(),
  }).optional(),
  sender: z.object({ id: z.number().int().positive(), login: z.string().max(100) }).optional(),
}).passthrough();

const acceptedEvents = new Set([
  "check_run",
  "check_suite",
  "installation",
  "installation_repositories",
  "pull_request",
  "push",
  "repository",
  "status",
  "workflow_run",
]);

function redactedPayload(payload: z.infer<typeof webhookSchema>) {
  return {
    action: payload.action ?? null,
    installation_id: payload.installation?.id ?? null,
    repository: payload.repository
      ? {
        archived: payload.repository.archived ?? null,
        default_branch: payload.repository.default_branch ?? null,
        disabled: payload.repository.disabled ?? null,
        full_name: payload.repository.full_name,
        id: payload.repository.id,
        name: payload.repository.name ?? null,
        owner_login: payload.repository.owner?.login ?? null,
        visibility: payload.repository.visibility ?? null,
      }
      : null,
    added_repository_ids: payload.repositories_added?.map((repository) => repository.id) ?? [],
    removed_repository_ids: payload.repositories_removed?.map((repository) => repository.id) ?? [],
    ref: payload.ref ?? null,
    after: payload.after ?? null,
    commit_status: payload.state && payload.sha
      ? { sha: payload.sha, state: payload.state }
      : null,
    pull_request: payload.pull_request ?? null,
    check_run: payload.check_run ?? null,
    check_suite: payload.check_suite ?? null,
    workflow_run: payload.workflow_run ?? null,
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
    const parsed = webhookSchema.safeParse(decoded);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_webhook_payload", message: "GitHub webhook payload is invalid." } },
        { status: 400 },
      );
    }

    const serviceClient = createSupabaseGitHubWebhookClient();
    const externalInstallationId = parsed.data.installation?.id ?? null;
    let installation: {
      connection_id: string;
      id: string;
      organization_id: string;
    } | null = null;
    if (externalInstallationId) {
      const lookup = await serviceClient
        .from("github_installations")
        .select("id,organization_id,connection_id")
        .eq("external_installation_id", externalInstallationId)
        .maybeSingle();
      if (lookup.error) throw lookup.error;
      installation = lookup.data;
    }

    const status = !acceptedEvents.has(eventName)
      ? "ignored"
      : externalInstallationId && !installation
        ? "ignored"
        : "accepted";
    const payload = redactedPayload(parsed.data);
    const insertResult = await serviceClient
      .from("github_webhook_deliveries")
      .insert({
        action: parsed.data.action ?? null,
        connection_id: installation?.connection_id ?? null,
        event_name: eventName,
        external_delivery_id: deliveryId,
        external_installation_id: externalInstallationId,
        external_repository_id: parsed.data.repository?.id ?? null,
        installation_id: installation?.id ?? null,
        metadata: {
          accepted_event: acceptedEvents.has(eventName),
          known_installation: Boolean(installation),
        },
        organization_id: installation?.organization_id ?? null,
        payload,
        payload_sha256: sha256Hex(rawBody),
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
      if (!replay.data || replay.data.payload_sha256 !== sha256Hex(rawBody)) {
        return jsonNoStore(
          { error: { code: "webhook_delivery_conflict", message: "The delivery id was already used for a different payload." } },
          { status: 409 },
        );
      }
      if (replay.data.status === "accepted") {
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
