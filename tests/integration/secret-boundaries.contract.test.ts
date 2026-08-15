// @vitest-environment node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const secretNamePattern =
  /(?:SERVICE_ROLE|PASSWORD|PRIVATE_KEY|SECRET|TOKEN|API_KEY|CREDENTIAL)/i;
const publicNonSecretVariables = new Set(["NEXT_PUBLIC_SUPABASE_ANON_KEY"]);

function readRepositoryFile(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

function sourceFiles(relativeDirectory: string): string[] {
  const directory = resolve(repositoryRoot, relativeDirectory);

  return readdirSync(directory).flatMap((entry) => {
    const absolutePath = resolve(directory, entry);

    if (statSync(absolutePath).isDirectory()) {
      return sourceFiles(`${relativeDirectory}/${entry}`);
    }

    return [".ts", ".tsx"].includes(extname(entry)) ? [absolutePath] : [];
  });
}

describe("secret handling boundaries", () => {
  it("keeps sensitive example environment values empty", () => {
    const assignments = readRepositoryFile(".env.example")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return {
          name: line.slice(0, separator),
          value: line.slice(separator + 1),
        };
      });

    for (const { name, value } of assignments) {
      if (secretNamePattern.test(name) && !publicNonSecretVariables.has(name)) {
        expect(value, `${name} must be an empty placeholder`).toBe("");
      }
    }
  });

  it("documents every environment variable the worker reads", () => {
    // `.env.example` is what an operator copies. A variable the worker requires
    // but the template omits produces a worker that refuses to start, with the
    // reason visible only in a zod error — and nothing in the file to suggest
    // what is missing. Three were missing when this was written:
    // `SOFTWAREFACTORY_CODEX_AUTH_JSON`, which the worker cannot start without,
    // and both halves of the commit identity.
    const source = ["lib/worker/env.ts", "lib/worker/auth.ts"]
      .map((file) => readRepositoryFile(file))
      .join("\n");

    const referenced = new Set(
      source.match(
        /\b(?:SOFTWAREFACTORY_[A-Z0-9_]+|GITHUB_COMMIT_IDENTITY_[A-Z]+|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_URL|OPENAI_API_KEY)\b/g,
      ) ?? [],
    );

    const template = readRepositoryFile(".env.example");
    const undocumented = [...referenced]
      .filter((name) => !new RegExp(`^${name}=`, "m").test(template))
      .sort();

    expect(undocumented).toEqual([]);
    // Guards against the regex silently matching nothing.
    expect(referenced.size).toBeGreaterThan(8);
  });

  it("never gives sensitive variables a NEXT_PUBLIC_ prefix", () => {
    const envTemplate = readRepositoryFile(".env.example");

    expect(envTemplate).not.toMatch(
      /^NEXT_PUBLIC_.*(?:SERVICE_ROLE|PASSWORD|PRIVATE_KEY|SECRET|TOKEN|API_KEY|CREDENTIAL).*=/im,
    );
  });

  it("does not read server-only environment variables in Client Components", () => {
    const clientFiles = ["app", "components", "lib"]
      .flatMap(sourceFiles)
      .filter((file) =>
        /^\s*["']use client["'];/.test(readFileSync(file, "utf8")),
      );

    for (const file of clientFiles) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(
        /process\.env\.(?!NEXT_PUBLIC_)[A-Z0-9_]+/,
      );
    }
  });

  it("ignores local environment files while allowing the empty template", () => {
    const gitignore = readRepositoryFile(".gitignore");

    expect(gitignore).toMatch(/^\.env\*\s*$/m);
    expect(gitignore).toMatch(/^!\.env\.example\s*$/m);
  });

  it("has no environment-gated HTTP endpoint for direct workspace writes", () => {
    expect(existsSync(resolve(repositoryRoot, "app/api/files/route.ts"))).toBe(false);
    expect(existsSync(resolve(repositoryRoot, "components/file-manager.tsx"))).toBe(false);
    expect(readRepositoryFile(".env.example")).not.toContain("SOFTWAREFACTORY_ENABLE_LOCAL_FILE_WRITES");
  });
});
