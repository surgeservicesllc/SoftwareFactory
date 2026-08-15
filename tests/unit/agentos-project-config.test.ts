// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  configsAreEquivalent,
  parseProjectConfig,
  ProjectConfigError,
  serializeProjectConfig,
} from "@/lib/agentos/project-config";

/**
 * `docs/AGENTOS_SPEC.md` §22: "a YAML file pushed from CLI produces the same
 * agents+template you can see in the UI, and `pull` is a no-op after `push`".
 *
 * The no-op half is the load-bearing one, and it is the half that quietly
 * breaks. A round trip fails not because parsing is wrong but because the two
 * halves disagree about ordering or about what an absent field meant, so most
 * of what follows attacks those two seams rather than the happy path.
 */

const completeConfig = `
project: Storefront
environments:
  - name: sandbox
    allowedHosts:
      - api.github.com
      - registry.npmjs.org
  - name: open-lab
    networking: open
mcpConnections:
  - name: github
    displayName: GitHub
    transport: http
    endpoint: https://api.githubcopilot.com/mcp/
    credentialEnvVar: GITHUB_MCP_TOKEN
    allowedOperations:
      - list_issues
skills:
  - slug: brand-voice
    name: Brand voice
    kind: prompt
    body: Write plainly.
agents:
  - name: reviewer
    role: qa
    description: Reviews the plan.
    environment: sandbox
    inboxAccess: true
    collaborators:
      - builder
  - name: builder
    role: backend
    environment: open-lab
    runner: cloud
    mcpConnections:
      - github
    skills:
      - brand-voice
    repos:
      - repository: acme/storefront
        mountPath: /repos/storefront
        permission: git_write
    filesystem:
      - folderPath: /agents/builder
        read: true
        write: true
templates:
  - name: compound
    displayName: Compound engineer
    variables:
      - issue
    steps:
      - name: Plan
        agent: builder
        prompt: Plan {{issue}}
      - name: Sign off
        agent: human
        prompt: Approve the plan
        approvalGate: true
        humanStep: true
`;

function withAgents(body: string) {
  return `project: P\nagents:\n${body}`;
}

describe("round trip", () => {
  it("is identity after the first serialize", () => {
    const parsed = parseProjectConfig(completeConfig);
    const once = serializeProjectConfig(parsed);
    const twice = serializeProjectConfig(parseProjectConfig(once));

    expect(twice).toBe(once);
    expect(configsAreEquivalent(parsed, parseProjectConfig(once))).toBe(true);
  });

  it("survives a file whose collections arrived in a different order", () => {
    // The realistic failure: `pull` renders rows in whatever order the database
    // returned them, and the author's file was hand-ordered. Without a stable
    // sort the diff is real but says nothing.
    const shuffled = parseProjectConfig(completeConfig);
    const reversed = {
      ...shuffled,
      agents: [...shuffled.agents].reverse(),
      environments: [...shuffled.environments].reverse(),
    };

    expect(configsAreEquivalent(shuffled, reversed)).toBe(true);
  });

  it("does not distinguish an omitted field from one written at its default", () => {
    const implicit = parseProjectConfig(withAgents("  - name: solo\n"));
    const explicit = parseProjectConfig(
      withAgents("  - name: solo\n    runner: inherit\n    inboxAccess: false\n    skills: []\n"),
    );

    expect(configsAreEquivalent(implicit, explicit)).toBe(true);
    // And the serialized form is the minimal one, so a `pull` does not grow
    // the file with restatements of defaults every time it runs.
    expect(serializeProjectConfig(explicit)).not.toContain("inherit");
    expect(serializeProjectConfig(explicit)).not.toContain("skills");
  });

  it("keeps a non-default value that happens to sit beside a default", () => {
    // The mutation this guards: an over-eager default filter that drops the
    // whole key rather than only the defaulted value.
    const config = parseProjectConfig(withAgents("  - name: solo\n    runner: local\n"));
    const yaml = serializeProjectConfig(config);

    expect(yaml).toContain("runner: local");
    expect(parseProjectConfig(yaml).agents[0].runner).toBe("local");
  });

  it("keeps template step order, because order is the workflow", () => {
    const config = parseProjectConfig(completeConfig);
    const steps = parseProjectConfig(serializeProjectConfig(config)).templates[0].steps;

    expect(steps.map((step) => step.name)).toEqual(["Plan", "Sign off"]);
  });
});

