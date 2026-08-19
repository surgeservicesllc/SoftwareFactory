import { AiFactoryConsole } from "@/components/ai-factory-console";
import { type PipelineTemplateSummary } from "@/components/pipelines-console";
import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { previewTemplate } from "@/lib/graph/preview";
import { GRAPH_TEMPLATES } from "@/lib/graph/templates";

export const metadata = {
  title: "AI Factory",
};

/**
 * The guided end-to-end journey (owner reference, 2026-08-17): create a
 * project, connect its repository, ready the pipeline, connect and assign
 * bots, configure them, issue a command, and watch it ship — each step the
 * real existing control embedded in place, with completion derived from the
 * live records those controls produce. Built-in templates are compiled
 * server-side on every request — compilation is pure — so the pipeline step
 * states real topology, never a drawing of it.
 */
export default function AiFactoryPage() {
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

  // The header lives in the console, not here: its action is "Create New AI
  // Factory", which needs the client state that decides which factory the
  // journey is showing.
  return <AiFactoryConsole builtIns={templates} />;
}
