// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

function source(relativePath: string) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

describe("Signed-in surface contracts", () => {
  it.each([
    "app/(marketing)/layout.tsx",
    "app/(console)/layout.tsx",
    "app/(portal)/layout.tsx",
  ])("resolves the viewer on the server in %s", (layout) => {
    const contents = source(layout);
    expect(contents).toMatch(/readViewer\(\)/);
    expect(contents).toMatch(/viewer=\{viewer\}/);
  });

  it("derives the viewer from a verified user, never from a cookie", () => {
    const viewer = source("lib/auth/viewer.ts");
    expect(viewer).toMatch(/auth\.getUser\(\)/);
    // A signed-in viewer must be impossible to produce from cookie contents.
    expect(viewer).not.toMatch(/getSession\(/);
    // The public site must still render when Supabase is absent.
    expect(viewer).toMatch(/catch/);
  });

  it("requires a confirmed address before granting the super-administrator role", () => {
    const roles = source("lib/auth/super-admin.ts");
    expect(roles).toMatch(/emailConfirmed/);
    expect(roles).toMatch(/if \(!email \|\| !emailConfirmed\) return false;/);
    expect(roles).toMatch(/SUPER_ADMIN_EMAILS/);
    // The role list is server-only and must never reach the browser bundle.
    expect(roles).toMatch(/^import "server-only";/m);
    expect(roles).not.toMatch(/NEXT_PUBLIC_/);
  });

  it("re-checks the role inside the admin page, not only in the navigation", () => {
    // Hiding the link is presentation. Typing the URL must still be refused.
    const admin = source("app/(console)/admin/page.tsx");
    expect(admin).toMatch(/readViewer\(\)/);
    expect(admin).toMatch(/!viewer\.signedIn \|\| !viewer\.isSuperAdmin/);
  });

  it("ends the session with a same-origin POST rather than a link", () => {
    const button = source("components/sign-out-button.tsx");
    expect(button).toMatch(/method: "POST"/);
    expect(button).toMatch(/\/api\/auth\/sign-out/);
    // Without a refresh the layouts keep rendering the stale signed-in shell.
    expect(button).toMatch(/router\.refresh\(\)/);
  });

  it("keeps the navigation model free of any secret", () => {
    const navigation = source("lib/navigation.ts");
    expect(navigation).not.toMatch(/process\.env/);
    // Shared by server layouts and the client header, so it must stay
    // importable from both. Matches the import, not the word in the comment.
    expect(navigation).not.toMatch(/^import "server-only";/m);
  });
});
