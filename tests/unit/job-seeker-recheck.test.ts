// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  classifyPage,
  isPublicAddress,
  RECHECK_MAX_BODY_BYTES,
  RecheckRefusedError,
  recheckPosting,
  refuseUrl,
} from "@/lib/job-seeker/board-search/recheck";

/**
 * The still-open recheck (ADR-249) is owner-safe before it is useful:
 * nothing but the public web is fetched, every resolved address is
 * checked, redirects are never followed, the body is bounded and never
 * stored — and the answer names the status and the phrase.
 */

const publicLookup = async () => [{ address: "93.184.216.34" }];

function answering(status: number, body = "", headers: Record<string, string> = {}) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    expect(init?.redirect).toBe("manual");
    return new Response(status >= 300 && status < 400 ? null : body, { status, headers });
  }) as unknown as typeof fetch;
}

describe("refuseUrl", () => {
  it("accepts a plain public https URL and refuses everything else, naming why", () => {
    expect(refuseUrl("https://boards.example.com/jobs/1")).toBeNull();
    expect(refuseUrl("http://boards.example.com/jobs/1")).toContain("Only https");
    expect(refuseUrl("https://user:pw@boards.example.com/jobs/1")).toContain("credentials");
    expect(refuseUrl("https://boards.example.com:8443/jobs/1")).toContain("port");
    expect(refuseUrl("https://10.0.0.5/jobs/1")).toContain("address rather than a host");
    expect(refuseUrl("https://[::1]/jobs/1")).toContain("address rather than a host");
    expect(refuseUrl("https://localhost/jobs/1")).toMatch(/single-label|local/);
    expect(refuseUrl("https://metadata.internal/latest")).toContain("local or internal");
    expect(refuseUrl("https://printer.local/")).toContain("local or internal");
    expect(refuseUrl("not a url")).toContain("could not be parsed");
  });
});

describe("isPublicAddress", () => {
  it("rejects every private, loopback, link-local, carrier-grade and reserved range", () => {
    for (const address of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fc00::1", "fd12::1", "fe80::1", "ff02::1", "::ffff:10.0.0.1", "2001:db8::1"]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    for (const address of ["93.184.216.34", "172.32.0.1", "8.8.8.8", "2606:4700::1111", "::ffff:93.184.216.34"]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
    expect(isPublicAddress("not-an-address")).toBe(false);
  });
});

describe("classifyPage", () => {
  it("names gone, moved, blocked and open with the HTTP status, and quotes a closure phrase", () => {
    expect(classifyPage(404, "")).toEqual({ status: "gone", httpStatus: 404, note: "HTTP 404 — the page is gone." });
    expect(classifyPage(410, "").status).toBe("gone");
    expect(classifyPage(302, "")).toMatchObject({ status: "moved", httpStatus: 302 });
    expect(classifyPage(403, "")).toMatchObject({ status: "blocked", httpStatus: 403 });
    expect(classifyPage(503, "").status).toBe("blocked");
    expect(classifyPage(200, "We are hiring! Apply today.")).toEqual({
      status: "open", httpStatus: 200, note: "HTTP 200 — the page is up and does not say the position is closed.",
    });
    expect(classifyPage(200, "Sorry, this job is NO LONGER ACCEPTING APPLICATIONS.")).toEqual({
      status: "gone", httpStatus: 200, note: "HTTP 200 — the page says “no longer accepting applications”.",
    });
  });
});

describe("recheckPosting", () => {
  it("refuses before any byte is sent when the URL or a resolved address is not public", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(recheckPosting("http://boards.example.com/1", { fetchImpl })).rejects.toBeInstanceOf(RecheckRefusedError);
    await expect(
      recheckPosting("https://boards.example.com/1", { fetchImpl, lookup: async () => [{ address: "93.184.216.34" }, { address: "10.0.0.9" }] }),
    ).rejects.toThrow(/public address/);
    await expect(recheckPosting("https://boards.example.com/1", { fetchImpl, lookup: async () => [] })).rejects.toThrow(/public address/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches once with manual redirects and classifies the answer", async () => {
    const gone = await recheckPosting("https://boards.example.com/1", { fetchImpl: answering(404), lookup: publicLookup });
    expect(gone).toMatchObject({ status: "gone", httpStatus: 404 });
    const closed = await recheckPosting("https://boards.example.com/1", {
      fetchImpl: answering(200, "<html><body><h1>Engineer</h1><p>This job has expired.</p></body></html>", { "content-type": "text/html" }),
      lookup: publicLookup,
    });
    expect(closed).toMatchObject({ status: "gone", note: "HTTP 200 — the page says “this job has expired”." });
    const open = await recheckPosting("https://boards.example.com/1", { fetchImpl: answering(200, "<p>Apply now</p>"), lookup: publicLookup });
    expect(open.status).toBe("open");
    const moved = await recheckPosting("https://boards.example.com/1", { fetchImpl: answering(301, "", { location: "https://boards.example.com/search" }), lookup: publicLookup });
    expect(moved.status).toBe("moved");
  });

  it("reads at most the bounded number of bytes and still classifies a huge page", async () => {
    const huge = `${"x".repeat(RECHECK_MAX_BODY_BYTES * 4)} this job has expired`;
    const outcome = await recheckPosting("https://boards.example.com/1", { fetchImpl: answering(200, huge), lookup: publicLookup });
    // The phrase sits beyond the cap: the page is read only up to it, so it is not seen.
    expect(outcome.status).toBe("open");
    const early = `this job has expired ${"x".repeat(RECHECK_MAX_BODY_BYTES * 4)}`;
    expect((await recheckPosting("https://boards.example.com/1", { fetchImpl: answering(200, early), lookup: publicLookup })).status).toBe("gone");
  });

  it("answers unreachable, never throws, when the host cannot be resolved or the fetch fails", async () => {
    const unresolved = await recheckPosting("https://boards.example.com/1", { fetchImpl: answering(200), lookup: async () => { throw new Error("ENOTFOUND"); } });
    expect(unresolved).toMatchObject({ status: "unreachable", httpStatus: null });
    const failing = vi.fn(async () => { throw new Error("connection reset"); }) as unknown as typeof fetch;
    const failed = await recheckPosting("https://boards.example.com/1", { fetchImpl: failing, lookup: publicLookup });
    expect(failed.status).toBe("unreachable");
    expect(failed.note).toContain("6 seconds");
  });
});
