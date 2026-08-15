import { Workflow } from "lucide-react";

import { Card, SectionTitle, StatusBadge } from "@/components/ui";
import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { previewTemplate } from "@/lib/graph/preview";
import { findTemplate } from "@/lib/graph/templates";

/**
 * What running a graph would involve, shown before it runs.
 *
 * The Bot Manager's job at this point is to make a person's decision an
 * informed one, and the informative facts are how wide the work goes, how many
 * of those nodes call a paid model, and whether anything needs approval. All of
 * it comes from compiling the plan, so it is exact.
 *
 * The one thing it will not show is a cost estimate. Token counts are not
 * knowable before a run, and a confident wrong number would be budgeted against.
 */
export function GraphExecutionSummary({ templateKey }: { templateKey: string }) {
  const template = findTemplate(templateKey);
  if (!template) return null;

  const preview = previewTemplate(template, DEFAULT_GRAPH_BUDGET);

  return (
    <Card className="h-fit p-5">
      <SectionTitle
        title="Before it runs"
        description={`What "${template.name}" would do, compiled from its plan.`}
      />

      {!preview.ok ? (
        <ul className="mt-4 space-y-1 text-sm text-[var(--danger)]">
          {preview.errors.map((error) => (
            <li key={error.code}>{error.detail}</li>
          ))}
        </ul>
      ) : (
        <>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Shape</dt>
              <dd className="text-foreground">{preview.topology}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Nodes</dt>
              <dd className="tabular text-foreground">{preview.nodes.length}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Run at once</dt>
              <dd className="tabular text-foreground">{preview.maxParallelism}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Call a model</dt>
              <dd className="tabular text-foreground">
                {preview.modelNodeCount} of {preview.nodes.length}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Isolated checkouts</dt>
              <dd className="tabular text-foreground">{preview.isolatedWorkspaces}</dd>
            </div>
          </dl>

          <p className="mt-4 text-sm text-muted">{preview.costNote}</p>

          {preview.budgetNote ? (
            <p className="mt-2 text-sm text-muted">{preview.budgetNote}</p>
          ) : null}

          {preview.removedEdges.length > 0 ? (
            <p className="mt-2 text-sm text-muted">
              {preview.removedEdges.length} proposed dependenc
              {preview.removedEdges.length === 1 ? "y was" : "ies were"} found to be imaginary and
              removed, which is what allows {preview.maxParallelism} nodes to run at once.
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <StatusBadge tone="neutral" dot={false}>
              <Workflow className="size-3" aria-hidden="true" />
              Risk {preview.risk}
            </StatusBadge>
            {preview.requiresOwnerApproval ? (
              <StatusBadge tone="warning">Owner approval required</StatusBadge>
            ) : null}
            <StatusBadge tone="warning">Execution Not Connected</StatusBadge>
          </div>

          <p className="mt-3 text-sm text-muted">
            Nothing here has run. No provider credential is configured, so this summary describes
            what would happen rather than what did.
          </p>
        </>
      )}
    </Card>
  );
}
