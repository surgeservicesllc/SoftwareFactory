import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PipelineTemplatesManager } from "@/components/pipeline-templates-manager";
import type { PipelineTemplateSummary } from "@/components/pipelines-console";

/**
 * A Use button is disabled until `/api/project-pipelines` has said whether
 * this person may select at all: the component fails closed rather than
 * offering an action it does not yet know is allowed. Pressing before that
 * answer lands is a no-op, so every press here waits for it first.
 */
async function pressWhenEnabled(button: HTMLElement) {
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const builtIns: PipelineTemplateSummary[] = [{
  key: "feature_build",
  name: "Feature Build",
  category: "BUILD",
  summary: "Plan, build, verify.",
  version: 3,
  topology: "DAG",
  nodeCount: 6,
  maxParallelism: 2,
  anchorNodeCount: 1,
  compiles: true,
}, {
  key: "incident_investigation",
  name: "Incident Investigation",
  category: "INVESTIGATION",
  summary: "An open-ended search.",
  version: 1,
  topology: "DISCOVERY_GRAPH",
  nodeCount: 5,
  maxParallelism: 3,
  anchorNodeCount: 0,
  compiles: true,
}];

const customTemplate = {
  id: "77777777-7777-4777-8777-777777777777",
  slug: "checkout_audit",
  name: "Checkout Audit",
  summary: "Audit the checkout flow end to end.",
  category: "AUDIT",
  capability: "review",
  areas: [{ id: "payments", job: "Check the payment flow." }],
  version: 2,
  editable: true,
  compiles: true,
  topology: "DIAMOND",
  nodeCount: 3,
  maxParallelism: 1,
  anchorNodeCount: 0,
  errors: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PipelineTemplatesManager", () => {
  it("does not call an unparseable custom-template read an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/pipeline-templates") return new Response("{", { status: 200 });
      if (url === "/api/project-pipelines") return jsonResponse({ pipelines: [], canManage: true });
      return jsonResponse({});
    }));

    render(<PipelineTemplatesManager builtIns={builtIns} projectContext={{ id: "p1", name: "One" }} />);

    expect(await screen.findByText("Custom templates are unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/No custom templates yet/)).not.toBeInTheDocument();
  });

  it("does not call a failed pipeline-selection read no selections", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/project-pipelines") return jsonResponse({}, 503);
      if (url === "/api/pipeline-templates") return jsonResponse({ templates: [], canManage: true });
      return jsonResponse({});
    }));

    render(<PipelineTemplatesManager builtIns={builtIns} projectContext={{ id: "p1", name: "One" }} />);

    expect(await screen.findByText(/Pipeline setup is unavailable because/)).toBeInTheDocument();
    expect(screen.queryByText(/No pipeline selected for One/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Not Connected —/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use Feature Build" })).toBeDisabled();
  });

  it("does not call an unparseable standalone project read an empty workspace", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/projects") return new Response("{", { status: 200 });
      if (url === "/api/project-pipelines") return jsonResponse({ pipelines: [], canManage: true });
      if (url === "/api/pipeline-templates") return jsonResponse({ templates: [], canManage: true });
      return jsonResponse({});
    }));

    render(<PipelineTemplatesManager builtIns={builtIns} />);

    expect(await screen.findByText(/Pipeline setup is unavailable because/)).toBeInTheDocument();
    expect(screen.queryByText(/this workspace has none yet/i)).not.toBeInTheDocument();
  });

  it("checks the standalone project response status inside the plan dialog", async () => {
    let projectReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/projects") {
        projectReads += 1;
        return projectReads === 1
          ? jsonResponse({ projects: [{ id: "p1", name: "One" }] })
          : jsonResponse({}, 503);
      }
      if (url === "/api/project-pipelines") return jsonResponse({ pipelines: [], canManage: true });
      if (url === "/api/pipeline-templates") return jsonResponse({ templates: [], canManage: true });
      return jsonResponse({});
    }));

    render(<PipelineTemplatesManager builtIns={builtIns} />);
    fireEvent.click(await screen.findByRole("button", { name: "Plan a graph from Feature Build" }));

    const dialog = await screen.findByRole("dialog", { name: "Plan a graph from Feature Build" });
    expect(await within(dialog).findByText(/Graph planning is unavailable/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/this workspace has none yet/i)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("lists custom templates with compiled facts and full CRUD, and built-ins as clone-only", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/pipeline-templates") {
        return jsonResponse({ templates: [customTemplate], canManage: true });
      }
      return jsonResponse({});
    }));

    render(<PipelineTemplatesManager builtIns={builtIns} />);

    const card = (await screen.findByText("Checkout Audit")).closest("section") as HTMLElement;
    expect(within(card).getByText("v2")).toBeInTheDocument();
    expect(within(card).getByText(/DIAMOND · 3 nodes/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Checkout Audit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Checkout Audit" })).toBeInTheDocument();
    // Built-ins are code: clone, never edit or delete.
    expect(screen.getByRole("button", { name: "Clone Feature Build" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Feature Build" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Feature Build" })).not.toBeInTheDocument();
  });

  it("says plainly that a discovery template executes as the plan shown", async () => {
    // The shape promises rounds; the executor runs the recorded nodes once.
    // Showing DISCOVERY_GRAPH without saying so would promise behaviour the
    // run will not perform.
    render(<PipelineTemplatesManager builtIns={builtIns} />);

    const note = await screen.findByText(/does not add rounds mid-run/);
    expect(note).toBeInTheDocument();
    // The ordinary DAG template carries no such note.
    expect(screen.getAllByText(/does not add rounds mid-run/)).toHaveLength(1);
  });


  it("tells the person choosing a template when its nodes need a workspace worker", async () => {
    // Two shipped templates carry ANCHOR nodes — run the tests, attempt the
    // reproduction. Since migration 20260819001000 the analysis worker does
    // not claim such a graph at all: it waits, with its budget intact, for a
    // worker that can run commands. Waiting is the honest state but a quiet
    // one, so the card says it before the graph is recorded.
    render(<PipelineTemplatesManager builtIns={builtIns} />);

    const note = await screen.findByText(/needs a workspace worker/);
    expect(note).toBeInTheDocument();
    expect(note.textContent).toContain("this graph waits rather than running");
    // Only the template with anchor nodes carries it.
    expect(screen.getAllByText(/needs a workspace worker/)).toHaveLength(1);
  });

  it("creates a template through the editor, sending the full areas payload", async () => {
    const posts: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/pipeline-templates" && init?.method === "POST") {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return jsonResponse({ template: { id: "n1", slug: "checkout_audit", version: 1 } }, 201);
      }
      if (url === "/api/pipeline-templates") return jsonResponse({ templates: [], canManage: true });
      return jsonResponse({});
    }));

    render(<PipelineTemplatesManager builtIns={builtIns} />);

    fireEvent.click(await screen.findByRole("button", { name: "New template" }));
    const dialog = screen.getByRole("dialog", { name: "New template" });
    fireEvent.change(within(dialog).getByLabelText("Key"), { target: { value: "checkout_audit" } });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Checkout Audit" } });
    fireEvent.change(within(dialog).getByLabelText("Summary"), { target: { value: "Audit the checkout." } });
    fireEvent.change(within(dialog).getByLabelText("Area 1 id"), { target: { value: "payments" } });
    fireEvent.change(within(dialog).getByLabelText("Area 1 job"), { target: { value: "Check the payment flow." } });
    fireEvent.click(within(dialog).getByRole("button", { name: /create template/i }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toEqual({
      slug: "checkout_audit",
      name: "Checkout Audit",
      summary: "Audit the checkout.",
      category: "AUDIT",
      capability: "review",
      areas: [{ id: "payments", job: "Check the payment flow." }],
    });
  });

  it("deletes only after the in-place confirm that names what survives", async () => {
    const deletes: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "DELETE") {
        deletes.push(url);
        return jsonResponse({ deleted: true });
      }
      if (url === "/api/pipeline-templates") {
        return jsonResponse({ templates: deletes.length ? [] : [customTemplate], canManage: true });
      }
      return jsonResponse({});
    }));

    render(<PipelineTemplatesManager builtIns={builtIns} />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete Checkout Audit" }));
    expect(deletes).toEqual([]);
    expect(screen.getByText(/Graphs already planned from it keep their records/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete template" }));
    await waitFor(() => expect(deletes).toEqual([`/api/pipeline-templates/${customTemplate.id}`]));
  });

  it("plans a real graph from a template through the launch endpoint", async () => {
    const launches: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/graphs" && init?.method === "POST") {
        launches.push(JSON.parse(String(init.body)));
        return jsonResponse({
          graphId: "g1",
          topology: "DIAMOND",
          nodeCount: 3,
          note: "The graph is recorded. No node has been dispatched.",
        });
      }
      if (url === "/api/pipeline-templates") {
        return jsonResponse({ templates: [customTemplate], canManage: true });
      }
      if (url === "/api/projects") {
        return jsonResponse({ projects: [{ id: "p1", name: "SoftwareFactory" }] });
      }
      return jsonResponse({});
    }));

    render(<PipelineTemplatesManager builtIns={builtIns} />);

    const card = (await screen.findByText("Checkout Audit")).closest("section") as HTMLElement;
    fireEvent.click(within(card).getAllByRole("button", { name: /^Plan a graph from Checkout Audit$/ })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Plan a graph from Checkout Audit" });
    await waitFor(() => expect(within(dialog).getByLabelText("Project")).toHaveValue("p1"));
    fireEvent.click(within(dialog).getByRole("button", { name: /plan graph/i }));

    await waitFor(() => expect(launches).toHaveLength(1));
    expect(launches[0]).toEqual({ projectId: "p1", templateKey: "checkout_audit" });
    // The result repeats the endpoint's honesty: recorded, not dispatched.
    expect(await within(dialog).findByText(/No node has been dispatched/)).toBeInTheDocument();
  });

  it("plans an embedded graph only against the caller's project", async () => {
    const launches: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/graphs" && init?.method === "POST") {
        launches.push(JSON.parse(String(init.body)));
        return jsonResponse({ graphId: "g2", topology: "DAG", nodeCount: 6 });
      }
      if (url === "/api/project-pipelines") {
        return jsonResponse({ pipelines: [], canManage: true });
      }
      if (url === "/api/pipeline-templates") {
        return jsonResponse({ templates: [], canManage: true });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PipelineTemplatesManager
        builtIns={builtIns}
        projectContext={{ id: "p2", name: "Second factory" }}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Plan a graph from Feature Build" }));
    const dialog = await screen.findByRole("dialog", { name: "Plan a graph from Feature Build" });
    const picker = within(dialog).getByLabelText("Project");
    expect(picker).toHaveValue("p2");
    expect(picker).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: /plan graph/i }));

    await waitFor(() => expect(launches).toEqual([{ projectId: "p2", templateKey: "feature_build" }]));
    expect(fetchMock).not.toHaveBeenCalledWith("/api/projects", expect.anything());
  });

  it("selects a template for the project and turns its Use button grey", async () => {
    let stored: Array<{ projectId: string; templateKey: string; name: string }> = [];
    const posted: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/project-pipelines" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { projectId: string; templateKey: string };
        posted.push(body);
        stored = [...stored, { ...body, name: "Feature Build" }];
        return jsonResponse({ pipeline: { ...body }, created: true });
      }
      if (url === "/api/project-pipelines") {
        return jsonResponse({ pipelines: stored, canManage: true });
      }
      if (url === "/api/pipeline-templates") return jsonResponse({ templates: [], canManage: true });
      return jsonResponse({});
    }));

    render(
      <PipelineTemplatesManager
        builtIns={builtIns}
        projectContext={{ id: "p1", name: "SoftwareFactory" }}
      />,
    );

    const use = await screen.findByRole("button", { name: "Use Feature Build" });
    expect(use).toHaveTextContent("Use");
    expect(use).toHaveAttribute("aria-pressed", "false");
    expect(use.className).toContain("btn-primary");

    await pressWhenEnabled(use);

    // Grey and pressed, saying it is selected rather than offering to select.
    const selected = await screen.findByRole("button", { name: "Stop using Feature Build" });
    await waitFor(() => expect(selected).toHaveAttribute("aria-pressed", "true"));
    expect(selected).toHaveTextContent("Selected");
    expect(selected.className).toContain("btn-secondary");
    expect(selected.className).not.toContain("btn-primary");
    expect(posted).toEqual([{ projectId: "p1", templateKey: "feature_build" }]);
    expect(await screen.findByText(/1 pipeline selected for SoftwareFactory/)).toBeInTheDocument();
  });

  it("keeps many selections at once, which is what a project's pipeline set is", async () => {
    let stored: Array<{ projectId: string; templateKey: string; name: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/project-pipelines" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { projectId: string; templateKey: string };
        stored = [...stored, { ...body, name: body.templateKey }];
        return jsonResponse({ pipeline: { ...body }, created: true });
      }
      if (url === "/api/project-pipelines") {
        return jsonResponse({ pipelines: stored, canManage: true });
      }
      if (url === "/api/pipeline-templates") {
        return jsonResponse({ templates: [customTemplate], canManage: true });
      }
      return jsonResponse({});
    }));

    render(
      <PipelineTemplatesManager
        builtIns={builtIns}
        projectContext={{ id: "p1", name: "SoftwareFactory" }}
      />,
    );

    await pressWhenEnabled(await screen.findByRole("button", { name: "Use Checkout Audit" }));
    await screen.findByRole("button", { name: "Stop using Checkout Audit" });
    await pressWhenEnabled(await screen.findByRole("button", { name: "Use Feature Build" }));
    await screen.findByRole("button", { name: "Stop using Feature Build" });

    expect(stored.map((selection) => selection.templateKey)).toEqual([
      "checkout_audit",
      "feature_build",
    ]);
    expect(await screen.findByText(/2 pipelines selected for SoftwareFactory/)).toBeInTheDocument();
  });

  it("removes a selection when a selected template is pressed again", async () => {
    let stored = [{ projectId: "p1", templateKey: "feature_build", name: "Feature Build" }];
    const deletes: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/project-pipelines?") && init?.method === "DELETE") {
        deletes.push(url);
        stored = [];
        return jsonResponse({ removed: true });
      }
      if (url === "/api/project-pipelines") {
        return jsonResponse({ pipelines: stored, canManage: true });
      }
      if (url === "/api/pipeline-templates") return jsonResponse({ templates: [], canManage: true });
      return jsonResponse({});
    }));

    render(
      <PipelineTemplatesManager
        builtIns={builtIns}
        projectContext={{ id: "p1", name: "SoftwareFactory" }}
      />,
    );

    await pressWhenEnabled(await screen.findByRole("button", { name: "Stop using Feature Build" }));
    await screen.findByRole("button", { name: "Use Feature Build" });
    expect(deletes).toEqual([
      "/api/project-pipelines?projectId=p1&templateKey=feature_build",
    ]);
  });

  it("says a refusal out loud instead of quietly reverting the button", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/project-pipelines" && init?.method === "POST") {
        return jsonResponse(
          { error: { code: "invalid_selection", message: "An archived project cannot change its pipelines." } },
          409,
        );
      }
      if (url === "/api/project-pipelines") return jsonResponse({ pipelines: [], canManage: true });
      if (url === "/api/pipeline-templates") return jsonResponse({ templates: [], canManage: true });
      return jsonResponse({});
    }));

    render(
      <PipelineTemplatesManager
        builtIns={builtIns}
        projectContext={{ id: "p1", name: "SoftwareFactory" }}
      />,
    );

    await pressWhenEnabled(await screen.findByRole("button", { name: "Use Feature Build" }));

    expect(
      await screen.findByText("An archived project cannot change its pipelines."),
    ).toBeInTheDocument();
    // Still offering to select, because it did not get selected.
    expect(screen.getByRole("button", { name: "Use Feature Build" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("refuses to pretend a member can select, and says why", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/project-pipelines") return jsonResponse({ pipelines: [], canManage: false });
      if (url === "/api/pipeline-templates") return jsonResponse({ templates: [], canManage: false });
      return jsonResponse({});
    }));

    render(
      <PipelineTemplatesManager
        builtIns={builtIns}
        projectContext={{ id: "p1", name: "SoftwareFactory" }}
      />,
    );

    const use = await screen.findByRole("button", { name: "Use Feature Build" });
    expect(use).toBeDisabled();
    expect(
      await screen.findByText(/needs organization owner or administrator access/i),
    ).toBeInTheDocument();
  });

  it("asks which project when the caller did not say, and selects against that one", async () => {
    const posted: Array<{ projectId: string; templateKey: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/project-pipelines" && init?.method === "POST") {
        posted.push(JSON.parse(String(init.body)));
        return jsonResponse({ pipeline: {}, created: true });
      }
      if (url === "/api/project-pipelines") return jsonResponse({ pipelines: [], canManage: true });
      if (url === "/api/pipeline-templates") return jsonResponse({ templates: [], canManage: true });
      if (url === "/api/projects") {
        return jsonResponse({ projects: [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }] });
      }
      return jsonResponse({});
    }));

    render(<PipelineTemplatesManager builtIns={builtIns} />);

    const picker = await screen.findByLabelText("Project");
    fireEvent.change(picker, { target: { value: "p2" } });
    await pressWhenEnabled(await screen.findByRole("button", { name: "Use Feature Build" }));

    await waitFor(() => expect(posted).toEqual([{ projectId: "p2", templateKey: "feature_build" }]));
  });
  it("says Not Connected when the database cannot record a selection at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/project-pipelines") {
        return jsonResponse({ available: false, canManage: false, pipelines: [] });
      }
      if (url === "/api/pipeline-templates") return jsonResponse({ templates: [], canManage: true });
      return jsonResponse({});
    }));

    render(
      <PipelineTemplatesManager
        builtIns={builtIns}
        projectContext={{ id: "p1", name: "SoftwareFactory" }}
      />,
    );

    expect(await screen.findByText(/^Not Connected —/)).toBeInTheDocument();
    // Disabled for the real reason, not mislabelled as a permission problem.
    expect(screen.getByRole("button", { name: "Use Feature Build" })).toBeDisabled();
    expect(screen.queryByText(/owner or administrator access/i)).not.toBeInTheDocument();
  });
  it("does not fall back to another project when the caller has none in hand", async () => {
    const posted: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/project-pipelines" && init?.method === "POST") {
        posted.push(JSON.parse(String(init.body)));
        return jsonResponse({ pipeline: {}, created: true });
      }
      if (url === "/api/project-pipelines") return jsonResponse({ pipelines: [], canManage: true });
      if (url === "/api/pipeline-templates") return jsonResponse({ templates: [], canManage: true });
      if (url === "/api/projects") {
        return jsonResponse({ projects: [{ id: "p1", name: "Some other factory" }] });
      }
      return jsonResponse({});
    }));

    // `null` is the AI Factory starting a new factory: a project concept with
    // no project yet. Selecting against p1 would attach a pipeline to a
    // factory the person is not looking at.
    render(<PipelineTemplatesManager builtIns={builtIns} projectContext={null} />);

    expect(await screen.findByText(/this workspace has none yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use Feature Build" })).toBeDisabled();
    expect(screen.queryByText("Some other factory")).not.toBeInTheDocument();
    expect(posted).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Plan a graph from Feature Build" }));
    const dialog = await screen.findByRole("dialog", { name: "Plan a graph from Feature Build" });
    expect(within(dialog).getByText(/this workspace has none yet/i)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /plan graph/i })).not.toBeInTheDocument();
  });
});
