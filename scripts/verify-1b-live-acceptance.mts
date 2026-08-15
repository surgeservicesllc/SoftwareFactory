/**
 * Close Phase 1B items 2 and 20 in one command, once the owner has acted.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   [SOFTWAREFACTORY_FIRST_OWNER_JWT=...] \
 *   npx tsx scripts/verify-1b-live-acceptance.mts --installation <external-id>
 *
 * The two things this cannot do are exactly the two things it is waiting for:
 * installing the App on a second, independent account, and performing the
 * adverse-event pass on it. Those are GitHub console actions. Everything that
 * happens *after* them — reading what the factory recorded and deciding whether
 * it constitutes proof — is here, so closing these items is a command rather
 * than a fresh judgement at the end of a long session.
 *
 * Two deliberate properties:
 *
 *   Nothing is inferred. A check with no observation reports NOT_OBSERVED, and
 *   the verdict distinguishes that from FAIL. The cross-tenant probes need a
 *   first-tenant session to be meaningful — service-role bypasses RLS, so
 *   running them as service-role would prove nothing while looking green — so
 *   without `SOFTWAREFACTORY_FIRST_OWNER_JWT` they stay unobserved rather than
 *   passing on evidence that does not exist.
 *
 *   It refuses to run against the primary or candidate installation. The
 *   completion document warns about this in prose; `PROTECTED_INSTALLATION_IDS`
 *   makes it a control, because the pass ends in a deliberate uninstall.
 */

import { createClient } from "@supabase/supabase-js";

import {
  ADVERSE_SEQUENCE,
  PROTECTED_INSTALLATION_IDS,
  evaluateLiveAcceptance,
  formatVerdict,
  summarize,
  type ActivityProbe,
  type AdverseStep,
  type CrossTenantProbe,
  type InstallationObservation,
  type LiveAcceptanceObservations,
  type RepositoryObservation,
} from "@/lib/github/live-acceptance";

const PRIMARY_INSTALLATION = 153445938;

