"use client";

import { Database, Download, GitMerge, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Card, EmptyState, MetricCard, PageHeader, SectionTitle } from "@/components/ui";
import { IMPORT_FIELDS, parseCsv, type ImportField } from "@/lib/services/data-import";

/**
 * Your data: bring a spreadsheet in without inventing a column, merge two
 * records of one customer with every re-pointed row counted, and take the
 * whole book out table by table. Nothing here is a vendor's convenience;
 * it is the customer's property, and the page treats it that way.
 */

type Manifest = { tables: Array<{ table: string; rows: number | null; error: string | null }>; totalRows: number };
type AccountHit = { id: string; name: string; kind: string; status: string };
type DryRun = {
  dryRun: boolean;
  importId?: string;
  created?: { accounts: number; properties: number; contacts: number };
  rowCount: number;
  wouldCreate: { accounts: number; properties: number; contacts: number };
  duplicates: Array<{ line: number; name: string; matches: string; on: string }>;
  duplicatesInFile: Array<{ line: number; ofLine: number; on: string }>;
  invalid: Array<{ line: number; reason: string }>;
};
type Mapping = Record<string, ImportField | "ignore">;

async function readFailure(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}

/** A first guess at the mapping from the header text; every guess is shown and editable. */
function guessField(header: string): ImportField | "ignore" {
  const h = header.toLowerCase();
  if (h.includes("first")) return "contact.first_name";
  if (h.includes("last") || h.includes("surname")) return "contact.last_name";
  if (/^(company|account|customer|business|client|organi[sz]ation)$/.test(h) || /name$/.test(h)) return "account.name";
  if (h.includes("kind") || h.includes("type")) return "account.kind";
  if (h.includes("status") || h.includes("stage")) return "account.status";
  if (h.includes("contact") && h.includes("email")) return "contact.email";
  if (h.includes("contact") && h.includes("phone")) return "contact.phone";
  if (h.includes("email")) return "account.email";
  if (h.includes("phone") || h.includes("mobile")) return "account.phone";
  if (h.includes("source") || h.includes("referr")) return "account.source";
  if (h.includes("billing")) return "account.billing_address";
  if (h.includes("service") && h.includes("address")) return "property.address";
  if (h.includes("address") || h.includes("street")) return "property.address";
  if (h.includes("location") || h.includes("site")) return "property.label";
  if (h.includes("note")) return "account.notes";
  return "ignore";
}