describe("unknown keys", () => {
  it("refuses rather than drops", () => {
    // Dropping is the dangerous behaviour: `push` would accept the file, `pull`
    // would return it without the key, and the author would read that as
    // "applied" rather than "ignored".
    expect(() => parseProjectConfig("project: P\nmysteryKey: true\n")).toThrow(ProjectConfigError);
    expect(() => parseProjectConfig(withAgents("  - name: solo\n    superuser: true\n")))
      .toThrow(ProjectConfigError);
  });

  it("reports which key it refused", () => {
    try {
      parseProjectConfig(withAgents("  - name: solo\n    superuser: true\n"));
      expect.unreachable("an unknown key must not parse");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectConfigError);
      expect((error as ProjectConfigError).issues.join(" ")).toContain("superuser");
    }
  });
});

describe("credential references", () => {
  it("refuses a privileged variable name", () => {
    for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "GITHUB_APP_PRIVATE_KEY", "DATABASE_URL"]) {
      expect(() => parseProjectConfig(
        `project: P\nmcpConnections:\n  - name: c\n    displayName: C\n    transport: stdio\n    credentialEnvVar: ${name}\n`,
      )).toThrow(ProjectConfigError);
    }
  });

  it("refuses a NEXT_PUBLIC_ variable, which would reach the browser", () => {
    expect(() => parseProjectConfig(
      "project: P\nmcpConnections:\n  - name: c\n    displayName: C\n    transport: stdio\n    credentialEnvVar: NEXT_PUBLIC_TOKEN\n",
    )).toThrow(ProjectConfigError);
  });

  it("refuses anything that looks like a value rather than a name", () => {
    // A secret pasted where a reference belongs is the mistake worth catching,
    // and it is caught by shape: real tokens are not SCREAMING_SNAKE.
    expect(() => parseProjectConfig(
      "project: P\nmcpConnections:\n  - name: c\n    displayName: C\n    transport: stdio\n    credentialEnvVar: ghp_aBcDeF0123456789\n",
    )).toThrow(ProjectConfigError);
  });

  it("never writes a credential value into the serialized file", () => {
    const yaml = serializeProjectConfig(parseProjectConfig(completeConfig));

    expect(yaml).toContain("credentialEnvVar: GITHUB_MCP_TOKEN");
    // The name is a pointer. Nothing in the pipeline may resolve it.
    expect(yaml).not.toMatch(/ghp_|sk-|eyJ/);
  });
});

/** The reason a config was refused, which lives on `issues` and not on the message. */
function refusalReason(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectConfigError);
    return (error as ProjectConfigError).issues.join(" ");
  }
  expect.unreachable("this config must not parse");
}

