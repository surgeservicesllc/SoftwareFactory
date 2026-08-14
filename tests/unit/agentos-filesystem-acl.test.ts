// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  authorizeFilesystemOperation,
  isWithinFolder,
  normalizeFilesystemPath,
  selectGoverningGrant,
  type FilesystemGrant,
} from "@/lib/agentos/filesystem-acl";

/**
 * `docs/AGENTOS_SPEC.md` §22 asks for exactly these: write without canWrite
 * fails, delete without canDelete fails, path escape fails.
 *
 * The interesting cases are not the obvious ones. They are the prefix that
 * looks contained but is not, and the traversal that survives a check because
 * it arrived encoded.
 */

const readOnly: FilesystemGrant = {
  folderPath: "/agents/support",
  canRead: true,
  canWrite: false,
  canDelete: false,
};

const writable: FilesystemGrant = {
  folderPath: "/goals/g1",
  canRead: true,
  canWrite: true,
  canDelete: false,
};

const full: FilesystemGrant = {
  folderPath: "/scratch",
  canRead: true,
  canWrite: true,
  canDelete: true,
};

describe("path normalization", () => {
  it("reduces a path without rewriting a hostile one", () => {
    expect(normalizeFilesystemPath("/agents/support")).toBe("/agents/support");
    expect(normalizeFilesystemPath("/agents//support/")).toBe("/agents/support");
    expect(normalizeFilesystemPath("/agents/./support")).toBe("/agents/support");
    expect(normalizeFilesystemPath("/")).toBe("/");
  });

  it("refuses traversal rather than resolving it", () => {
    // Popping `..` would let this land somewhere the caller never described,
    // and the grant check runs on the result.
    expect(normalizeFilesystemPath("/agents/support/../../etc/passwd")).toBeNull();
    expect(normalizeFilesystemPath("/..")).toBeNull();
    expect(normalizeFilesystemPath("/agents/../support")).toBeNull();
  });

  it("refuses the encodings that smuggle a traversal past a naive check", () => {
    expect(normalizeFilesystemPath("/agents/%2e%2e/etc")).toBeNull();
    expect(normalizeFilesystemPath("/agents%2f..%2fetc")).toBeNull();
    expect(normalizeFilesystemPath("/agents/..\\etc")).toBeNull();
    expect(normalizeFilesystemPath("/agents/support\0.txt")).toBeNull();
  });

  it("requires an absolute path of sane length", () => {
    expect(normalizeFilesystemPath("agents/support")).toBeNull();
    expect(normalizeFilesystemPath("")).toBeNull();
    expect(normalizeFilesystemPath(`/${"a".repeat(2000)}`)).toBeNull();
  });
});

describe("folder containment", () => {
  it("does not treat a longer sibling name as contained", () => {
    // The classic bypass: startsWith says yes, the operator meant no.
    expect(isWithinFolder("/agents/support-evil", "/agents/support")).toBe(false);
    expect(isWithinFolder("/agents/supportx", "/agents/support")).toBe(false);

    expect(isWithinFolder("/agents/support", "/agents/support")).toBe(true);
    expect(isWithinFolder("/agents/support/notes.md", "/agents/support")).toBe(true);
  });

  it("treats root as covering everything", () => {
    expect(isWithinFolder("/anything/at/all", "/")).toBe(true);
  });
});

describe("grant selection", () => {
  it("lets the most specific grant govern, so a parent cannot widen a child", () => {
    const grants = [
      { folderPath: "/goals", canRead: true, canWrite: true, canDelete: true },
      { folderPath: "/goals/g1/readonly", canRead: true, canWrite: false, canDelete: false },
    ];

    const governing = selectGoverningGrant("/goals/g1/readonly/file.md", grants);
    expect(governing?.folderPath).toBe("/goals/g1/readonly");

    // And the narrow grant is what decides the verb.
    expect(authorizeFilesystemOperation("write", "/goals/g1/readonly/file.md", grants))
      .toMatchObject({ allowed: false, reason: "verb_not_granted" });
    // Elsewhere under the broad grant, writing is still fine.
    expect(authorizeFilesystemOperation("write", "/goals/g2/file.md", grants).allowed).toBe(true);
  });
});

describe("operation authorization", () => {
  it("separates read, write and delete", () => {
    expect(authorizeFilesystemOperation("read", "/agents/support/a.md", [readOnly]).allowed).toBe(true);
    expect(authorizeFilesystemOperation("list", "/agents/support", [readOnly]).allowed).toBe(true);

    expect(authorizeFilesystemOperation("write", "/agents/support/a.md", [readOnly]))
      .toMatchObject({ allowed: false, reason: "verb_not_granted" });

    // The spec's specific example: writable is not deletable.
    expect(authorizeFilesystemOperation("write", "/goals/g1/a.md", [writable]).allowed).toBe(true);
    expect(authorizeFilesystemOperation("delete", "/goals/g1/a.md", [writable]))
      .toMatchObject({ allowed: false, reason: "verb_not_granted" });

    expect(authorizeFilesystemOperation("delete", "/scratch/a.md", [full]).allowed).toBe(true);
  });

  it("treats mkdir as a write", () => {
    expect(authorizeFilesystemOperation("mkdir", "/agents/support/new", [readOnly]))
      .toMatchObject({ allowed: false, reason: "verb_not_granted" });
    expect(authorizeFilesystemOperation("mkdir", "/goals/g1/new", [writable]).allowed).toBe(true);
  });

  it("denies an agent with no grants at all", () => {
    expect(authorizeFilesystemOperation("read", "/anything", []))
      .toMatchObject({ allowed: false, reason: "no_grant_for_path" });
  });

  it("denies a path outside every grant, including a near miss", () => {
    expect(authorizeFilesystemOperation("read", "/agents/other/a.md", [readOnly]))
      .toMatchObject({ allowed: false, reason: "path_escapes_grant" });
    // The sibling whose name merely starts the same.
    expect(authorizeFilesystemOperation("read", "/agents/support-evil/a.md", [readOnly]))
      .toMatchObject({ allowed: false, reason: "path_escapes_grant" });
  });

  it("denies a traversal even when it points back inside a grant", () => {
    // Refusing is right even though the target would have been allowed: the
    // caller asked for something it could not describe honestly.
    expect(authorizeFilesystemOperation("read", "/agents/support/../support/a.md", [readOnly]))
      .toMatchObject({ allowed: false, reason: "invalid_path" });
  });

  it("ignores a grant whose own folder path is malformed", () => {
    const malformed = [{ folderPath: "relative/path", canRead: true, canWrite: true, canDelete: true }];
    expect(authorizeFilesystemOperation("read", "/relative/path", malformed).allowed).toBe(false);
  });

  it("returns the normalized path so a caller cannot act on the raw input", () => {
    const decision = authorizeFilesystemOperation("read", "/agents//support//a.md", [readOnly]);
    expect(decision).toMatchObject({ allowed: true, path: "/agents/support/a.md" });
  });
});
