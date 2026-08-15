// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  CliError,
  describeDrift,
  mayPrune,
  parseAgentosArguments,
} from "@/lib/agentos/cli-options";

/**
 * One rule here deletes records and the rest is shape, so that is where the
 * tests concentrate: `--prune` alone must never be enough.
 */

describe("prune is opt-in twice", () => {
  it("does not prune when only --prune was given", () => {
    const options = parseAgentosArguments(["push", "--project", "P", "--prune"]);

    expect(options.prune).toBe(true);
    // The flag is recorded; acting on it is a separate question.
    expect(mayPrune(options)).toBe(false);
  });

  it("does not prune when only --yes was given", () => {
    expect(mayPrune(parseAgentosArguments(["push", "--project", "P", "--yes"]))).toBe(false);
  });

  it("prunes only when both were given", () => {
    expect(mayPrune(parseAgentosArguments(["push", "--project", "P", "--prune", "--yes"])))
      .toBe(true);
  });

  it("never prunes a plain push", () => {
    expect(mayPrune(parseAgentosArguments(["push", "--project", "P"]))).toBe(false);
  });
});

describe("argument shape", () => {
  it("defaults the file and leaves prune off", () => {
    const options = parseAgentosArguments(["pull", "--project", "Storefront"]);

    expect(options).toMatchObject({
      command: "pull", project: "Storefront", file: "agentos.yml",
      prune: false, confirmed: false,
    });
  });

  it("refuses a flag whose value is another flag", () => {
    // `--project --prune` means someone forgot the project name. Consuming
    // `--prune` as the value would push to a project called "--prune", or
    // silently drop the prune.
    expect(() => parseAgentosArguments(["push", "--project", "--prune"]))
      .toThrow(/--project needs a value/);
    expect(() => parseAgentosArguments(["push", "--project", "P", "--file"]))
      .toThrow(/--file needs a value/);
  });

  it("refuses an unknown command or option rather than ignoring it", () => {
    expect(() => parseAgentosArguments(["deploy"])).toThrow(CliError);
    expect(() => parseAgentosArguments(["push", "--project", "P", "--force"]))
      .toThrow(/Unknown option "--force"/);
  });

  it("requires a project for anything that touches a workspace", () => {
    expect(() => parseAgentosArguments(["push"])).toThrow(/push needs --project/);
    expect(() => parseAgentosArguments(["pull"])).toThrow(/pull needs --project/);
    // Help is the one command that needs nothing.
    expect(parseAgentosArguments(["help"]).command).toBe("help");
    expect(parseAgentosArguments([]).command).toBe("help");
  });
});

describe("drift report", () => {
  it("lists only non-empty collections, stably ordered", () => {
    const lines = describeDrift({
      templates: ["zeta", "alpha"],
      agents: ["builder"],
      skills: [],
      environments: [],
    });

    // Sorted so a person comparing two runs sees a real change, not a reorder.
    expect(lines).toEqual(["  agents: builder", "  templates: alpha, zeta"]);
  });

  it("is empty when nothing drifted, which is what lets push stay quiet", () => {
    expect(describeDrift({ agents: [], skills: [] })).toEqual([]);
  });
});
