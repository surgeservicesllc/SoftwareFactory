import { Card, DemoNotice, PageHeader, SectionTitle } from "@/components/ui";

const headlineNumbers = [
  ["Tasks completed", "8"],
  ["PRs created", "3"],
  ["PRs merged", "2"],
  ["Deployments", "2"],
  ["Rollbacks", "0"],
  ["Bugs fixed", "5"],
  ["Tests passed", "42"],
  ["Issues found", "6"],
  ["Security findings", "2"],
] as const;

const blockers = [
  ["Medium-severity dependency advisory", "You choose when this gets patched."],
  ["Overly broad example OAuth scope", "Narrow the scope before integrating."],
  ["Database change awaiting approval", "Nothing is built until you review it."],
] as const;

const decisions = [
  "Approve or reject the database performance change.",
  "Set a deadline for the two security findings.",
  "Confirm whether speed or reliability leads next sprint.",
] as const;

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Daily report"
        description="What got done yesterday, what is blocked, and what needs a decision from you."
      />

      <DemoNotice>
        This report was written from example data. No connected agent or provider produced it.
      </DemoNotice>

      <Card className="p-5 sm:p-6">
        <p className="text-sm text-faint">12 Aug 2026</p>
        <h2 className="mt-2 text-balance text-xl font-semibold text-foreground">
          Delivery stayed stable. Security and one release decision need you.
        </h2>
        <p className="mt-3 text-muted">
          Eight tasks finished, three pull requests opened, nothing rolled back. Two security findings
          are still open and one decision is holding up the next milestone.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {headlineNumbers.map(([label, value]) => (
            <div key={label} className="card-inset p-3">
              <p className="tabular text-2xl font-semibold text-foreground">{value}</p>
              <p className="mt-1 text-sm text-muted">{label}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle title="What is blocked" description="Things stopping the next safe move." />
          <ul className="mt-4 space-y-2">
            {blockers.map(([title, detail]) => (
              <li key={title} className="rounded-lg border border-line p-3">
                <p className="text-sm font-medium text-foreground">{title}</p>
                <p className="mt-1 text-sm text-muted">{detail}</p>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5">
          <SectionTitle title="Your decisions" description="Choices the factory will not make for you." />
          <ol className="mt-4 space-y-2">
            {decisions.map((decision, index) => (
              <li key={decision} className="flex gap-3 rounded-lg border border-line p-3">
                <span
                  className="tabular grid size-6 shrink-0 place-items-center rounded-full border border-line-strong text-xs font-semibold text-muted"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <p className="text-sm text-muted">{decision}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <p className="mt-6 text-sm text-muted">
        A real report will count only what your own audit records prove, and will say how fresh that
        data is.
      </p>
    </>
  );
}
