import { z } from "zod";

import {
  requireGitHubConnection,
  requireGitHubUser,
  requireOrganizationManager,
} from "@/lib/github/access";
import {
  createGitHubInstallationToken,
  fetchGitHubInstallationSnapshot,
  GitHubApiError,
  githubApiRequest,
} from "@/lib/github/client";
import { getGitHubAppConfigurationForAppId } from "@/lib/github/config";
import { githubRouteErrorResponse } from "@/lib/github/errors";
import { persistGitHubInstallationSnapshot } from "@/lib/github/sync";
import { jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

/**
 * Create a new GitHub repository for a connected installation.
 *
 * This is the one route in the GitHub surface that makes something exist on
 * GitHub rather than reading what already does, so three things are true of it
 * that are not true of its neighbours.
 *
 * **It is manager-only and same-origin.** Creating a repository is an
 * externally mutating action, and AGENTS.md defaults those off: there is no
 * automatic path here, only a person who administers the organization pressing
 * a button.
 *
 * **It creates under the installation's own account, never an arbitrary one.**
 * The owner comes from `github_installations.account_login`, not from the
 * request, so a caller cannot aim this at an organization the connection does
 * not cover.
 *
 * **It reports what it could not do rather than implying success.** GitHub
 * offers no way for an installation token to create a repository inside a
 * personal account — `POST /user/repos` is a user-token endpoint and there is
 * no `POST /users/{user}/repos` at all. A User-type installation is refused
 * with the reason and the manual step, because a button that silently does
 * nothing is worse than one that says why.
 */

/*
 * GitHub's own rule, restated so a bad name is refused here with an
 * explanation rather than as a 422 from the API: letters, digits, hyphen,
 * underscore and dot, and neither of the two names git itself reserves.
 */
const REPOSITORY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

const requestSchema = z.object({
  connectionId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(350).optional(),
  /*
   * Private by default and stated explicitly rather than defaulted silently:
   * the caller has to say "public" to get a repository the world can read.
   */
  visibility: z.enum(["private", "public"]).default("private"),
}).strict();

type CreatedRepository = {
  id?: unknown;
  name?: unknown;
  full_name?: unknown;
  html_url?: unknown;
  default_branch?: unknown;
  private?: unknown;
};

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = requestSchema.safeParse(await readBoundedJson(request, 8 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_create_repository_request",
            message: "Give a connection, a repository name, and whether it is private or public.",
          },
        },
        { status: 400 },
      );
    }

    const name = parsed.data.name.trim();
    if (!REPOSITORY_NAME.test(name) || name === "." || name === "..") {
      return jsonNoStore(
        {
          error: {
            code: "invalid_repository_name",
            message:
              "A repository name starts with a letter or digit and uses only letters, digits, hyphens, underscores and dots.",
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, supabase, user } = await requireGitHubUser();
    const context = await requireGitHubConnection(
      supabase,
      user.id,
      activeOrganization.id,
      parsed.data.connectionId,
    );
    await requireOrganizationManager(supabase, user.id, context.organizationId);

    // The owner is the installation's own account. Never the caller's word.
    const { data: installation, error: installationError } = await supabase
      .from("github_installations")
      .select("account_login,account_type")
      .eq("id", context.internalInstallationId)
      .maybeSingle();
    if (installationError || !installation) {
      return jsonNoStore(
        {
          error: {
            code: "installation_account_unavailable",
            message: "The connected GitHub account could not be read, so nothing was created.",
          },
        },
        { status: 503 },
      );
    }

    if (installation.account_type !== "Organization") {
      /*
       * Not a gap to fill later — a constraint of GitHub's API. Say the manual
       * step plainly so the person is not left pressing a button that cannot
       * work for their account.
       */
      return jsonNoStore(
        {
          error: {
            code: "github_personal_account_cannot_create",
            message:
              `GitHub does not let an installed app create repositories inside the personal account `
              + `${installation.account_login}. Create it at https://github.com/new, then add it to this `
              + `installation's selected repositories and press Refresh.`,
          },
        },
        { status: 409 },
      );
    }

    const configuration = getGitHubAppConfigurationForAppId(context.appId);
    /*
     * Asking for exactly the permission this route needs and nothing else —
     * which is also where the likeliest real failure surfaces. GitHub refuses
     * to mint a token carrying a permission the App was never granted, and it
     * refuses with a 422 that says nothing a person could act on. Name it here
     * rather than letting "unprocessable" reach the screen.
     */
    let token: Awaited<ReturnType<typeof createGitHubInstallationToken>>;
    try {
      token = await createGitHubInstallationToken(
        configuration,
        context.installationId,
        { permissions: { administration: "write" } },
      );
    } catch (error) {
      if (error instanceof GitHubApiError && (error.status === 422 || error.status === 403)) {
        return jsonNoStore(
          {
            error: {
              code: "github_administration_permission_missing",
              message:
                "The GitHub App cannot create repositories yet. Grant it the "
                + `"Administration" repository permission (write) on ${installation.account_login}, `
                + "approve the updated permissions on GitHub, then try again.",
            },
          },
          { status: 403 },
        );
      }
      throw error;
    }

    let created: CreatedRepository;
    try {
      created = (await githubApiRequest(`/orgs/${installation.account_login}/repos`, {
        body: {
          name,
          description: parsed.data.description || undefined,
          private: parsed.data.visibility === "private",
          auto_init: true,
        },
        method: "POST",
        token: token.token,
      })) as CreatedRepository;
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 403) {
        return jsonNoStore(
          {
            error: {
              code: "github_administration_permission_missing",
              message:
                "The GitHub App is not permitted to create repositories in "
                + `${installation.account_login}. Grant it the "Administration" repository permission `
                + "(write) on GitHub, then try again.",
            },
          },
          { status: 403 },
        );
      }
      if (error instanceof GitHubApiError && error.status === 422) {
        return jsonNoStore(
          {
            error: {
              code: "github_repository_name_taken",
              message: `${installation.account_login}/${name} already exists on GitHub, so nothing was created.`,
            },
          },
          { status: 409 },
        );
      }
      throw error;
    }

    const fullName = typeof created.full_name === "string"
      ? created.full_name
      : `${installation.account_login}/${name}`;

    /*
     * Record it through the same snapshot path every other repository takes,
     * rather than inserting a row by hand — one write path, one shape.
     *
     * A snapshot is also the only honest way to answer the next question. An
     * installation scoped to selected repositories does not gain the new
     * repository automatically, so `selected` below is read back from GitHub
     * rather than assumed, and the caller is told when the repository exists
     * but the factory still cannot see it.
     */
    let selected = false;
    let syncFailed = false;
    try {
      const snapshot = await fetchGitHubInstallationSnapshot(configuration, context.installationId);
      await persistGitHubInstallationSnapshot(
        supabase,
        user.id,
        context.organizationId,
        snapshot,
        context.connectionId,
      );
      selected = snapshot.repositories.some(
        (repository) => repository.fullName.toLowerCase() === fullName.toLowerCase(),
      );
    } catch {
      // The repository exists either way; only our record of it is behind.
      syncFailed = true;
    }

    return jsonNoStore({
      repository: {
        defaultBranch: typeof created.default_branch === "string" ? created.default_branch : "main",
        fullName,
        htmlUrl: typeof created.html_url === "string" ? created.html_url : null,
        id: typeof created.id === "number" ? created.id : null,
        private: created.private === true,
      },
      /*
       * Three states the interface has to tell apart: the factory can use it,
       * it exists but is outside the installation's selection, or it exists and
       * our records are stale.
       */
      selected,
      syncFailed,
      message: syncFailed
        ? `${fullName} was created on GitHub, but its details could not be read back just now. Press Refresh in a moment.`
        : selected
          ? `${fullName} was created and is available to this factory.`
          : `${fullName} was created, but this installation is limited to selected repositories and does not include it yet. Add it on GitHub, then press Refresh.`,
    });
  } catch (error) {
    return githubRouteErrorResponse(error);
  }
}
