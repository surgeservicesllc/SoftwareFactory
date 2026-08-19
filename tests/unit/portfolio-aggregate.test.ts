import { describe, expect, it } from "vitest";

import {
  buildPortfolio,
  filterProjects,
  sortProjects,
  type PortfolioSources,
  type ProjectRow,
} from "@/lib/portfolio/aggregate";

const project = (overrides: Partial<ProjectRow> = {}): ProjectRow => ({
  id: "project-a",
  name: "Alpha",
  status: "active",
  githubRepository: "acme/alpha",
  healthStatus: "healthy",
  autonomousMode: false,
  maximumAutonomousRisk: "GREEN",
  ...overrides,
});

function sources(overrides: Partial<PortfolioSources> = {}): PortfolioSources {
  return {
    projects: [project()],
    commands: [],
    runs: [],
    tasks: [],
    incidents: [],
    changeRequests: [],
    deployments: [],
    connections: [],
    ...overrides,
  };
}

describe("zero is not unknown", () => {
  it("reports 0 when a source was read and held nothing", () => {
    const view = buildPortfolio(sources());

    expect(view.projects[0].activeRuns).toBe(0);
    expect(view.unavailable).toEqual([]);
  });

  it("reports null when a source could not be read", () => {
    // The distinction the console must not blur: an unreadable source and an
    // empty one produce the same list, and rendering both as "0" would state
    // something the factory does not know.
    const view = buildPortfolio(sources({ runs: null }));

    expect(view.projects[0].activeRuns).toBeNull();
    expect(view.projects[0].openCommands).toBe(0);
  });

  it("names every source it could not read, so the console can say so once", () => {
    const view = buildPortfolio(sources({ runs: null, incidents: null }));

    expect(view.unavailable).toEqual(["runs", "incidents"]);
  });
});

describe("counting only counts open work", () => {
  it("counts in-flight runs and ignores finished ones", () => {
    const view = buildPortfolio(sources({
      runs: [
        { projectId: "project-a", status: "running" },
        { projectId: "project-a", status: "queued" },
        { projectId: "project-a", status: "succeeded" },
        { projectId: "project-a", status: "failed" },
      ],
    }));

    expect(view.projects[0].activeRuns).toBe(2);
  });

  it("never counts another project's work", () => {
    const view = buildPortfolio(sources({
      projects: [project(), project({ id: "project-b", name: "Beta" })],
      runs: [
        { projectId: "project-a", status: "running" },
        { projectId: "project-b", status: "running" },
        { projectId: "project-b", status: "running" },
      ],
    }));

    expect(view.projects[0].activeRuns).toBe(1);
    expect(view.projects[1].activeRuns).toBe(2);
  });
});

describe("connection health takes the worst link", () => {
  it("is connected only when every bound connection is", () => {
    const view = buildPortfolio(sources({
      connections: [
        { projectId: "project-a", status: "connected", provider: "github" },
        { projectId: "project-a", status: "connected", provider: "vercel" },
      ],
    }));

    expect(view.projects[0].connectionHealth).toBe("connected");
  });

  it("is degraded when one is broken, because a project is only as reachable as the link it needs", () => {
    const view = buildPortfolio(sources({
      connections: [
        { projectId: "project-a", status: "connected", provider: "github" },
        { projectId: "project-a", status: "error", provider: "vercel" },
      ],
    }));

    expect(view.projects[0].connectionHealth).toBe("degraded");
  });

  it("is not_connected when the project has no connections at all", () => {
    expect(buildPortfolio(sources()).projects[0].connectionHealth).toBe("not_connected");
  });

  it("is unknown when connections could not be read", () => {
    expect(buildPortfolio(sources({ connections: null })).projects[0].connectionHealth)
      .toBe("unknown");
  });
});

