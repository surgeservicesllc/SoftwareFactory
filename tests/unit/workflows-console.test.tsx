// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { WorkflowsConsole, type TemplateSummary } from "@/components/workflows-console";
import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { previewTemplate } from "@/lib/graph/preview";
import { findTemplate, GRAPH_TEMPLATES } from "@/lib/graph/templates";

function summarize(key: string): TemplateSummary {
  const template = findTemplate(key)!;
  const preview = previewTemplate(template, DEFAULT_GRAPH_BUDGET);
  return {
    key: template.key,
    name: template.name,
    category: template.category,
    summary: template.summary,
    version: template.version,
    preview: preview.ok ? preview : null,
    compileErrors: preview.ok ? [] : preview.errors.map((error) => error.detail),
  };
}

const templates = GRAPH_TEMPLATES.map((template) => summarize(template.key));

describe("the workflows console", () => {
  it("renders the compiled shape rather than a placeholder", () => {
    render(<WorkflowsConsole templates={[summarize("security_audit")]} />);

    expect(screen.getByText("DIAMOND")).toBeInTheDocument();
    // Five independent inspectors is a computed fact, not a caption.
    expect(screen.getByText("Parallel width").closest("article")).toHaveTextContent("5");
  });

  it("offers the launch before the preview, and points run evidence at the runs panel", () => {
    render(<WorkflowsConsole templates={[summarize("rls_audit")]} />);

    // The owner-reported failure mode of this page was "can't reach the
    // Launch card": it rendered below the metrics, the rationale, the graph
    // map and two more panels. Choosing a template must offer the launch
    // immediately.
    const launch = screen.getByText("Launch this graph");
    const map = screen.getByText("The graph");
    expect(
      launch.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the launch card must precede the graph map",
    ).toBeTruthy();

    // No fabricated run history in either direction: evidence lives with the
    // runs, and the console says where.
    expect(screen.getByRole("link", { name: /pipelines page/i })).toHaveAttribute(
      "href",
      "/solutions/pipelines",
    );
    expect(screen.queryByText("No graph has ever run")).not.toBeInTheDocument();
  });

  it("never shows a cost estimate", () => {
    render(<WorkflowsConsole templates={templates} />);

    expect(screen.getByText(/cost cannot be stated before the run/i)).toBeInTheDocument();
    expect(screen.queryByText(/estimated cost/i)).not.toBeInTheDocument();
  });

  it("shows a node's contract when it is selected", async () => {
    const user = userEvent.setup();
    render(<WorkflowsConsole templates={[summarize("rls_audit")]} />);

    await user.click(screen.getByRole("button", { name: /^coverage/ }));

    const detail = screen.getByText("Node detail").closest("section")!;
    expect(within(detail).getByText(/Find any public table without RLS/i)).toBeInTheDocument();
    expect(within(detail).getByText(/starts as soon as the graph does/i)).toBeInTheDocument();
  });

  it("switches templates and clears the selected node", async () => {
    const user = userEvent.setup();
    render(<WorkflowsConsole templates={templates} />);

    await user.click(screen.getByRole("button", { name: /^RLS Audit/ }));
    await user.click(screen.getByRole("button", { name: /^coverage/ }));
    expect(screen.getByText(/Find any public table without RLS/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Bug Sweep/ }));
    // A node from the previous template must not stay selected.
    expect(screen.getByText("No node selected.")).toBeInTheDocument();
  });

  it("explains an empty removed-dependency panel instead of showing zero", () => {
    render(<WorkflowsConsole templates={[summarize("rls_audit")]} />);

    expect(
      screen.getByText(/proposed no dependency that turned out to be imaginary/i),
    ).toBeInTheDocument();
  });

  it("reports compile errors rather than rendering an empty graph", () => {
    render(
      <WorkflowsConsole
        templates={[
          {
            key: "broken",
            name: "Broken",
            category: "AUDIT",
            summary: "A template that cannot compile.",
            version: 1,
            preview: null,
            compileErrors: ["These nodes wait on each other: a → b → a."],
          },
        ]}
      />,
    );

    expect(screen.getByText("This template does not compile")).toBeInTheDocument();
    expect(screen.getByText(/wait on each other/)).toBeInTheDocument();
  });

  it("handles an empty catalogue", () => {
    render(<WorkflowsConsole templates={[]} />);
    expect(screen.getByText("No templates")).toBeInTheDocument();
  });
});
