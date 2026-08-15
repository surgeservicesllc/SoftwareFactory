// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `supabase/config.toml` must parse with no environment variables set.
 *
 * This is not a style rule. The Supabase GitHub integration parses this file
 * before it applies migrations, and it parses it in an environment that has
 * none of this repository's variables. A typed field written as
 * `env(SOMETHING)` substitutes to an empty string there, fails its type
 * conversion, and aborts the *entire* config load with
 * `ProjectConfigParseError` — taking migration apply down with it.
 *
 * That is exactly what happened: `auth.email.smtp.port` is a `uint16`, was
 * written as `env(SUPABASE_AUTH_SMTP_PORT)`, and the integration's
 * `Supabase Preview` check failed on every merge to `main` with
 *
 *     'auth.email.smtp.port' cannot parse value as 'uint16'
 *
 * The visible symptom was not "email is misconfigured". It was that no
 * migration ever reached hosted, and every one of them had to be applied by
 * hand. A mailer setting silently became a deployment blocker.
 *
 * String fields are fine as `env(...)`: an empty string is a valid string, so
 * credentials still live in the environment and still fail loudly at the point
 * they are actually used.
 */

const configPath = resolve(import.meta.dirname, "../../supabase/config.toml");

/**
 * Keys whose values the Supabase CLI parses as a number. An `env()` on any of
 * these breaks the whole file rather than just its own section.
 */
const NUMERICALLY_TYPED_KEYS = [
  "port",
  "shadow_port",
  "max_frequency",
  "otp_length",
  "max_enrolled_factors",
  "pool_size",
  "default_pool_size",
  "max_client_conn",
  "file_size_limit",
  "max_header_length",
  "token_expiry",
] as const;

describe("supabase/config.toml", () => {
  it("keeps every numerically typed setting a literal, not an env() substitution", async () => {
    const config = await readFile(configPath, "utf8");

    const offenders: string[] = [];
    for (const [index, rawLine] of config.split("\n").entries()) {
      const line = rawLine.trim();
      if (line.startsWith("#")) continue;

      const match = /^([a-z_]+)\s*=\s*"env\(([^)]*)\)"/.exec(line);
      if (!match) continue;
      if (!(NUMERICALLY_TYPED_KEYS as readonly string[]).includes(match[1]!)) continue;

      offenders.push(`line ${index + 1}: ${match[1]} = env(${match[2]})`);
    }

    // Named, not counted — the fix is different for each key.
    expect(offenders).toEqual([]);
  });

  it("keeps the SMTP port a literal and its credentials in the environment", async () => {
    const config = await readFile(configPath, "utf8");
    const smtp = config.slice(config.indexOf("[auth.email.smtp]"));
    const section = smtp.slice(0, smtp.indexOf("\n[", 1));

    expect(section).toMatch(/^port\s*=\s*\d+$/m);

    // The port becoming a literal must not turn into an excuse to inline the
    // things that genuinely are secret.
    for (const credential of ["host", "user", "pass"]) {
      expect(section).toMatch(new RegExp(`^${credential}\\s*=\\s*"env\\(`, "m"));
    }
  });

  it("contains no inline credential value", async () => {
    const config = await readFile(configPath, "utf8");

    // Any assignment that is a quoted literal must be either an env()
    // reference or something plainly non-secret. This is a coarse net; its job
    // is to fail loudly if a real password is ever pasted in here.
    expect(config).not.toMatch(/pass\s*=\s*"(?!env\()/);
    expect(config).not.toMatch(/service_role|sbp_|eyJhbGciOi/);
  });
});
