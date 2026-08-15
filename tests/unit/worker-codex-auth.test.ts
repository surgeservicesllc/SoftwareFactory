import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CodexAuthError, describeCodexAuth, resolveCodexAuth } from "@/lib/worker/auth";
import { codexClientOptions, seedCodexHome } from "@/lib/worker/codex";
import { readWorkerConfiguration } from "@/lib/worker/env";
import type { PreparedWorkspace } from "@/lib/worker/workspace";

/** A subscription auth.json as `codex login` writes it. Values are fabricated. */
const subscriptionJson = JSON.stringify({
  tokens: {
    access_token: "fabricated-access-token-value",
    refresh_token: "fabricated-refresh-token-value",
    id_token: "fabricated-id-token-value",
  },
  last_refresh: "2026-08-14T00:00:00Z",
});

/** What `codex login --api-key` writes instead. This one bills per token. */
const apiKeyJson = JSON.stringify({ OPENAI_API_KEY: "sk-fabricated-key-for-this-test-only" });

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDirectory() {
  const dir = await mkdtemp(path.join(tmpdir(), "codex-auth-test-"));
  temporaryDirectories.push(dir);
  return dir;
}

describe("subscription is the default, and it is zero-token", () => {
  it("resolves subscription mode from the credential alone", () => {
    const auth = resolveCodexAuth({ SOFTWAREFACTORY_CODEX_AUTH_JSON: subscriptionJson });

    expect(auth.mode).toBe("subscription");
    expect(auth.zeroToken).toBe(true);
    expect(auth.apiKey).toBeNull();
    expect(auth.authJson).toBe(subscriptionJson);
  });

  it("says so in a description safe to log", () => {
    const description = describeCodexAuth(
      resolveCodexAuth({ SOFTWAREFACTORY_CODEX_AUTH_JSON: subscriptionJson }),
    );

    expect(description).toMatch(/no per-token api billing/i);
    expect(description).not.toContain("fabricated-access-token-value");
  });
});

describe("the billed path can never be reached by accident", () => {
  it("fails closed when no credential is configured, rather than falling back", () => {
    expect(() => resolveCodexAuth({})).toThrowError(
      expect.objectContaining({ code: "SUBSCRIPTION_CREDENTIAL_MISSING" }),
    );
  });

  it("refuses a stray API key that was never opted into", () => {
    // A key left over from an earlier setup must not quietly resume spending.
    expect(() => resolveCodexAuth({
      SOFTWAREFACTORY_CODEX_AUTH_JSON: subscriptionJson,
      OPENAI_API_KEY: "sk-left-over-from-before",
    })).toThrowError(expect.objectContaining({ code: "API_KEY_MODE_NOT_ENABLED" }));
  });

  it("requires the billed mode to name itself", () => {
    const auth = resolveCodexAuth({
      SOFTWAREFACTORY_CODEX_AUTH_MODE: "api_key",
      OPENAI_API_KEY: "sk-deliberately-selected",
    });

    expect(auth.mode).toBe("api_key");
    expect(auth.zeroToken).toBe(false);
  });

  it("rejects an unknown mode instead of guessing", () => {
    expect(() => resolveCodexAuth({ SOFTWAREFACTORY_CODEX_AUTH_MODE: "free" })).toThrowError(
      expect.objectContaining({ code: "UNKNOWN_AUTH_MODE" }),
    );
  });

  it("reports a named failure with actionable guidance", () => {
    try {
      resolveCodexAuth({});
      expect.unreachable("resolution should have failed");
    } catch (error) {
      expect(error).toBeInstanceOf(CodexAuthError);
      expect((error as CodexAuthError).message).toMatch(/codex login/);
    }
  });
});

describe("subscription material is inspected, not trusted", () => {
  it("rejects an api-key auth.json pasted into the subscription secret", () => {
    // This is the case that would otherwise bill silently: the mode says
    // subscription, the file says otherwise, and the CLI would obey the file.
    expect(() => resolveCodexAuth({ SOFTWAREFACTORY_CODEX_AUTH_JSON: apiKeyJson })).toThrowError(
      expect.objectContaining({ code: "SUBSCRIPTION_CREDENTIAL_IS_API_KEY" }),
    );
  });

  it("rejects an api key nested inside the tokens object", () => {
    const nested = JSON.stringify({ tokens: { OPENAI_API_KEY: "sk-hidden-one-level-down" } });

    expect(() => resolveCodexAuth({ SOFTWAREFACTORY_CODEX_AUTH_JSON: nested })).toThrowError(
      expect.objectContaining({ code: "SUBSCRIPTION_CREDENTIAL_IS_API_KEY" }),
    );
  });

  it("explains why an api-key file is refused", () => {
    try {
      resolveCodexAuth({ SOFTWAREFACTORY_CODEX_AUTH_JSON: apiKeyJson });
      expect.unreachable("resolution should have failed");
    } catch (error) {
      expect((error as CodexAuthError).message).toMatch(/bills per token/i);
    }
  });

  it.each([
    ["not json at all", "SUBSCRIPTION_CREDENTIAL_MALFORMED"],
    ["[]", "SUBSCRIPTION_CREDENTIAL_MALFORMED"],
    ["{}", "SUBSCRIPTION_CREDENTIAL_HAS_NO_TOKENS"],
    ['{"tokens":{}}', "SUBSCRIPTION_CREDENTIAL_HAS_NO_TOKENS"],
    ['{"tokens":{"access_token":"   "}}', "SUBSCRIPTION_CREDENTIAL_HAS_NO_TOKENS"],
  ])("rejects %s", (raw, code) => {
    expect(() => resolveCodexAuth({ SOFTWAREFACTORY_CODEX_AUTH_JSON: raw })).toThrowError(
      expect.objectContaining({ code }),
    );
  });
});

