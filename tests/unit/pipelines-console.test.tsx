import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PipelinesConsole, pipelineStage, type PipelineTemplateSummary } from "@/components/pipelines-console";

const searchParams = vi.fn(() => new URLSearchParams());
vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams() }));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const templates: PipelineTemplateSummary[] = [
  {
    key: "feature_build",
    name: "Feature Build",
    category: "BUILD",
    summary: "Plan, build, and verify a feature.",
    version: 3,
    topology: "DAG",
    nodeCount: 6,
    maxParallelism: 2,
    compiles: true,
  },
];

function command(id: string, status: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    prompt: `Goal ${id}`,
    risk: "YELLOW",
    status,
    submittedAt: "2026-08-17T10:00:00.000Z",
    completedAt: null,
    project: { id: "p1", name: "SoftwareFactory" },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  searchParams.mockReset();
  searchParams.mockReturnValue(new URLSearchParams());
});

describe("pipelineStage", () => {
  it("maps every worker-advanced status to a human stage", () => {
    expect(pipelineStage("queued").label).toBe("Planning");
    expect(pipelineStage("running").label).toBe("Building");
    expect(pipelineStage("succeeded")).toMatchObject({ label: "Complete", tone: "safe" });
    expect(pipelineStage("failed")).toMatchObject({ label: "Failed", tone: "danger" });
    expect(pipelineStage("awaiting_approval")).toMatchObject({ needsOwner: true });
  });
});

describe("PipelinesConsole", () => {
  it("shows only live lifecycle stages on Active, with owner attention counted", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/commands") {
        return jsonResponse({ commands: [
          command("c1", "running"),
          command("c2", "awaiting_approval", { risk: "RED" }),
          command("c3", "succeeded", { completedAt: "2026-08-17T11:00:00.000Z" }),
          command("c4", "failed", { completedAt: "2026-08-17T11:30:00.000Z" }),
        ] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<PipelinesConsole templates={templates} />);

    expect(await screen.findByText("Goal c1")).toBeInTheDocument();
    expect(screen.getByText("Building")).toBeInTheDocument();
    expect(screen.getByText("Waiting for your approval")).toBeInTheDocument();
    // Finished runs are not in the Active list.
    expect(screen.queryByText("Goal c3")).not.toBeInTheDocument();
    // The summary counts come from the same records.
    expect(screen.getByText("Active now").parentElement).toHaveTextContent("2");
    expect(screen.getByText("Need your approval").parentElement).toHaveTextContent("1");
    expect(screen.getByText("Completed").parentElement).toHaveTextContent("1");
    expect(screen.getByText("Failed").parentElement).toHaveTextContent("1");
  });

  it("shows the whole history with outcomes and durations on All Pipelines", async () => {
    searchParams.mockReturnValue(new URLSearchParams("view=all"));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ commands: [
      command("c3", "succeeded", { completedAt: "2026-08-17T11:00:00.000Z" }),
    ] })));

    render(<PipelinesConsole templates={templates} />);

    expect(await screen.findByText("Goal c3")).toBeInTheDocument();
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByText(/took 1 h 0 min/)).toBeInTheDocument();
  });

  it("renders the versioned compiled templates with real topology facts", async () => {
    searchParams.mockReturnValue(new URLSearchParams("view=templates"));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/pipeline-templates") return jsonResponse({ templates: [], canManage: false });
      return jsonResponse({ commands: [] });
    }));

    render(<PipelinesConsole templates={templates} />);

    const builtIns = (await screen.findByText("Feature Build")).closest("section") as HTMLElement;
    expect(within(builtIns).getByText("v3")).toBeInTheDocument();
    expect(within(builtIns).getByText(/DAG · 6 nodes · up to 2 in parallel/)).toBeInTheDocument();
    // Deep compiled previews stay on Workflows — one engine, one source.
    expect(screen.getByRole("link", { name: "Workflows" })).toHaveAttribute("href", "/solutions/workflows");
  });

  it("sends an empty workspace to the composer and gates a signed-out visitor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ commands: [] })));
    const { unmount } = render(<PipelinesConsole templates={templates} />);
    expect(await screen.findByText("Nothing is running")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /start a pipeline/i })).toHaveAttribute(
      "href",
      "/solutions/bot-manager",
    );
    unmount();

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 401)));
    render(<PipelinesConsole templates={templates} />);
    expect(await screen.findByText("Sign in to see your pipelines")).toBeInTheDocument();
  });
});