describe("referential integrity", () => {
  it("refuses an agent naming an environment that does not exist", () => {
    const reason = refusalReason(() =>
      parseProjectConfig(withAgents("  - name: solo\n    environment: nowhere\n")));

    expect(reason).toContain('environment "nowhere" is not defined');
  });

  it("refuses an agent granted an undefined connection or skill", () => {
    expect(() => parseProjectConfig(withAgents("  - name: solo\n    mcpConnections: [ghost]\n")))
      .toThrow(ProjectConfigError);
    expect(() => parseProjectConfig(withAgents("  - name: solo\n    skills: [ghost]\n")))
      .toThrow(ProjectConfigError);
  });

  it("refuses an agent collaborating with itself", () => {
    // Left unchecked this is a delegation loop the runtime would discover only
    // by running it.
    const reason = refusalReason(() =>
      parseProjectConfig(withAgents("  - name: solo\n    collaborators: [solo]\n")));

    expect(reason).toContain("itself");
  });

  it("refuses a template step naming an agent that does not exist", () => {
    expect(() => parseProjectConfig(
      "project: P\ntemplates:\n  - name: t\n    displayName: T\n    steps:\n      - name: S\n        agent: ghost\n        prompt: go\n",
    )).toThrow(ProjectConfigError);
  });

  it("accepts `human` as a step actor without requiring an agent of that name", () => {
    const config = parseProjectConfig(
      "project: P\ntemplates:\n  - name: t\n    displayName: T\n    steps:\n      - name: S\n        agent: human\n        prompt: go\n        approvalGate: true\n        humanStep: true\n",
    );

    expect(config.templates[0].steps[0].agent).toBe("human");
  });

  it("refuses a prompt using a variable the template never declared", () => {
    // It would parse, push, and then fail only when someone instantiated it.
    const reason = refusalReason(() => parseProjectConfig(
      "project: P\ntemplates:\n  - name: t\n    displayName: T\n    steps:\n      - name: S\n        agent: human\n        approvalGate: true\n        humanStep: true\n        prompt: fix {{issue}}\n",
    ));

    expect(reason).toContain('undeclared variable "issue"');
  });
});

describe("names are identities, so they must be unambiguous", () => {
  it("refuses a duplicate agent, environment, skill, connection or template name", () => {
    // A push matches rows by name. Two entries sharing one means whichever row
    // won would be arbitrary, so the ambiguity is refused rather than resolved.
    const duplicates: [string, string][] = [
      ["agents", withAgents("  - name: solo\n  - name: solo\n")],
      ["environments", "project: P\nenvironments:\n  - name: e\n  - name: e\n"],
      ["skills", "project: P\nskills:\n  - slug: s\n    name: A\n    kind: prompt\n    body: x\n  - slug: s\n    name: B\n    kind: prompt\n    body: y\n"],
    ];

    for (const [collection, text] of duplicates) {
      expect(refusalReason(() => parseProjectConfig(text)))
        .toContain(`${collection}: "${collection === "skills" ? "s" : collection === "agents" ? "solo" : "e"}" is defined more than once`);
    }
  });
});

describe("faithfulness to the database's own constraints", () => {
  it("accepts an underscore in a connection name, which the column permits", () => {
    // A stricter rule here would make `pull` emit a file its own parser
    // rejects, which is the round trip failing in the least obvious direction.
    const config = parseProjectConfig(
      "project: P\nmcpConnections:\n  - name: linear_v2\n    displayName: Linear\n    transport: stdio\n",
    );

    expect(config.mcpConnections[0].name).toBe("linear_v2");
  });

  it("accepts a free-text agent name, which the column permits", () => {
    const config = parseProjectConfig(withAgents('  - name: "Release Captain"\n'));

    expect(config.agents[0].name).toBe("Release Captain");
  });

  it("reports that a free-text agent is unreachable from a template step", () => {
    // `agentos_task_template_steps.agent_name` is slug-shaped, so an agent
    // named with a space cannot be referenced there. Saying so at parse time
    // beats a constraint violation at push time.
    const reason = refusalReason(() => parseProjectConfig(
      'project: P\nagents:\n  - name: "Release Captain"\ntemplates:\n  - name: t\n    displayName: T\n    steps:\n      - name: S\n        agent: release-captain\n        prompt: go\n',
    ));

    expect(reason).toContain('names undefined agent "release-captain"');
  });

  it("defaults an agent to the custom role and omits it again on the way out", () => {
    const config = parseProjectConfig(withAgents("  - name: solo\n"));

    expect(config.agents[0].role).toBe("custom");
    expect(serializeProjectConfig(config)).not.toContain("role:");
  });

  it("refuses a role that is not in the enum", () => {
    expect(() => parseProjectConfig(withAgents("  - name: solo\n    role: overlord\n")))
      .toThrow(ProjectConfigError);
  });
});

