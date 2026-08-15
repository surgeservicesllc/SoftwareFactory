import { Workflow } from "lucide-react";

import { Notice, PageHeader } from "@/components/ui";
import { WorkflowsConsole, type TemplateSummary } from "@/components/workflows-console";
import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { previewTemplate } from "@/lib/graph/preview";
import { GRAPH_TEMPLATES } from "@/lib/graph/templates";

export const metadata = {
  title: "Workflows",
};

/**
 * Workflows.
 *
 * Compiled on the server on every request, which is affordable because
 * compilation is pure: no I/O, no clock, no network, no credential. That is
 * what lets this page show the real topology, the real parallel width and the
 * real removed dependencies rather than a drawing of them.
 */
export default function WorkflowsPage() {
  const templates: TemplateSummary[] = GRAPH_TEMPLATES.map((template) => {
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
  });

  return (
    <>
      <PageHeader
        title="Workflows"
        description="What a graph would do before it does it: the shape the compiler chose, the dependencies it removed, and which nodes can safely run at once."
      />

      <Notice tone="warning" icon={Workflow}>
        Every graph below is compiled, not run. The topology, node contracts, lock waves and removed
        dependencies are exact — they are produced by the same code that would schedule the work. No
        provider credential is configured, so nothing has executed and no run evidence exists.
      </Notice>

      <WorkflowsConsole templates={templates} />
    </>
  );
}
