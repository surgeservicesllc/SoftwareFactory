import { createSupabaseAnonClient } from "@/lib/supabase/anon";
import { jsonNoStore } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VercelIdentity = Readonly<{
  deploymentId: string;
  deploymentUrl: string;
  projectId: string;
}>;

function configuredSupabaseProjectRef(): string | null {
  const expected = process.env.SOFTWAREFACTORY_EXPECTED_SUPABASE_PROJECT_REF?.trim().toLowerCase();
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!expected || !/^[a-z0-9]{20}$/.test(expected) || !rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    const match = /^([a-z0-9]{20})\.supabase\.co$/i.exec(url.hostname);
    if (
      url.protocol !== "https:"
      || url.username !== ""
      || url.password !== ""
      || url.port !== ""
      || url.pathname !== "/"
      || url.search !== ""
      || url.hash !== ""
      || match?.[1]?.toLowerCase() !== expected
    ) {
      return null;
    }
    return expected;
  } catch {
    return null;
  }
}

function configuredVercelIdentity(): VercelIdentity | null {
  const expectedProjectId = process.env.SOFTWAREFACTORY_EXPECTED_VERCEL_PROJECT_ID?.trim();
  const projectId = process.env.VERCEL_PROJECT_ID?.trim();
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID?.trim();
  const deploymentHost = process.env.VERCEL_URL?.trim().toLowerCase();
  if (
    !expectedProjectId
    || !/^prj_[A-Za-z0-9]+$/.test(expectedProjectId)
    || projectId !== expectedProjectId
    || !deploymentId
    || !/^dpl_[A-Za-z0-9]+$/.test(deploymentId)
    || !deploymentHost
    || !/^softwarefactory-[a-z0-9]+-surgeservices-projects\.vercel\.app$/.test(deploymentHost)
    || process.env.VERCEL_TARGET_ENV !== "production"
  ) {
    return null;
  }
  return {
    deploymentId,
    deploymentUrl: `https://${deploymentHost}`,
    projectId,
  };
}

function requestMatchesProductionHost(request: Request): boolean {
  const expectedHost = process.env.SOFTWAREFACTORY_EXPECTED_PRODUCTION_HOST?.trim().toLowerCase();
  if (!expectedHost || !/^[a-z0-9.-]+$/.test(expectedHost)) return false;
  try {
    const url = new URL(request.url);
    return url.protocol === "https:"
      && url.hostname.toLowerCase() === expectedHost
      && url.port === ""
      && url.username === ""
      && url.password === ""
      && url.pathname === "/api/health"
      && url.search === ""
      && url.hash === "";
  } catch {
    return false;
  }
}

/**
 * Public, read-only production readiness probe.
 *
 * Vercel's immutable deployment URL can be protected even while the public
 * production alias is healthy. The lifecycle monitor therefore probes the
 * public alias and uses this response to bind that alias back to the exact
 * Git commit Vercel built. A tiny anonymous Supabase read proves the deployed
 * server can reach the database without exposing tenant data or credentials.
 */
export async function GET(request: Request) {
  const rawReleaseSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase() ?? "";
  const releaseSha = /^[0-9a-f]{40}$/.test(rawReleaseSha) ? rawReleaseSha : null;
  const releaseRef = process.env.VERCEL_GIT_COMMIT_REF?.trim() ?? null;
  const databaseProjectRef = configuredSupabaseProjectRef();
  const vercel = configuredVercelIdentity();
  const productionHostMatched = requestMatchesProductionHost(request);

  if (!releaseSha || releaseRef !== "main") {
    return jsonNoStore({
      status: "degraded",
      service: "SoftwareFactory",
      database: databaseProjectRef ? "not_checked" : "identity_mismatch",
      databaseProject: databaseProjectRef ? "matched" : "mismatched",
      databaseProjectRef,
      deployment: vercel && productionHostMatched ? "matched" : "identity_mismatch",
      deploymentUrl: vercel?.deploymentUrl ?? null,
      vercelDeploymentId: vercel?.deploymentId ?? null,
      vercelProjectId: vercel?.projectId ?? null,
      release: "identity_mismatch",
      releaseSha,
      releaseRef,
    }, { status: 503 });
  }

  if (!vercel || !productionHostMatched) {
    return jsonNoStore({
      status: "degraded",
      service: "SoftwareFactory",
      database: databaseProjectRef ? "not_checked" : "identity_mismatch",
      databaseProject: databaseProjectRef ? "matched" : "mismatched",
      databaseProjectRef,
      deployment: "identity_mismatch",
      deploymentUrl: vercel?.deploymentUrl ?? null,
      vercelDeploymentId: vercel?.deploymentId ?? null,
      vercelProjectId: vercel?.projectId ?? null,
      release: "matched",
      releaseSha,
      releaseRef,
    }, { status: 503 });
  }

  if (!databaseProjectRef) {
    return jsonNoStore({
      status: "degraded",
      service: "SoftwareFactory",
      database: "identity_mismatch",
      databaseProject: "mismatched",
      databaseProjectRef: null,
      deployment: "matched",
      deploymentUrl: vercel.deploymentUrl,
      vercelDeploymentId: vercel.deploymentId,
      vercelProjectId: vercel.projectId,
      release: "matched",
      releaseSha,
      releaseRef,
    }, { status: 503 });
  }

  try {
    const client = createSupabaseAnonClient();
    const read = await client
      .from("marketing_pages")
      .select("slug")
      .limit(1);

    if (read.error) {
      return jsonNoStore({
        status: "degraded",
        service: "SoftwareFactory",
        database: "unreachable",
        databaseProject: "matched",
        databaseProjectRef,
        deployment: "matched",
        deploymentUrl: vercel.deploymentUrl,
        vercelDeploymentId: vercel.deploymentId,
        vercelProjectId: vercel.projectId,
        release: "matched",
        releaseSha,
        releaseRef,
      }, { status: 503 });
    }

    return jsonNoStore({
      status: "ok",
      service: "SoftwareFactory",
      database: "reachable",
      databaseProject: "matched",
      databaseProjectRef,
      deployment: "matched",
      deploymentUrl: vercel.deploymentUrl,
      vercelDeploymentId: vercel.deploymentId,
      vercelProjectId: vercel.projectId,
      release: "matched",
      releaseSha,
      releaseRef,
    });
  } catch {
    return jsonNoStore({
      status: "degraded",
      service: "SoftwareFactory",
      database: "unreachable",
      databaseProject: "matched",
      databaseProjectRef,
      deployment: "matched",
      deploymentUrl: vercel.deploymentUrl,
      vercelDeploymentId: vercel.deploymentId,
      vercelProjectId: vercel.projectId,
      release: "matched",
      releaseSha,
      releaseRef,
    }, { status: 503 });
  }
}
