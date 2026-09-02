/**
 * Your data is yours (ADR-247): the roster of every table the Job Seeker
 * writes about a person, and the manifest the export prints beside the
 * rows. The roster is the contract — a new personal table is added here
 * or the export silently stops covering it, and the roster test pins the
 * table census so that omission fails loudly.
 *
 * Two tables are deliberately not personal rows and are named as such in
 * the manifest: the posting sightings ledger holds public facts about
 * postings (one row per URL, shared by everyone), and the bytes of an
 * uploaded file are downloaded per file from the Resumes page rather
 * than inlined into a JSON document.
 */

export const EXPORT_LIMIT = 5_000;

export type ExportTable = Readonly<{
  table: string;
  label: string;
  /** Explicit columns when a table carries a blob; "*" otherwise. */
  columns: string;
  orderBy: string;
}>;

export const EXPORT_TABLES: readonly ExportTable[] = [
  { table: "job_seeker_profiles", label: "Career Profile", columns: "*", orderBy: "created_at" },
  { table: "job_seeker_preferences", label: "Job Preferences", columns: "*", orderBy: "created_at" },
  { table: "job_seeker_jobs", label: "Recorded jobs", columns: "*", orderBy: "discovered_at" },
  { table: "job_seeker_matches", label: "Match verdicts", columns: "*", orderBy: "created_at" },
  { table: "job_seeker_applications", label: "Applications", columns: "*", orderBy: "created_at" },
  { table: "job_seeker_application_transitions", label: "Application transitions", columns: "*", orderBy: "created_at" },
  { table: "job_seeker_contacts", label: "Contacts", columns: "*", orderBy: "created_at" },
  { table: "job_seeker_outreach", label: "Outreach drafts and messages", columns: "*", orderBy: "created_at" },
  { table: "job_seeker_documents", label: "Generated documents", columns: "*", orderBy: "created_at" },
  {
    table: "job_seeker_uploads",
    label: "Uploaded files (metadata; the bytes are downloaded per file)",
    columns: "id, organization_id, user_id, kind, filename, content_type, byte_size, created_at",
    orderBy: "created_at",
  },
  { table: "job_seeker_resume_extractions", label: "Resume reviews", columns: "*", orderBy: "created_at" },
  { table: "job_seeker_screening_answers", label: "Screening answers", columns: "*", orderBy: "created_at" },
  { table: "job_seeker_saved_searches", label: "Saved searches", columns: "*", orderBy: "created_at" },
  { table: "job_seeker_search_alerts", label: "Search alerts", columns: "*", orderBy: "created_at" },
  { table: "job_seeker_alert_deliveries", label: "Alert deliveries", columns: "*", orderBy: "created_at" },
  { table: "job_seeker_result_marks", label: "Viewed and dismissed results", columns: "*", orderBy: "created_at" },
  { table: "job_seeker_search_events", label: "Search metering events", columns: "*", orderBy: "created_at" },
];

/** Tables under the job_seeker prefix that hold no personal rows, with the reason. */
export const NOT_PERSONAL: ReadonlyArray<Readonly<{ table: string; reason: string }>> = [
  {
    table: "job_seeker_posting_sightings",
    reason: "Public facts about postings (one row per URL, shared by everyone); nothing in it is about you.",
  },
];

export type TableOutcome = Readonly<{
  table: string;
  label: string;
  rows: number;
  /** True when the table held more rows than the export carries. */
  truncated: boolean;
  /** Null when the table was read; otherwise why it was not. */
  error: string | null;
}>;

export type ExportManifest = Readonly<{
  exportedAt: string;
  limitPerTable: number;
  tables: TableOutcome[];
  notPersonal: typeof NOT_PERSONAL;
  basis: string;
}>;

export const EXPORT_BASIS =
  "Every row is read under your own row-level security and copied as stored — no field is reworded, summarised or withheld. A table that could not be read is named with the reason rather than silently left out.";

export function buildManifest(outcomes: readonly TableOutcome[], now: Date = new Date()): ExportManifest {
  return {
    exportedAt: now.toISOString(),
    limitPerTable: EXPORT_LIMIT,
    tables: [...outcomes],
    notPersonal: NOT_PERSONAL,
    basis: EXPORT_BASIS,
  };
}

export function exportFilename(now: Date = new Date()): string {
  return `job-seeker-export-${now.toISOString().slice(0, 10)}.json`;
}