export function ServicesDataPanel() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestError, setManifestError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const [csv, setCsv] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [sourceLabel, setSourceLabel] = useState("");
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [report, setReport] = useState<DryRun | null>(null);

  const [survivorQuery, setSurvivorQuery] = useState("");
  const [loserQuery, setLoserQuery] = useState("");
  const [survivorHits, setSurvivorHits] = useState<AccountHit[]>([]);
  const [loserHits, setLoserHits] = useState<AccountHit[]>([]);
  const [survivor, setSurvivor] = useState<AccountHit | null>(null);
  const [loser, setLoser] = useState<AccountHit | null>(null);
  const [mergeResult, setMergeResult] = useState<Record<string, number> | null>(null);

  const loadManifest = useCallback(async () => {
    setManifestError("");
    try {
      const response = await fetch("/api/services/data/export", { cache: "no-store" });
      if (!response.ok) {
        setManifestError(await readFailure(response, "The export manifest could not be read."));
        return;
      }
      setManifest((await response.json()) as Manifest);
    } catch {
      setManifestError("The export manifest could not be read.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void loadManifest(), 0);
    return () => window.clearTimeout(kickoff);
  }, [loadManifest]);

  function takeCsv(text: string) {
    setCsv(text);
    setReport(null);
    const parsed = parseCsv(text);
    const found = (parsed[0] ?? []).map((header) => header.trim()).filter((header) => header.length > 0);
    setHeaders(found);
    setMapping(Object.fromEntries(found.map((header) => [header, guessField(header)])));
  }

  async function runImport(dryRun: boolean) {
    if (busy || csv.trim().length === 0) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/services/data/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          csv,
          mapping,
          sourceLabel: sourceLabel.trim() || "CSV import",
          dryRun,
          allowDuplicates,
        }),
      });
      if (!response.ok) {
        setMessage(await readFailure(response, "The import could not be run."));
        return;
      }
      setReport((await response.json()) as DryRun);
      if (!dryRun) await loadManifest();
    } catch {
      setMessage("The import could not be run.");
    } finally {
      setBusy(false);
    }
  }

  async function search(query: string, into: (hits: AccountHit[]) => void) {
    if (query.trim().length < 2) {
      into([]);
      return;
    }
    try {
      const response = await fetch(`/api/services/accounts?q=${encodeURIComponent(query.trim())}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) return;
      const body = (await response.json()) as { accounts?: AccountHit[] };
      into((body.accounts ?? []).slice(0, 8));
    } catch {
      into([]);
    }
  }

  async function merge() {
    if (!survivor || !loser || busy) return;
    setBusy(true);
    setMessage("");
    setMergeResult(null);
    try {
      const response = await fetch("/api/services/data/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ survivorId: survivor.id, loserId: loser.id }),
      });
      if (!response.ok) {
        setMessage(await readFailure(response, "The accounts could not be merged."));
        return;
      }
      const body = (await response.json()) as { counts: Record<string, number> };
      setMergeResult(body.counts);
      setLoser(null);
      setLoserQuery("");
      setLoserHits([]);
    } catch {
      setMessage("The accounts could not be merged.");
    } finally {
      setBusy(false);
    }
  }

  const movedLines = mergeResult
    ? Object.entries(mergeResult).filter(([, count]) => Number(count) > 0)
    : [];

  return (
    <div className="space-y-6" data-testid="services-data">
      <PageHeader
        title="Your data"
        description="Bring a spreadsheet in without a single invented column, merge two records of one customer with every moved row counted, and take the whole book out — it is yours."
      />
      {message ? <p role="alert" className="text-sm text-[var(--danger)]">{message}</p> : null}

      <Card>
        <SectionTitle
          title="Import a spreadsheet"
          description="Paste or choose a CSV. Every column must be mapped to a field this product has, or ignored, before anything is written — a dry run shows exactly what would happen."
        />
        <div className="mt-3 grid gap-2">
          <input
            aria-label="CSV file"
            type="file"
            accept=".csv,text/csv"
            className="text-sm"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file.text().then(takeCsv);
            }}
          />
          <textarea
            aria-label="CSV text"
            className="min-h-28 rounded border border-[var(--border)] bg-transparent px-3 py-2 font-mono text-xs"
            placeholder={"name,email,phone,address\nRidgeway Bakery,owner@ridgeway.example,555-0100,1 Loaf Lane 93940"}
            value={csv}
            onChange={(event) => takeCsv(event.target.value)}
          />
        </div>
        {headers.length > 0 ? (
          <div className="mt-3">
            <p className="text-sm font-medium">Map every column</p>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2" data-testid="import-mapping">
              {headers.map((header) => (
                <li key={header} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{header}</span>
                  <select
                    aria-label={`Field for ${header}`}
                    className="rounded border border-[var(--border)] bg-transparent px-2 py-1 text-xs"
                    value={mapping[header] ?? "ignore"}
                    onChange={(event) =>
                      setMapping((current) => ({ ...current, [header]: event.target.value as ImportField | "ignore" }))}
                  >
                    <option value="ignore">Ignore this column</option>
                    {IMPORT_FIELDS.map((field) => (
                      <option key={field.key} value={field.key}>{field.label}</option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                aria-label="Import label"
                className="rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
                placeholder="Where this file came from"
                value={sourceLabel}
                maxLength={160}
                onChange={(event) => setSourceLabel(event.target.value)}
              />
              <label className="flex items-center gap-1 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={allowDuplicates}
                  onChange={(event) => setAllowDuplicates(event.target.checked)}
                />
                create accounts that look like existing ones anyway
              </label>
              <button
                type="button"
                disabled={busy}
                className="rounded border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50"
                onClick={() => void runImport(true)}
              >
                Dry run
              </button>
              <button
                type="button"
                disabled={busy || report === null || report.dryRun === false}
                className="rounded bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50"
                onClick={() => void runImport(false)}
              >
                <Upload className="mr-1 inline size-4" aria-hidden="true" />
                Import
              </button>
            </div>
          </div>
        ) : null}
        {report ? (
          <div className="mt-4 space-y-2 text-sm" data-testid="import-report" role="status">
            <p className="font-medium">
              {report.dryRun
                ? `Dry run: ${report.wouldCreate.accounts} account${report.wouldCreate.accounts === 1 ? "" : "s"}, ${report.wouldCreate.properties} location${report.wouldCreate.properties === 1 ? "" : "s"} and ${report.wouldCreate.contacts} contact${report.wouldCreate.contacts === 1 ? "" : "s"} would be created from ${report.rowCount} row${report.rowCount === 1 ? "" : "s"}. Nothing was written.`
                : `Imported: ${report.created?.accounts ?? 0} accounts, ${report.created?.properties ?? 0} locations, ${report.created?.contacts ?? 0} contacts. Recorded as import ${report.importId ?? ""}.`}
            </p>
            {report.duplicates.length > 0 ? (
              <div>
                <p className="text-muted">{report.duplicates.length} row{report.duplicates.length === 1 ? "" : "s"} match an account already on file and {report.dryRun ? "would be" : "were"} skipped:</p>
                <ul className="ml-4 list-disc text-xs text-muted">
                  {report.duplicates.slice(0, 20).map((entry) => (
                    <li key={entry.line}>line {entry.line}: {entry.name} — same {entry.on} as {entry.matches}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {report.duplicatesInFile.length > 0 ? (
              <p className="text-muted">{report.duplicatesInFile.length} row{report.duplicatesInFile.length === 1 ? "" : "s"} repeat an earlier row of the same file.</p>
            ) : null}
            {report.invalid.length > 0 ? (
              <div>
                <p className="text-[var(--danger)]">{report.invalid.length} row{report.invalid.length === 1 ? "" : "s"} could not be read:</p>
                <ul className="ml-4 list-disc text-xs text-muted">
                  {report.invalid.slice(0, 20).map((entry) => (
                    <li key={entry.line}>line {entry.line}: {entry.reason}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card>
        <SectionTitle
          title="Merge two records of one customer"
          description="Every contact, location, visit, document and invoice moves to the account that stays. The other stays readable, inactive, pointing at where it went; both histories keep a line saying so."
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {([
            ["survivor", "Account that stays", survivorQuery, setSurvivorQuery, survivorHits, setSurvivorHits, survivor, setSurvivor],
            ["loser", "Account merged into it", loserQuery, setLoserQuery, loserHits, setLoserHits, loser, setLoser],
          ] as const).map(([key, label, query, setQuery, hits, setHits, chosen, choose]) => (
            <div key={key}>
              <label className="text-sm font-medium" htmlFor={`merge-${key}`}>{label}</label>
              <input
                id={`merge-${key}`}
                className="mt-1 w-full rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
                placeholder="Search by name"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  choose(null);
                  void search(event.target.value, setHits);
                }}
              />
              {chosen ? (
                <p className="mt-1 text-xs text-muted">Chosen: {chosen.name} ({chosen.kind}, {chosen.status})</p>
              ) : hits.length > 0 ? (
                <ul className="mt-1 divide-y divide-[var(--border)] rounded border border-[var(--border)]">
                  {hits.map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--surface-raised)]"
                        onClick={() => {
                          choose(hit);
                          setQuery(hit.name);
                          setHits([]);
                        }}
                      >
                        {hit.name} <span className="text-xs text-faint">{hit.kind} · {hit.status}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy || !survivor || !loser || survivor.id === loser.id}
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50"
            onClick={() => {
              if (survivor && loser && window.confirm(`Merge ${loser.name} into ${survivor.name}? This cannot be undone.`)) {
                void merge();
              }
            }}
          >
            <GitMerge className="mr-1 inline size-4" aria-hidden="true" />
            Merge
          </button>
          {mergeResult ? (
            <p className="text-sm text-muted" role="status" data-testid="merge-result">
              Merged. Moved: {movedLines.length === 0 ? "nothing needed moving" : movedLines.map(([key, count]) => `${count} ${key}`).join(", ")}.
            </p>
          ) : null}
        </div>
      </Card>

      <Card>
        <SectionTitle
          title="Export the whole book"
          description="Every table this product keeps about your workspace, as JSON, read through the same policies the pages use. Yours to take anywhere."
        />
        {manifestError ? <p role="alert" className="mt-2 text-sm text-[var(--danger)]">{manifestError}</p> : null}
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <MetricCard
            label="Tables"
            value={manifest ? String(manifest.tables.length) : "—"}
            detail="Covered by the export"
            icon={Database}
          />
          <MetricCard
            label="Rows"
            value={manifest ? manifest.totalRows.toLocaleString("en-US") : "—"}
            detail="Across the whole book, as you may read it"
            icon={Download}
          />
        </div>
        {manifest === null ? null : manifest.tables.length === 0 ? (
          <EmptyState title="Nothing to export" description="No tables are in scope." icon={Database} />
        ) : (
          <ul className="mt-3 grid gap-1 sm:grid-cols-2 lg:grid-cols-3" data-testid="export-tables">
            {manifest.tables.map((entry) => (
              <li key={entry.table} className="flex items-center justify-between gap-2 rounded border border-[var(--border)] px-3 py-1.5 text-xs">
                <span className="font-mono">{entry.table}</span>
                <span className="text-faint">{entry.rows === null ? "unreadable" : entry.rows.toLocaleString("en-US")}</span>
                <a
                  className="underline"
                  href={`/api/services/data/export/${entry.table}`}
                  download={`${entry.table}.json`}
                >
                  Download
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
