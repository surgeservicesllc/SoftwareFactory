import { Suspense } from "react";

import { PipelinesConsole, type PipelineTemplateSummary } from "@/components/pipelines-console";
import { Card, PageHeader } from "@/components/ui";
import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { previewTemplate } from "@/lib/graph/preview";
import { GRAPH_TEMPLATES } from "@/lib/graph/templates";

export const metadata = {
  title: "Pipelines",
};

/**
 * The pipeline lifecycle over the records that already govern work: saved
 * commands are the runs, and the graph engine's versioned templates are the
 * templates. Compiled server-side on every request — compilation is pure —
 * so the Templates view states real topology, never a drawing of it.
 */
export default function PipelinesPage() {
  const templates: PipelineTemplateSummary[] = GRAPH_TEMPLATES.map((template) => {
    const preview = previewTemplate(template, DEFAULT_GRAPH_BUDGET);
    return {
      key: template.key,
      name: template.name,
      category: template.category,
      summary: template.summary,
      version: template.version,
      topology: preview.ok ? preview.topology : null,
      nodeCount: preview.ok ? preview.nodes.length : null,
      maxParallelism: preview.ok ? preview.maxParallelism : null,
      compiles: preview.ok,
    };
  });

  return (
    <>
      <PageHeader
        title="Pipelines"
        description="Every goal you submit runs the same lifecycle: verified intake, queue, worker execution, draft pull request. Watch it here."
      />
      <Suspense
        fallback={
          <Card className="min-h-64 animate-pulse">
            <span className="sr-only">Loading pipelines</span>
          </Card>
        }
      >
        <PipelinesConsole templates={templates} />
      </Suspense>
    </>
  );
}
