"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet, ShieldCheck } from "lucide-react";

import type { AccountView, ImportBatchView } from "@/components/budget/types";
import { Card, EmptyState, SectionTitle } from "@/components/ui";

/**
 * Bringing a bank export in.
 *
 * The file is read on the server, written as rows, and dropped — it is never
 * stored, and nothing about it leaves this application. Re-importing the same
 * file is safe: rows already present are recognised and left alone, so a
 * partial import can simply be run again.
 */

type ImportOutcome = {
  readonly rowsRead: number;
  readonly rowsImported: number;
  readonly rowsSkipped: number;
  readonly sheet: string;
  readonly sheets: readonly string[];
  readonly notices: readonly string[];
  readonly complete: boolean;
};

export function BudgetImportPanel({
  accounts,
  imports,
  onImported,
}: {
  accounts: readonly AccountView[];
  imports: readonly ImportBatchView[];
  onImported: () => void;
}) {
  const [accountId, setAccountId] = useState("");
  const [sheet, setSheet] = useState("");
  const [sheetChoices, setSheetChoices] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    setOutcome(null);

    const file = fileRef.current?.files?.[0];
    if (!file) {
      setMessage("Choose a .xlsx or .csv file to import.");
      return;
    }
    if (!accountId) {
      setMessage("Choose which account this file belongs to.");
      return;
    }

    const body = new FormData();
    body.set("file", file);
    body.set("accountId", accountId);
    if (sheet) body.set("sheet", sheet);

    setBusy(true);
    try {
      const response = await fetch("/api/budget/import", { method: "POST", body });
      const payload = (await response.json().catch(() => null)) as
        | (ImportOutcome & { error?: { message?: string }; sheets?: string[] })
        | null;

      if (!response.ok) {
        // A multi-sheet workbook whose first sheet is not the ledger comes
        // back with the sheet names, so the next attempt can name the right one.
        if (payload?.sheets?.length) setSheetChoices(payload.sheets);
        setMessage(payload?.error?.message ?? "The file could not be imported.");
        return;
      }
      if (payload) {
        setOutcome(payload);
        setSheetChoices(payload.sheets ?? []);
      }
      onImported();
    } catch {
      setMessage("The file could not be imported.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle
          title="Import a statement"
          description="An .xlsx workbook or a .csv export. The sheet needs a description column and an amount column; a date column and a running total are used when present."
        />

        {accounts.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Add an account first"
              description="An import lands in one account, so there has to be one to land in."
              icon={FileSpreadsheet}
            />
          </div>
        ) : (
          <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1.5 block font-medium text-foreground">Account</span>
              <select
                required
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                className="w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-foreground"
              >
                <option value="">Choose an account…</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1.5 block font-medium text-foreground">File</span>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-foreground file:mr-3 file:rounded file:border-0 file:bg-[var(--accent-soft)] file:px-3 file:py-1 file:text-foreground"
              />
            </label>

            {sheetChoices.length > 1 ? (
              <label className="text-sm">
                <span className="mb-1.5 block font-medium text-foreground">Sheet</span>
                <select
                  value={sheet}
                  onChange={(event) => setSheet(event.target.value)}
                  className="w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-foreground"
                >
                  <option value="">First sheet</option>
                  {sheetChoices.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="flex items-end gap-3 sm:col-span-2">
              <button type="submit" disabled={busy} className="btn btn-primary">
                {busy ? "Importing…" : "Import"}
              </button>
              {message ? (
                <p role="alert" className="text-sm text-[var(--danger)]">
                  {message}
                </p>
              ) : null}
            </div>
          </form>
        )}

        <p className="mt-5 flex items-start gap-2 text-xs text-faint">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          The file is read in memory and never stored. Its rows are written to your account only,
          under row-level security that keeps them yours — not visible to anyone else in your
          workspace. Importing the same file twice does not double the ledger.
        </p>
      </Card>

      {outcome ? (
        <Card>
          <SectionTitle
            title={outcome.complete ? "Import finished" : "Import stopped early"}
            description={`Sheet "${outcome.sheet}"`}
          />
          <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-faint">Rows read</dt>
              <dd className="tabular mt-1 text-lg font-semibold text-foreground">
                {outcome.rowsRead.toLocaleString("en-US")}
              </dd>
            </div>
            <div>
              <dt className="text-faint">Imported</dt>
              <dd className="tabular mt-1 text-lg font-semibold text-[var(--accent)]">
                {outcome.rowsImported.toLocaleString("en-US")}
              </dd>
            </div>
            <div>
              <dt className="text-faint">Skipped</dt>
              <dd className="tabular mt-1 text-lg font-semibold text-muted">
                {outcome.rowsSkipped.toLocaleString("en-US")}
              </dd>
            </div>
          </dl>
          {outcome.notices.length > 0 ? (
            <ul className="mt-4 space-y-1.5 text-sm text-muted">
              {outcome.notices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
          ) : null}
          {!outcome.complete ? (
            <p className="mt-4 text-sm text-[var(--warning)]">
              Run the same file again to continue where it left off — the rows already stored will
              be recognised and left alone.
            </p>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <SectionTitle title="Recent imports" />
        {imports.length === 0 ? (
          <p className="mt-4 text-sm text-muted">Nothing imported yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {imports.map((batch) => (
              <li key={batch.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {batch.sourceName}
                    {batch.sheetName ? (
                      <span className="ml-1.5 text-xs text-faint">{batch.sheetName}</span>
                    ) : null}
                  </span>
                  <span className="tabular text-xs text-muted">
                    {batch.rowsImported.toLocaleString("en-US")} imported ·{" "}
                    {batch.rowsSkipped.toLocaleString("en-US")} skipped of{" "}
                    {batch.rowsRead.toLocaleString("en-US")}
                  </span>
                </div>
                {batch.notice ? <p className="mt-1 text-xs text-faint">{batch.notice}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