describe("owner attention is derived, not stored", () => {
  it("flags an open incident and says how many", () => {
    const view = buildPortfolio(sources({
      incidents: [
        { projectId: "project-a", status: "open" },
        { projectId: "project-a", status: "resolved" },
      ],
    }));

    expect(view.projects[0].ownerAttention).toBe(true);
    expect(view.projects[0].attentionReasons).toContain("1 open incident");
  });

  it("flags a degraded connection separately from health", () => {
    const view = buildPortfolio(sources({
      connections: [{ projectId: "project-a", status: "error", provider: "github" }],
    }));

    expect(view.projects[0].attentionReasons).toContain("A connection is not healthy");
  });

  it("does not flag a healthy, connected, incident-free project", () => {
    const view = buildPortfolio(sources({
      connections: [{ projectId: "project-a", status: "connected", provider: "github" }],
    }));

    expect(view.projects[0].ownerAttention).toBe(false);
    expect(view.projects[0].attentionReasons).toEqual([]);
  });

  it("does not invent attention from a source it could not read", () => {
    // An unreadable incidents table must not imply incidents exist.
    const view = buildPortfolio(sources({ incidents: null }));

    expect(view.projects[0].openIncidents).toBeNull();
    expect(view.projects[0].ownerAttention).toBe(false);
  });
});

describe("totals", () => {
  it("counts projects by lifecycle state and attention", () => {
    const view = buildPortfolio(sources({
      projects: [
        project(),
        project({ id: "b", name: "Beta", status: "paused" }),
        project({ id: "c", name: "Gamma", status: "draft", healthStatus: "unhealthy" }),
      ],
    }));

    expect(view.totals).toEqual({ projects: 3, active: 1, paused: 1, needingAttention: 1 });
  });
});

describe("sorting", () => {
  const view = buildPortfolio(sources({
    projects: [
      project({ id: "a", name: "Alpha", healthStatus: "healthy" }),
      project({ id: "b", name: "Beta", healthStatus: "unhealthy" }),
      project({ id: "c", name: "Gamma", healthStatus: "unknown" }),
    ],
    runs: [{ projectId: "c", status: "running" }],
  }));

  it("sorts by name by default", () => {
    expect(sortProjects(view.projects, "name").map((p) => p.name))
      .toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("sorts health worst-first, with unknown between degraded and healthy", () => {
    // Not knowing is worse than being fine and better than being broken.
    expect(sortProjects(view.projects, "health").map((p) => p.name))
      .toEqual(["Beta", "Gamma", "Alpha"]);
  });

  it("puts projects needing attention first", () => {
    expect(sortProjects(view.projects, "attention")[0].name).toBe("Beta");
  });

  it("sorts unknown activity last, because it is not evidence of being busy", () => {
    const withUnknown = buildPortfolio(sources({
      projects: [project({ id: "a", name: "Alpha" }), project({ id: "b", name: "Beta" })],
      runs: null,
    }));

    expect(sortProjects(withUnknown.projects, "activity").map((p) => p.activeRuns))
      .toEqual([null, null]);
  });

  it("does not mutate its input", () => {
    const before = view.projects.map((p) => p.name);
    sortProjects(view.projects, "health");

    expect(view.projects.map((p) => p.name)).toEqual(before);
  });
});

describe("filtering", () => {
  const view = buildPortfolio(sources({
    projects: [
      project({ id: "a", name: "Alpha", githubRepository: "acme/alpha" }),
      project({ id: "b", name: "Beta", githubRepository: "other/beta" }),
    ],
  }));

  it("matches on name, case-insensitively", () => {
    expect(filterProjects(view.projects, "ALPH").map((p) => p.name)).toEqual(["Alpha"]);
  });

  it("matches on repository", () => {
    expect(filterProjects(view.projects, "other/").map((p) => p.name)).toEqual(["Beta"]);
  });

  it("returns everything for a blank query", () => {
    expect(filterProjects(view.projects, "   ")).toHaveLength(2);
  });

  it("tolerates a project with no repository", () => {
    const noRepo = buildPortfolio(sources({
      projects: [project({ githubRepository: null })],
    }));

    expect(filterProjects(noRepo.projects, "acme")).toEqual([]);
  });
});
