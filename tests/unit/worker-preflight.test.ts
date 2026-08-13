import { describe, expect, it, vi } from "vitest";

import { verifyWorkerProviderAccess, WorkerPreflightError } from "@/lib/worker/preflight";

const apiKey = "dedicated-test-api-key-that-must-never-appear";
const model = "gpt-5.3-codex";

function successfulCommand() {
  return vi.fn(async (
    _file: string,
    args: readonly string[],
    options: { env: Readonly<Record<string, string>>; maxBuffer: number; timeout: number },
  ) => {
    void options;
    return { stdout: args.at(-1) === "--version" ? "codex-cli 0.147.0\n" : "" };
  });
}

describe("Phase 1C worker provider preflight", () => {
  it("verifies the pinned CLI and exact OpenAI model without giving secrets to the CLI", async () => {
    const runCommand = successfulCommand();
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ id: model, object: "model" }),
      { status: 200 },
    ));

    await verifyWorkerProviderAccess({
      apiKey,
      model,
      environment: {
        PATH: "/safe/bin",
        OPENAI_API_KEY: apiKey,
        SUPABASE_SERVICE_ROLE_KEY: "database-secret",
        GITHUB_APP_PRIVATE_KEY_BASE64: "github-secret",
      },
      fetcher,
      runCommand,
    });

    expect(runCommand).toHaveBeenCalledTimes(2);
    for (const call of runCommand.mock.calls) {
      const options = call[2] as { env: Record<string, string> };
      expect(options.env).toEqual({ PATH: "/safe/bin" });
      expect(JSON.stringify(options)).not.toContain(apiKey);
      expect(JSON.stringify(options)).not.toContain("database-secret");
      expect(JSON.stringify(options)).not.toContain("github-secret");
    }
    expect(fetcher).toHaveBeenCalledWith(
      `https://api.openai.com/v1/models/${model}`,
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it("can execute one bounded, non-stored response without exposing the key", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: model, object: "model" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "resp_test",
        object: "response",
        status: "completed",
      }), { status: 200 }));

    await verifyWorkerProviderAccess({
      apiKey,
      executeProbe: true,
      fetcher,
      model,
      runCommand: successfulCommand(),
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        body: JSON.stringify({ input: "Return exactly READY.", max_output_tokens: 128, model, store: false }),
        method: "POST",
        redirect: "error",
      }),
    );
    const responseOptions = fetcher.mock.calls[1]?.[1] as RequestInit;
    expect(String(responseOptions.body)).not.toContain(apiKey);
  });

  it("fails closed with a fixed, secret-free error when model access is denied", async () => {
    const result = verifyWorkerProviderAccess({
      apiKey,
      model,
      fetcher: vi.fn(async () => new Response(JSON.stringify({
        error: { code: "insufficient_quota", message: `denied ${apiKey}` },
      }), { status: 429 })),
      runCommand: successfulCommand(),
    });

    await expect(result).rejects.toEqual(expect.objectContaining({
      code: "openai_http_429_insufficient_quota",
      message: "OpenAI model access returned HTTP 429 (insufficient_quota).",
    } satisfies Partial<WorkerPreflightError>));
    await expect(result).rejects.toSatisfy((error: unknown) => !String(error).includes(apiKey));
  });

  it("rejects a CLI or model descriptor that differs from the reviewed release", async () => {
    await expect(verifyWorkerProviderAccess({
      apiKey,
      model,
      fetcher: vi.fn(),
      runCommand: vi.fn(async () => ({ stdout: "codex-cli 0.148.0\n" })),
    })).rejects.toMatchObject({ code: "codex_cli_version_mismatch" });

    await expect(verifyWorkerProviderAccess({
      apiKey,
      model,
      fetcher: vi.fn(async () => new Response(
        JSON.stringify({ id: "different-model", object: "model" }),
        { status: 200 },
      )),
      runCommand: successfulCommand(),
    })).rejects.toMatchObject({ code: "openai_execution_mismatch" });
  });
});