describe("grants stay closed by default", () => {
  it("gives an agent with no lists no capability at all", () => {
    const agent = parseProjectConfig(withAgents("  - name: solo\n")).agents[0];

    expect(agent.mcpConnections).toEqual([]);
    expect(agent.skills).toEqual([]);
    expect(agent.repos).toEqual([]);
    expect(agent.filesystem).toEqual([]);
    expect(agent.inboxAccess).toBe(false);
    expect(agent.runner).toBe("inherit");
  });

  it("refuses a filesystem grant that permits nothing", () => {
    expect(() => parseProjectConfig(
      withAgents("  - name: solo\n    filesystem:\n      - folderPath: /a\n"),
    )).toThrow(ProjectConfigError);
  });

  it("refuses write or delete without read, matching the schema constraint", () => {
    expect(() => parseProjectConfig(
      withAgents("  - name: solo\n    filesystem:\n      - folderPath: /a\n        write: true\n"),
    )).toThrow(ProjectConfigError);
    expect(() => parseProjectConfig(
      withAgents("  - name: solo\n    filesystem:\n      - folderPath: /a\n        delete: true\n"),
    )).toThrow(ProjectConfigError);
  });

  it("refuses a traversal in a folder or mount path", () => {
    expect(() => parseProjectConfig(
      withAgents("  - name: solo\n    filesystem:\n      - folderPath: /a/../../etc\n        read: true\n"),
    )).toThrow(ProjectConfigError);
    expect(() => parseProjectConfig(withAgents(
      "  - name: solo\n    repos:\n      - repository: acme/x\n        mountPath: /r/../..\n",
    ))).toThrow(ProjectConfigError);
  });

  it("defaults a repo grant to read", () => {
    const agent = parseProjectConfig(withAgents(
      "  - name: solo\n    repos:\n      - repository: acme/x\n        mountPath: /r/x\n",
    )).agents[0];

    expect(agent.repos[0].permission).toBe("git_read");
  });
});

describe("environments", () => {
  it("refuses an open environment that also lists hosts", () => {
    // The list would read as a limit the environment does not apply.
    expect(() => parseProjectConfig(
      "project: P\nenvironments:\n  - name: e\n    networking: open\n    allowedHosts: [example.com]\n",
    )).toThrow(ProjectConfigError);
  });

  it("refuses a host carrying a scheme, port or path", () => {
    for (const host of ["https://example.com", "example.com:443", "example.com/path"]) {
      expect(() => parseProjectConfig(
        `project: P\nenvironments:\n  - name: e\n    allowedHosts: ["${host}"]\n`,
      )).toThrow(ProjectConfigError);
    }
  });

  it("defaults an environment to limited networking", () => {
    const config = parseProjectConfig("project: P\nenvironments:\n  - name: e\n");

    expect(config.environments[0].networking).toBe("limited");
  });
});

describe("skills", () => {
  it("refuses a prompt skill with a file path, or a file skill with a body", () => {
    expect(() => parseProjectConfig(
      "project: P\nskills:\n  - slug: s\n    name: S\n    kind: prompt\n    filePath: /a.md\n",
    )).toThrow(ProjectConfigError);
    expect(() => parseProjectConfig(
      "project: P\nskills:\n  - slug: s\n    name: S\n    kind: file\n    body: hi\n",
    )).toThrow(ProjectConfigError);
  });
});

describe("malformed input", () => {
  it("reports invalid YAML as such rather than as a schema failure", () => {
    expect(() => parseProjectConfig("project: [unclosed\n")).toThrow(/not valid YAML/);
  });

  it("refuses a file with no project name", () => {
    expect(() => parseProjectConfig("agents: []\n")).toThrow(ProjectConfigError);
  });

  it("refuses a document that is not a mapping", () => {
    expect(() => parseProjectConfig("- a\n- b\n")).toThrow(ProjectConfigError);
    expect(() => parseProjectConfig("just a string\n")).toThrow(ProjectConfigError);
  });
});
