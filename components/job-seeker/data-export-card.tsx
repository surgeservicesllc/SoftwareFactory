import { Card, SectionTitle } from "@/components/ui";
import { EXPORT_LIMIT, EXPORT_TABLES, NOT_PERSONAL } from "@/lib/job-seeker/export";

/**
 * Your data is yours (ADR-247): the roster of every table the Job Seeker
 * keeps about a person, and one link that downloads all of it as JSON
 * under their own row-level security. A server component with no state —
 * the link is an ordinary authenticated GET.
 */
export function JobSeekerDataExportCard() {
  return (
    <Card data-testid="data-export">
      <SectionTitle
        title="Your data is yours"
        description="Everything this product keeps about you, downloaded as one JSON file — every row copied as stored, under your own row-level security."
      />
      <a
        href="/api/job-seeker/export"
        download
        className="btn btn-secondary btn-sm mt-3 inline-flex"
      >
        Download everything about you (JSON)
      </a>
      <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm text-[var(--text-muted)] sm:grid-cols-2" data-testid="data-export-roster">
        {EXPORT_TABLES.map((entry) => (
          <li key={entry.table}>{entry.label}</li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-[var(--text-faint)]">
        Up to {EXPORT_LIMIT.toLocaleString()} rows per table; the file&rsquo;s manifest names any table that held more, and any
        that could not be read.{" "}
        {NOT_PERSONAL.map((entry) => `${entry.table}: ${entry.reason}`).join(" ")}
      </p>
    </Card>
  );
}