describe("the SDK is given no api key in subscription mode", () => {
  const workspace = {
    directory: "/tmp/run/repo",
    runDirectory: "/tmp/run",
    branch: "factory/test",
  } as unknown as PreparedWorkspace;

  it("omits apiKey entirely rather than passing an empty one", () => {
    const options = codexClientOptions(
      resolveCodexAuth({ SOFTWAREFACTORY_CODEX_AUTH_JSON: subscriptionJson }),
      workspace,
      { PATH: "/safe/bin" },
    );

    // Present-but-empty would be a different failure; absent is what makes the
    // CLI fall back to the seeded auth.json.
    expect("apiKey" in options).toBe(false);
    expect(JSON.stringify(options)).not.toContain("fabricated-access-token-value");
  });

  it("still passes the key when the billed mode was chosen", () => {
    const options = codexClientOptions(
      resolveCodexAuth({
        SOFTWAREFACTORY_CODEX_AUTH_MODE: "api_key",
        OPENAI_API_KEY: "sk-deliberately-selected",
      }),
      workspace,
      { PATH: "/safe/bin" },
    );

    expect(options.apiKey).toBe("sk-deliberately-selected");
  });

  it("keeps CODEX_HOME inside the run directory in both modes", () => {
    for (const environment of [
      { SOFTWAREFACTORY_CODEX_AUTH_JSON: subscriptionJson },
      { SOFTWAREFACTORY_CODEX_AUTH_MODE: "api_key", OPENAI_API_KEY: "sk-deliberately-selected" },
    ]) {
      const options = codexClientOptions(resolveCodexAuth(environment), workspace, { PATH: "/x" });
      expect(options.env?.CODEX_HOME).toBe(path.join("/tmp/run", "codex-home"));
    }
  });
});

describe("seeding the per-run CODEX_HOME", () => {
  it("writes auth.json where the CLI will look", async () => {
    const root = await temporaryDirectory();
    const codexHome = path.join(root, "codex-home");

    await seedCodexHome(codexHome, subscriptionJson);

    expect(await readFile(path.join(codexHome, "auth.json"), "utf8")).toBe(subscriptionJson);
  });

  it("writes it owner-only", async () => {
    const root = await temporaryDirectory();
    const codexHome = path.join(root, "codex-home");

    await seedCodexHome(codexHome, subscriptionJson);
    const mode = (await stat(path.join(codexHome, "auth.json"))).mode & 0o777;

    expect(mode).toBe(0o600);
  });

  it("creates the directory when it does not exist yet", async () => {
    const root = await temporaryDirectory();
    const nested = path.join(root, "deep", "codex-home");

    await expect(seedCodexHome(nested, subscriptionJson)).resolves.toBeUndefined();
  });
});

describe("worker configuration no longer requires a paid key", () => {
  const base = {
    SOFTWAREFACTORY_WORKER_ENABLED: "true",
    SOFTWAREFACTORY_WORKER_RUNTIME: "docker",
    SOFTWAREFACTORY_WORKER_ID: "worker-under-test",
    SOFTWAREFACTORY_CODEX_MODEL: "gpt-5.3-codex",
    SOFTWAREFACTORY_REQUIRED_CHECKS: "Lint, typecheck, test, and build",
    SOFTWAREFACTORY_WORK_ROOT: path.join(tmpdir(), "worker-config-test"),
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_fabricated_value_for_test",
    GITHUB_COMMIT_IDENTITY_NAME: "surgeservicesllc",
    GITHUB_COMMIT_IDENTITY_EMAIL: "owner@example.com",
  };

  it("starts with a subscription credential and no OPENAI_API_KEY", () => {
    const configuration = readWorkerConfiguration({
      ...base,
      SOFTWAREFACTORY_CODEX_AUTH_JSON: subscriptionJson,
    });

    expect(configuration.codexAuth.zeroToken).toBe(true);
    expect(configuration.codexAuth.apiKey).toBeNull();
  });

  it("refuses to start with no Codex credential at all", () => {
    expect(() => readWorkerConfiguration(base)).toThrowError(
      expect.objectContaining({ code: "SUBSCRIPTION_CREDENTIAL_MISSING" }),
    );
  });
});
