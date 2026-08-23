// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

// The module guards itself against reaching a client bundle; the repository
// stubs that guard in tests, the same way every other server-only suite does.
vi.mock("server-only", () => ({}));

import { MAX_RESUME_CHARACTERS, extractResumeText } from "@/lib/job-seeker/resume-text";

/**
 * Text extraction against real files, not hand-written strings.
 *
 * `resume.docx` is a genuine ZIP written by Python's zipfile with deflated
 * WordprocessingML parts; `resume.pdf` was printed by Chromium. Both are the
 * shapes a person actually uploads. A test that fed the extractor a string it
 * had assembled itself would prove only that the two halves of this file agree
 * with each other.
 */

const fixtures = resolve(import.meta.dirname, "../fixtures/job-seeker");
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function fixture(name: string): Buffer {
  return readFileSync(resolve(fixtures, name));
}

describe("reading a DOCX", () => {
  it("recovers the text a person would see on the page", async () => {
    const result = await extractResumeText(fixture("resume.docx"), DOCX);
    expect(result.ok, result.ok ? "" : result.message).toBe(true);
    if (!result.ok) return;

    expect(result.text).toContain("Dana Okafor");
    expect(result.text).toContain("dana.okafor@example.com");
    expect(result.text).toContain("+1 (415) 555-0148");
    expect(result.text).toContain("Northwind Systems");
    expect(result.text).toContain("University of Michigan");
  });

  it("rejoins a word Word split across runs, without inserting spaces", async () => {
    /*
     * A spell-checker or a tracked edit leaves one word as three `w:t`
     * elements. Stripping tags naively would give "Kube rne tes", and every
     * skill matcher downstream would then miss a technology the person
     * plainly listed. This is the single most common way a DOCX reader is
     * subtly wrong.
     */
    const result = await extractResumeText(fixture("resume.docx"), DOCX);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain("Kubernetes");
    expect(result.text).not.toContain("Kube rne tes");
  });

  it("reads the page header, where a contact detail often hides", async () => {
    // Losing the header loses exactly the kind of field this feature collects.
    const result = await extractResumeText(fixture("resume.docx"), DOCX);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain("https://dana.example.com");
  });

  it("keeps line structure, because position carries meaning in a resume", async () => {
    const result = await extractResumeText(fixture("resume.docx"), DOCX);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The section heading must not have been glued onto the line above it.
    expect(result.text).toMatch(/\nEXPERIENCE\n/);
    expect(result.text.split("\n").length).toBeGreaterThan(8);
  });

  it("refuses a file that is not a ZIP at all, by name", async () => {
    const result = await extractResumeText(Buffer.from("This is a .doc renamed to .docx"), DOCX);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("corrupt_archive");
  });
});

describe("reading a PDF", () => {
  it("recovers the text a person would see on the page", async () => {
    const result = await extractResumeText(fixture("resume.pdf"), "application/pdf");
    expect(result.ok, result.ok ? "" : result.message).toBe(true);
    if (!result.ok) return;

    expect(result.text).toContain("Dana Okafor");
    expect(result.text).toContain("dana.okafor@example.com");
    expect(result.text).toContain("Northwind Systems");
    expect(result.text).toContain("Kubernetes");
  });

  it("refuses bytes that are not a PDF, by name", async () => {
    const result = await extractResumeText(Buffer.from("not a pdf"), "application/pdf");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unreadable_pdf");
  });
});

describe("reading plain text", () => {
  it("decodes UTF-8 and normalises whitespace without losing lines", async () => {
    const result = await extractResumeText(
      Buffer.from("Ana Ruiz\r\n\r\n\r\n\r\nSenior  Engineer\r\nMadrid, España"),
      "text/plain",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe("Ana Ruiz\n\nSenior Engineer\nMadrid, España");
  });

  it("truncates past the cap and says that it did", async () => {
    const long = `${"word ".repeat(MAX_RESUME_CHARACTERS)}`;
    const result = await extractResumeText(Buffer.from(long), "text/plain");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text.length).toBe(MAX_RESUME_CHARACTERS);
    expect(result.truncated).toBe(true);
    // The honest count is the real length, not the truncated one.
    expect(result.characters).toBeGreaterThan(MAX_RESUME_CHARACTERS);
  });

  it("calls an empty document empty rather than succeeding with nothing", async () => {
    // A scanned resume reaches here as zero characters. "Read it and found
    // nothing" and "could not read it" send a person in different directions.
    const result = await extractResumeText(Buffer.from("   \n\n  \t "), "text/plain");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("empty_document");
  });
});

describe("an unsupported type", () => {
  it("is named rather than silently returning nothing", async () => {
    const result = await extractResumeText(Buffer.from("%PDF"), "application/msword");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unsupported_type");
    expect(result.message).toContain("application/msword");
  });
});
