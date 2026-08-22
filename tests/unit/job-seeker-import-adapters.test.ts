import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ImportSourceError,
  MAX_IMPORT_POSTINGS,
  htmlToText,
  listImportAdapters,
} from "@/lib/job-seeker/import-adapters";

/**
 * The registry's honesty contract, updated for public adapters:
 *
 * - Greenhouse and Lever read public keyless APIs — always available, with
 *   a real `fetchPostings` driven by a user-supplied identifier, and their
 *   output is bounded and normalized to what job_seeker_jobs stores.
 * - A credentialed adapter (LinkedIn) is configured only by detection of
 *   the exact variables it names, and carries no fetch implementation at
 *   all while unconfigured — nothing to call, nothing that could invent a
 *   job.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("listImportAdapters", () => {
  it("keeps the credentialed adapter detection-gated with its needs named", () => {
    const adapters = listImportAdapters({} as unknown as NodeJS.ProcessEnv);
    const linkedin = adapters.find((a) => a.key === "linkedin");
    expect(linkedin?.mode).toBe("credentialed");
    expect(linkedin?.configured).toBe(false);
    expect(linkedin?.requiredConfiguration.length).toBeGreaterThan(0);
    expect(linkedin?.fetchPostings).toBeUndefined();

    // Partial configuration is not configuration.
    const partial = listImportAdapters({
      SOFTWAREFACTORY_LINKEDIN_CLIENT_ID: "id-only",
    } as unknown as NodeJS.ProcessEnv);
    expect(partial.find((a) => a.key === "linkedin")?.configured).toBe(false);
  });

  it("exposes the public adapters as available with real fetchers and identifier guidance", () => {
    const adapters = listImportAdapters({} as unknown as NodeJS.ProcessEnv);
    for (const key of ["greenhouse", "lever"]) {
      const adapter = adapters.find((a) => a.key === key);
      expect(adapter?.mode).toBe("public");
      expect(adapter?.configured).toBe(true);
      expect(adapter?.requiredConfiguration).toEqual([]);
      expect(typeof adapter?.fetchPostings).toBe("function");
      expect(adapter?.identifierLabel).toBeTruthy();
      expect(adapter?.identifierHint).toBeTruthy();
    }
  });

  it("gives every adapter a recordable source key", () => {
    for (const adapter of listImportAdapters({} as unknown as NodeJS.ProcessEnv)) {
      expect(adapter.key).toMatch(/^[a-z][a-z0-9_]{0,62}$/);
    }
  });
});

describe("greenhouse fetchPostings", () => {
  const fetchGreenhouse = () =>
    listImportAdapters({} as unknown as NodeJS.ProcessEnv).find((a) => a.key === "greenhouse")!
      .fetchPostings!;

  it("maps postings to the stored shape, decoding the escaped HTML content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({
        jobs: [
          {
            id: 8130725,
            title: "Staff Engineer",
            company_name: "Meridian Software",
            absolute_url: "https://meridian.example/jobs?gh_jid=8130725",
            location: { name: "Remote — US" },
            content: "&lt;p&gt;TypeScript &amp;amp; PostgreSQL daily.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Ship end to end&lt;/li&gt;&lt;/ul&gt;",
          },
          { id: 2, title: "", content: "no title, dropped" },
        ],
      }),
    ));

    const result = await fetchGreenhouse()("Meridian-Board");
    expect(result.company).toBe("Meridian Software");
    expect(result.totalAvailable).toBe(2);
    expect(result.postings).toHaveLength(1);
    const posting = result.postings[0]!;
    expect(posting.externalId).toBe("8130725");
    expect(posting.url).toBe("https://meridian.example/jobs?gh_jid=8130725");
    expect(posting.workModel).toBe("remote");
    expect(posting.description).toContain("TypeScript & PostgreSQL daily.");
    expect(posting.description).toContain("Ship end to end");
    expect(posting.description).not.toContain("<p>");

    const requested = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(String(requested)).toBe(
      "https://boards-api.greenhouse.io/v1/boards/meridian-board/jobs?content=true",
    );
  });

  it("caps one import and reports the board's true total", async () => {
    const jobs = Array.from({ length: MAX_IMPORT_POSTINGS + 25 }, (_, index) => ({
      id: index + 1,
      title: `Role ${index + 1}`,
      company_name: "Big Board",
      content: "",
    }));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ jobs })));

    const result = await fetchGreenhouse()("bigboard");
    expect(result.totalAvailable).toBe(MAX_IMPORT_POSTINGS + 25);
    expect(result.postings).toHaveLength(MAX_IMPORT_POSTINGS);
  });

  it("refuses a malformed identifier before any request leaves", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(fetchGreenhouse()("no spaces allowed")).rejects.toMatchObject({
      code: "identifier_invalid",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("names a missing board honestly on the provider's 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "not found" }, 404)));
    await expect(fetchGreenhouse()("ghost")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ImportSourceError
        && error.code === "source_not_found"
        && error.message.includes("ghost"),
    );
  });

  it("reports an unreachable provider as unreachable, not as an empty board", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    await expect(fetchGreenhouse()("anyboard")).rejects.toMatchObject({
      code: "provider_unreachable",
    });
  });
});

describe("lever fetchPostings", () => {
  const fetchLever = () =>
    listImportAdapters({} as unknown as NodeJS.ProcessEnv).find((a) => a.key === "lever")!
      .fetchPostings!;

  it("maps postings with workplaceType and list content, attributing the site as company", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse([
        {
          id: "ac978161-6f46-4f6b-ad9e-a258e642751c",
          text: "Platform Lead",
          hostedUrl: "https://jobs.lever.co/palantir/ac978161",
          workplaceType: "hybrid",
          categories: { location: "London, United Kingdom" },
          descriptionPlain: "Build the platform.",
          lists: [{ text: "Requirements", content: "<li>TypeScript</li><li>PostgreSQL</li>" }],
        },
      ]),
    ));

    const result = await fetchLever()("palantir");
    expect(result.company).toBe("palantir");
    expect(result.postings).toHaveLength(1);
    const posting = result.postings[0]!;
    expect(posting.workModel).toBe("hybrid");
    expect(posting.company).toBe("palantir");
    expect(posting.description).toContain("Build the platform.");
    expect(posting.description).toContain("Requirements");
    expect(posting.description).toContain("TypeScript");
  });

  it("treats the provider's unknown-site 404 as source_not_found", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ ok: false, error: "Document not found" }, 404),
    ));
    await expect(fetchLever()("ghost")).rejects.toMatchObject({ code: "source_not_found" });
  });

  it("treats a non-list 200 as a provider error, never as postings", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: false })));
    await expect(fetchLever()("odd")).rejects.toMatchObject({ code: "provider_error" });
  });
});

describe("htmlToText", () => {
  it("decodes entities and turns block boundaries into line breaks", () => {
    expect(htmlToText("&lt;p&gt;A &amp;amp; B&lt;/p&gt;&lt;p&gt;C&lt;/p&gt;")).toBe("A & B\nC");
    expect(htmlToText("<ul><li>one</li><li>two</li></ul>")).toBe("one\ntwo");
    expect(htmlToText("&#x1F680; launch &#65;")).toContain("launch A");
  });
});
