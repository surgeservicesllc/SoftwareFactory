// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GitHubAuthorizationError } from "@/lib/github/access";
import { GitHubApiError } from "@/lib/github/client";
import { githubRouteErrorResponse } from "@/lib/github/errors";
import { isClientSafeDatabaseErrorCode } from "@/lib/server/http";

type ErrorBody = { error: { code: string; message: string } };

async function respond(error: unknown) {
  const response = githubRouteErrorResponse(error);
  return { body: (await response.json()) as ErrorBody, status: response.status };
}

/**
 * A PostgREST failure is a plain object, not an Error instance. These are the
 * exact shapes the GitHub lifecycle RPCs raise.
 */
function postgrestError(code: string, message: string) {
  return { code, details: null, hint: null, message };
}

describe("GitHub lifecycle error reporting", () => {
  it("explains a stale disconnect instead of reporting a generic failure", async () => {
    const { body, status } = await respond(
      postgrestError("40001", "GitHub installation changed; reload before disconnecting"),
    );

    expect(status).toBe(409);
    expect(body.error.code).toBe("40001");
    expect(body.error.message).toBe(
      "GitHub installation changed; reload before disconnecting",
    );
  });

  it("explains that a deleted installation id is terminal when a resync is attempted", async () => {
    const { body, status } = await respond(
      postgrestError(
        "55000",
        "deleted GitHub installation ids are terminal; use a new provider installation",
      ),
    );

    expect(status).toBe(409);
    expect(body.error.message).toContain("terminal");
  });

  it("refuses a cross-tenant installation binding with an authorization status", async () => {
    const { body, status } = await respond(
      postgrestError("42501", "GitHub installation is already bound to another organization"),
    );

    expect(status).toBe(403);
    expect(body.error.message).toBe(
      "GitHub installation is already bound to another organization",
    );
  });

  it("reports a missing GitHub connection as not found", async () => {
    const { status } = await respond(postgrestError("P0002", "GitHub connection was not found"));

    expect(status).toBe(404);
  });

  it("reports a rejected change target as a validation failure", async () => {
    const { body, status } = await respond(
      postgrestError(
        "23514",
        "GitHub change request target is not an active linked repository",
      ),
    );

    expect(status).toBe(400);
    expect(body.error.message).toContain("not an active linked repository");
  });

  it("keeps an unrecognized database fault opaque", async () => {
    const { body, status } = await respond(
      postgrestError("42P01", 'relation "public.github_installations" does not exist'),
    );

    expect(status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(body.error.message).toBe("The GitHub request failed safely.");
  });

  it("does not treat an arbitrary thrown object as a database refusal", async () => {
    const { status: missingMessage } = await respond({ code: "42501" });
    const { status: nonStringCode } = await respond({ code: 42501, message: "denied" });
    const { status: nullError } = await respond(null);

    expect(missingMessage).toBe(500);
    expect(nonStringCode).toBe(500);
    expect(nullError).toBe(500);
  });

  it("still prefers the application error classes over database mapping", async () => {
    const authorization = await respond(
      new GitHubAuthorizationError(503, "github_not_connected", "This GitHub installation is Not Connected."),
    );
    const provider = await respond(
      new GitHubApiError(403, "github_permission_denied", "GitHub denied the request."),
    );

    expect(authorization.status).toBe(503);
    expect(authorization.body.error.code).toBe("github_not_connected");
    expect(provider.status).toBe(403);
    expect(provider.body.error.code).toBe("github_permission_denied");
  });

  it("shares one client-safe code table with the control-plane routes", () => {
    for (const code of ["22023", "23502", "23514", "42501", "40001", "55000", "P0002"]) {
      expect(isClientSafeDatabaseErrorCode(code)).toBe(true);
    }
    for (const code of ["42P01", "23505", "constructor", "toString", ""]) {
      expect(isClientSafeDatabaseErrorCode(code)).toBe(false);
    }
  });
});
