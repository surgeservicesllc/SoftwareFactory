// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DEFAULT_SUPER_ADMIN_EMAILS,
  isSuperAdmin,
  superAdminEmails,
} from "@/lib/auth/super-admin";

const CONFIGURED = DEFAULT_SUPER_ADMIN_EMAILS[0];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("super administrator role", () => {
  it("grants the role to a confirmed configured address, ignoring case and spacing", () => {
    expect(isSuperAdmin(CONFIGURED, true)).toBe(true);
    expect(isSuperAdmin(CONFIGURED.toUpperCase(), true)).toBe(true);
    expect(isSuperAdmin(`  ${CONFIGURED}  `, true)).toBe(true);
  });

  it("refuses an unconfirmed address", () => {
    // Without this, anyone who signed up as a listed address before its real
    // owner did would inherit full access.
    expect(isSuperAdmin(CONFIGURED, false)).toBe(false);
  });

  it("refuses everyone else, and a missing address", () => {
    expect(isSuperAdmin("someone.else@example.org", true)).toBe(false);
    expect(isSuperAdmin(null, true)).toBe(false);
    expect(isSuperAdmin(undefined, true)).toBe(false);
    expect(isSuperAdmin("", true)).toBe(false);
  });

  it("lets the environment replace the list rather than extend it", () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "ops@example.org, Second@Example.org");

    expect(superAdminEmails()).toEqual(["ops@example.org", "second@example.org"]);
    expect(isSuperAdmin("ops@example.org", true)).toBe(true);
    expect(isSuperAdmin(CONFIGURED, true)).toBe(false);
  });

  it("falls back rather than locking everyone out on an empty variable", () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "   ,  ");
    expect(superAdminEmails()).toEqual([CONFIGURED]);
  });
});
