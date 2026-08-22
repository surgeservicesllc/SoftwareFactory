"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";

import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { stageLabel } from "@/lib/job-seeker/overview";

/**
 * One list for every kind of generated document.
 *
 * Resume Library, Cover Letters and Notes & Documents are the same records
 * filtered by `kind`, so they are one component rather than three that drift.
 * Versions are shown because the table keeps them: a tailored resume is
 * evidence of what was actually sent, and overwriting that history would make
 * "which version did they see?" unanswerable.
 */

type DocumentView = {
  id: string;
  applicationId: string;
  kind: string;
  version: number;
  createdAt: string;
  stage: string | null;
  title: string | null;
  company: string | null;
  preview: string;
  characters: number;
};

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; documents: DocumentView[] };

export function JobSeekerDocumentsPanel({
  documentKind,
  title,
  description,
  emptyHint,
}: {
  /** Null lists every kind, which is what Notes & Documents shows. */
  documentKind: "resume" | "cover_letter" | "answers" | null;
  title: string;
  description: string;
  emptyHint: string;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      const query = documentKind ? `?kind=${encodeURIComponent(documentKind)}` : "";
      const response = await fetch(`/api/job-seeker/documents${query}`, { cache: "no-store" });
      if (!response.ok) {
        setState({ kind: "error" });
        return;
      }
      const body = (await response.json()) as { documents?: DocumentView[] };
      setState({ kind: "ready", documents: body.documents ?? [] });
    } catch {
      setState({ kind: "error" });
    }
  }, [documentKind]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />

      {state.kind === "loading" ? (
        <Card className="grid min-h-40 place-items-center">
          <Loader2 className="size-5 animate-spin text-accent" aria-label={`Loading ${title}`} />
        </Card>
      ) : state.kind === "error" ? (
        <Card className="p-6">
          <h2 className="text-base font-semibold text-foreground">These documents could not be loaded</h2>
          <p className="mt-2 text-sm text-muted">
            The records did not answer. Nothing is listed rather than a list that might be missing
            rows without saying so.
          </p>
          <button type="button" onClick={() => void load()} className="btn btn-secondary btn-sm mt-4">
            Try again
          </button>
        </Card>
      ) : state.documents.length === 0 ? (
        <Card className="p-6">
          <h2 className="text-base font-semibold text-foreground">Nothing here yet</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">{emptyHint}</p>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {state.documents.map((document) => (
            <li key={document.id}>
              <Card className="p-4">
                <div className="flex items-start gap-3">
                  <FileText className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {document.title ?? "Untitled role"}
                    </p>
                    <p className="truncate text-sm text-faint">
                      {document.company ?? "Unknown company"}
                    </p>
                  </div>
                  <StatusBadge tone="neutral" dot={false}>v{document.version}</StatusBadge>
                </div>
                <p className="mt-3 line-clamp-3 text-sm text-muted">{document.preview}</p>
                <p className="mt-3 text-xs text-faint">
                  {documentKind === null ? `${kindLabel(document.kind)} · ` : ""}
                  {document.characters.toLocaleString()} characters
                  {document.stage ? ` · ${stageLabel(document.stage)}` : ""}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function kindLabel(kind: string): string {
  if (kind === "resume") return "Resume";
  if (kind === "cover_letter") return "Cover letter";
  if (kind === "answers") return "Application answers";
  return kind;
}