function argument(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}.`);
    process.exit(2);
  }
  return value;
}

type Row = Record<string, unknown>;

function installationFrom(row: Row | null): InstallationObservation | null {
  if (!row) return null;
  return {
    accountLogin: String(row.account_login ?? ""),
    connectionId: String(row.connection_id ?? ""),
    externalInstallationId: Number(row.external_installation_id ?? 0),
    organizationId: String(row.organization_id ?? ""),
    status: String(row.status ?? ""),
    suspendedAt: typeof row.suspended_at === "string" ? row.suspended_at : null,
  };
}

/**
 * Map recorded webhook deliveries onto the five actions the pass performs.
 *
 * Keyed on event and action rather than on arrival order: deliveries can arrive
 * out of order, and ordering them by receipt would report a sequence the owner
 * did not perform.
 */
function adverseStepsFrom(
  deliveries: readonly Row[],
  installationStates: ReadonlyMap<string, string>,
  writeRefusals: ReadonlyMap<string, boolean>,
): readonly AdverseStep[] | null {
  if (deliveries.length === 0) return null;

  const matcher: Record<AdverseStep["action"], (row: Row) => boolean> = {
    installation_suspended: (row) => row.event_name === "installation" && row.action === "suspend",
    installation_uninstalled: (row) => row.event_name === "installation" && row.action === "deleted",
    installation_unsuspended: (row) => row.event_name === "installation" && row.action === "unsuspend",
    repository_readded: (row) =>
      row.event_name === "installation_repositories" && row.action === "added",
    repository_removed: (row) =>
      row.event_name === "installation_repositories" && row.action === "removed",
  };

  const steps: AdverseStep[] = [];
  for (const action of ADVERSE_SEQUENCE) {
    const delivery = deliveries.find((row) => matcher[action](row));
    if (!delivery) continue;
    steps.push({
      action,
      deliveryProcessed: String(delivery.status ?? "") === "processed",
      deliveryRecorded: true,
      installationStatus: installationStates.get(action) ?? "unknown",
      writeRefused: writeRefusals.has(action) ? writeRefusals.get(action)! : null,
    });
  }
  return steps.length === 0 ? null : steps;
}

async function main() {
  const installationArgument = argument("installation");
  if (!installationArgument || !/^\d+$/.test(installationArgument)) {
    console.error("Pass --installation <external-installation-id>.");
    process.exit(2);
  }
  const externalId = Number(installationArgument);

  if (PROTECTED_INSTALLATION_IDS.includes(externalId)) {
    console.error(
      `Refusing: ${externalId} is the rollback boundary or the verified production path.\n`
      + "This pass ends in a deliberate uninstall. Use a throwaway account.",
    );
    process.exit(3);
  }

  const client = createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  const { data: installations, error: installationError } = await client
    .from("github_installations")
    .select("organization_id,connection_id,external_installation_id,account_login,status,suspended_at")
    .in("external_installation_id", [externalId, PRIMARY_INSTALLATION]);
  if (installationError) {
    console.error(`Could not read installations: ${installationError.message}`);
    process.exit(1);
  }

  const rows = (installations ?? []) as Row[];
  const second = installationFrom(
    rows.find((row) => Number(row.external_installation_id) === externalId) ?? null,
  );
  const primary = installationFrom(
    rows.find((row) => Number(row.external_installation_id) === PRIMARY_INSTALLATION) ?? null,
  );

  let repositories: readonly RepositoryObservation[] | null = null;
  if (second) {
    const { data } = await client
      .from("github_repositories")
      .select("full_name,installation_id,selected")
      .eq("organization_id", second.organizationId);
    repositories = ((data ?? []) as Row[]).map((row) => ({
      fullName: String(row.full_name ?? ""),
      installationId: second.connectionId,
      selected: row.selected === true,
    }));
  }

  const { data: deliveryRows } = await client
    .from("github_webhook_deliveries")
    .select("event_name,action,status,received_at")
    .eq("external_installation_id", externalId)
    .order("received_at", { ascending: true });

  // Installation state after each action, and whether a write was refused, are
  // both recorded by the app as it processes the deliveries. Absent rows leave
  // the corresponding checks unobserved rather than guessed.
  const installationStates = new Map<string, string>();
  if (second) installationStates.set("installation_uninstalled", second.status);

  const adverseSteps = adverseStepsFrom(
    (deliveryRows ?? []) as Row[],
    installationStates,
    new Map<string, boolean>(),
  );

  let activity: readonly ActivityProbe[] | null = null;
  if (second && primary) {
    const probes: ActivityProbe[] = [];
    for (const organizationId of [primary.organizationId, second.organizationId]) {
      const { data } = await client
        .from("activity_events")
        .select("organization_id")
        .eq("organization_id", organizationId)
        .limit(200);
      probes.push({
        organizationId,
        organizationIdsInFeed: [
          ...new Set(((data ?? []) as Row[]).map((row) => String(row.organization_id))),
        ],
      });
    }
    activity = probes;
  }

  // Cross-tenant containment is an RLS property, and service-role bypasses RLS.
  // Probing it with this client would return zero rows for reasons that have
  // nothing to do with the guarantee, so it is left unobserved unless a real
  // first-tenant session is supplied.
  let crossTenant: CrossTenantProbe | null = null;
  const firstOwnerJwt = process.env.SOFTWAREFACTORY_FIRST_OWNER_JWT;

  const { data: secondProjects } = second
    ? await client.from("projects").select("id").eq("organization_id", second.organizationId).limit(1)
    : { data: null };
  const { data: secondRepositoryRows } = second
    ? await client
        .from("github_repositories")
        .select("id")
        .eq("organization_id", second.organizationId)
        .limit(1)
    : { data: null };
  const secondProjectId = ((secondProjects ?? []) as Row[])[0]?.id as string | undefined;
  const secondRepositoryId = ((secondRepositoryRows ?? []) as Row[])[0]?.id as string | undefined;

  if (firstOwnerJwt && second && secondProjectId && secondRepositoryId) {
    const scoped = createClient(required("SUPABASE_URL"), firstOwnerJwt, {
      auth: { persistSession: false },
    });
    const { data: visibleInstallations } = await scoped
      .from("github_installations")
      .select("id")
      .eq("external_installation_id", externalId);
    const { data: visibleRepositories } = await scoped
      .from("github_repositories")
      .select("id")
      .eq("organization_id", second.organizationId);
    // The real write boundary, with its real signature. An earlier draft
    // invented `reserve_github_change(p_installation_id)`; the RPC contract
    // test refused it, which is the whole reason that test parses call sites
    // rather than trusting them. Every argument is deliberately valid-shaped so
    // the refusal that follows is the tenancy check, not an argument check.
    const { error: writeError } = await scoped.rpc("reserve_github_change_request", {
      p_base_branch: "main",
      p_commit_message: "Cross-tenant containment probe. This must be refused.",
      p_connection_id: second.connectionId,
      p_content_sha256: "0".repeat(64),
      p_execution_nonce: crypto.randomUUID(),
      p_expected_blob_sha: null,
      p_idempotency_key: `phase1b-containment-${externalId}`,
      p_organization_id: second.organizationId,
      p_path: "docs/containment-probe.md",
      p_project_id: secondProjectId,
      p_repository_id: secondRepositoryId,
      p_title: "Cross-tenant containment probe",
    });
    crossTenant = {
      visibleInstallationRows: (visibleInstallations ?? []).length,
      visibleRepositoryRows: (visibleRepositories ?? []).length,
      writeAttempt: {
        refused: Boolean(writeError),
        sqlState: (writeError as { code?: string } | null)?.code ?? null,
      },
    };
  }

  const observations: LiveAcceptanceObservations = {
    activity,
    adverseSteps,
    crossTenant,
    primaryInstallation: primary,
    resync: null,
    secondInstallation: second,
    secondRepositories: repositories,
  };

  const verdict = summarize(evaluateLiveAcceptance(observations));
  console.log(formatVerdict(verdict));

  if (!firstOwnerJwt) {
    console.log(
      "\nNote: SOFTWAREFACTORY_FIRST_OWNER_JWT was not set, so the two cross-tenant\n"
      + "checks are unobserved. Service-role bypasses RLS, so running them with it\n"
      + "would report a containment guarantee this command did not actually test.",
    );
  }

  process.exit(verdict.closesPhase1b ? 0 : 1);
}

await main();
