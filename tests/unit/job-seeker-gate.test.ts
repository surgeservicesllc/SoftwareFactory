// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
  readViewer: vi.fn(),
  redirect: vi.fn((path: string) => {
    // Next's redirect throws to unwind the render; mirroring that keeps the
    // gate's control flow honest — a caller must not continue past it.
    throw new Error(`REDIRECT:${path}`);
  }),
  getUser: vi.fn(),
  listOrganizationMemberships: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: harness.redirect }));
vi.mock("@/lib/auth/viewer", () => ({ readViewer: harness.readViewer }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: harness.getUser } }),
}));
vi.mock("@/lib/supabase/tenant", () => ({
  listOrganizationMemberships: harness.listOrganizationMemberships,
}));

import { requireJobSeekerViewer } from "@/lib/job-seeker/gate";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const source = (path: string) => readFileSync(resolve(repositoryRoot, path), "utf8");

beforeEach(() => {
  vi.clearAllMocks();
  harness.readViewer.mockResolvedValue({ signedIn: true });
  harness.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  harness.listOrganizationMemberships.mockResolvedValue([{ organizationId: "org-1" }]);
});

describe("requireJobSeekerViewer", () => {
  it("turns a signed-out visitor away before anything renders", async () => {
    harness.readViewer.mockResolvedValue({ signedIn: false });

    await expect(requireJobSeekerViewer("/Job-Search"))
      .rejects.toThrow("REDIRECT:/sign-in?next=%2FJob-Search");
  });

  it("sends a signed-in person with no workspace through onboarding, and back", async () => {
    harness.listOrganizationMemberships.mockResolvedValue([]);

    await expect(requireJobSeekerViewer("/Job-Search"))
      .rejects.toThrow("REDIRECT:/auth/onboarding?next=%2FJob-Search");
  });

  it("lets a signed-in member through", async () => {
    await expect(requireJobSeekerViewer("/Job-Search")).resolves.toBeUndefined();
    expect(harness.redirect).not.toHaveBeenCalled();
  });

  it("lets a member through when the membership lookup itself fails", async () => {
    // The consoles render their own error states; a failed lookup must not
    // bounce a signed-in person out of the section.
    harness.getUser.mockRejectedValue(new Error("supabase down"));

    await expect(requireJobSeekerViewer("/job-seeker")).resolves.toBeUndefined();
  });
});

describe("every job-seeker entry point runs that gate", () => {
  it("gates /Job-Search in the page, because it inherits no job-seeker layout", () => {
    // This page sits outside the `job-seeker` segment, so the section layout
    // does not cover it. It shows a person's own career data, and an entry
    // point that skipped the gate would expose it.
    const page = source("app/(portal)/Job-Search/page.tsx");
    expect(page).toMatch(/requireJobSeekerViewer\("\/Job-Search"\)/);
    expect(page).toMatch(/await requireJobSeekerViewer/);
  });

  it("gates the job-seeker section in its layout", () => {
    const layout = source("app/(portal)/job-seeker/layout.tsx");
    expect(layout).toMatch(/await requireJobSeekerViewer\("\/job-seeker"\)/);
  });

  it("keeps one implementation of the rule rather than a copy per entry point", () => {
    // The layout's own warning, enforced: neither caller may inline the
    // redirect logic again.
    for (const path of [
      "app/(portal)/job-seeker/layout.tsx",
      "app/(portal)/Job-Search/page.tsx",
    ]) {
      expect(source(path)).not.toMatch(/listOrganizationMemberships/);
      expect(source(path)).not.toMatch(/redirect\("\/sign-in/);
    }
  });

  it("renders the same search panel on both entry points, not a second one", () => {
    const search = source("app/(portal)/job-seeker/search/page.tsx");
    const named = source("app/(portal)/Job-Search/page.tsx");
    for (const page of [search, named]) {
      expect(page).toMatch(/from "@\/components\/job-seeker\/search-panel"/);
      expect(page).toMatch(/<JobSearchPanel \/>/);
    }
  });
});
