import { ArrowRight, Briefcase, Factory } from "lucide-react";

import { Card, StatusBadge } from "@/components/ui";

/**
 * The two product cards the chooser is built around.
 *
 * Separated from the page so the layout can be measured. `/decision` is
 * hard-gated — signed out it redirects — so the width sweep cannot navigate to
 * it without destroying its own execution context. A presentational component
 * can be rendered in the browser harness instead, which is what makes this
 * grid measured at all eight widths rather than exempted from the contract.
 *
 * Each choice is a form rather than a link, and the reason is not stylistic: a
 * link would be prefetched, and the action behind it closes the one-time gate,
 * so a prefetch would dismiss the chooser before the person had chosen.
 */

/** A form action. Server Actions taking no arguments satisfy it. */
export type DecisionChoice = (formData: FormData) => void | Promise<void>;

const products = [
  {
    key: "software-factory",
    tag: "BUILD",
    tone: "safe" as const,
    icon: Factory,
    title: "AI Software Factory",
    summary:
      "Turn a goal into reviewed work. Connect a repository, issue a command, and follow every step the factory takes — planning, analysis, and the artifacts it produces.",
    points: [
      "Projects bound to real GitHub repositories",
      "Pipelines you can watch, stop, and delete",
      "An audit record for every state change",
    ],
    cta: "Open the Software Factory",
  },
  {
    key: "job-seeker",
    tag: "GROW",
    tone: "info" as const,
    icon: Briefcase,
    title: "AI Job Seeker",
    summary:
      "Run your search the way the factory runs a build. Track applications, keep your materials current, and see what you sent where.",
    points: [
      "Applications, contacts, and materials in one place",
      "Private to you, even inside your own workspace",
      "The same audit trail the rest of the platform keeps",
    ],
    cta: "Open Job Seeker",
  },
] as const;

export function DecisionProductCards({
  onChooseSoftwareFactory,
  onChooseJobSeeker,
}: {
  onChooseSoftwareFactory: DecisionChoice;
  onChooseJobSeeker: DecisionChoice;
}) {
  const actions: Record<string, DecisionChoice> = {
    "software-factory": onChooseSoftwareFactory,
    "job-seeker": onChooseJobSeeker,
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {products.map((product) => (
        <Card key={product.key} className="flex flex-col p-5">
          <div className="flex items-start justify-between gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-surface-raised">
              <product.icon className="size-5 text-accent" aria-hidden="true" />
            </span>
            <StatusBadge tone={product.tone} dot={false}>{product.tag}</StatusBadge>
          </div>

          <h2 className="mt-4 text-lg font-semibold tracking-[-0.01em] text-foreground">
            {product.title}
          </h2>
          <p className="mt-2 text-sm text-muted">{product.summary}</p>

          <ul className="mt-4 flex-1 space-y-1.5">
            {product.points.map((point) => (
              <li key={point} className="flex items-start gap-2 text-sm text-muted">
                <span
                  className="mt-[0.4rem] size-1.5 shrink-0 rounded-full bg-accent"
                  aria-hidden="true"
                />
                {point}
              </li>
            ))}
          </ul>

          <form action={actions[product.key]} className="mt-5">
            <button type="submit" className="btn btn-primary w-full justify-center">
              {product.cta}
              <ArrowRight className="size-4" aria-hidden="true" />
            </button>
          </form>
        </Card>
      ))}
    </div>
  );
}
