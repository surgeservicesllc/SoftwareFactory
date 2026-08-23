import Link from "next/link";

import { AiFactoryConsole } from "@/components/ai-factory-console";
import { FactoryIntake } from "@/components/factory-intake";
import { type PipelineTemplateSummary } from "@/components/pipelines-console";
import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { previewTemplate } from "@/lib/graph/preview";
import { GRAPH_TEMPLATES } from "@/lib/graph/templates";
import { SDLC_LIFECYCLE } from "@/lib/sdlc/lifecycle";

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
      anchorNodeCount: preview.ok ? preview.anchorNodeCount : null,
      compiles: preview.ok,
    };
  });

  /*
   * Two ways in, in the order they should be offered.
   *
   * The intake is first because it is the product's actual promise: describe
   * what you want and the system carries it through ten stages. The guided
   * journey below it is the same factory taken one control at a time, which is
   * what someone wants when the one-sentence path has stopped somewhere and
   * they need to see which piece is missing.
   *
   * The console keeps its own header — its action is "Create New AI Factory",
   * which needs the client state that decides which factory the journey is
   * showing — so this page adds none.
   */
  return (
    <>
      <FactoryIntake />

      <section aria-labelledby="lifecycle-stages" className="card mt-4 p-5">
        <h2 id="lifecycle-stages" className="text-base font-semibold text-foreground">
          The ten stages
        </h2>
        <p className="mt-1 text-sm text-muted">
          Every run moves through these. Open one to see where a run stands in it.
        </p>
        <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {SDLC_LIFECYCLE.map((stage) => (
            <li key={stage.stage}>
              <Link
                href={`/solutions/factory/${stage.slug}`}
                className="block h-full rounded-lg border border-line-strong bg-surface-raised p-3 transition-colors hover:border-[var(--accent-border)]"
              >
                <span className="label">{stage.number}</span>
                <span className="mt-0.5 block font-medium text-foreground">{stage.title}</span>
                <span className="mt-1 block text-xs text-muted">{stage.purpose}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <div className="mt-4">
        <AiFactoryConsole builtIns={templates} />
      </div>
    </>
  );
}
