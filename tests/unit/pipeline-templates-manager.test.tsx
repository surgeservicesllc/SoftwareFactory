import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PipelineTemplatesManager } from "@/components/pipeline-templates-manager";
import type { PipelineTemplateSummary } from "@/components/pipelines-console";

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
  errors: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PipelineTemplatesManager", () => {
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
    fireEvent.click(within(card).getAllByRole("button", { name: /^Use$/ })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Use Checkout Audit" });
    await waitFor(() => expect(within(dialog).getByLabelText("Project")).toHaveValue("p1"));
    fireEvent.click(within(dialog).getByRole("button", { name: /plan graph/i }));

    await waitFor(() => expect(launches).toHaveLength(1));
    expect(launches[0]).toEqual({ projectId: "p1", templateKey: "checkout_audit" });
    // The result repeats the endpoint's honesty: recorded, not dispatched.
    expect(await within(dialog).findByText(/No node has been dispatched/)).toBeInTheDocument();
  });
});
