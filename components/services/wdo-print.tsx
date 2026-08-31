"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * An issued WDO report, laid out to be printed.
 *
 * "PDF rendering" here is the browser's own print-to-PDF over a page
 * designed for paper — no server-side renderer is connected and none is
 * pretended. What matters is that the printed page carries exactly what
 * the report carries: the not-null verdict, the areas that could NOT be
 * inspected (their absence from a printed report is how inspections get
 * misread), every finding with its diagram mark, and a DRAFT banner on
 * anything unissued so a work-in-progress cannot circulate as a report.
 */

type Inspection = {
  id: string;
  reportNumber: string;
  inspectedOn: string;
  structuresInspected: string;
  visibleEvidence: boolean;
  obstructions: string | null;
  inaccessibleAreas: string | null;
  recommendation: string | null;
  diagramKind: string;
  status: string;
  issuedAt: string | null;
};

type Finding = {
  id: string;
  kind: string;
  organism: string | null;
  area: string;
  positionX: number | null;
  positionY: number | null;
  placed: boolean;
  adverse: boolean;
  note: string | null;
  treatmentNote: string | null;
};

const KIND_LABEL: Record<string, string> = {
  live_infestation: "Live infestation",
  visible_damage: "Visible damage",
  previous_infestation: "Previous infestation",
  previous_treatment: "Previous treatment",
  conducive_condition: "Conducive condition",
};

export function WdoPrintView({ inspectionId }: { inspectionId: string }) {
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [findings, setFindings] = useState<readonly Finding[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    try {
      const [listResponse, findingsResponse] = await Promise.all([
        fetch("/api/services/wdo", { headers: { accept: "application/json" }, cache: "no-store" }),
        fetch(`/api/services/wdo/${inspectionId}/findings`, { cache: "no-store" }),
      ]);
      if (!listResponse.ok || !findingsResponse.ok) {
        setState("error");
        return;
      }
      const listBody = (await listResponse.json()) as { inspections?: Inspection[] };
      const found = (listBody.inspections ?? []).find((row) => row.id === inspectionId) ?? null;
      const findingsBody = (await findingsResponse.json()) as { findings?: Finding[] };
      if (!found) {
        setState("error");
        return;
      }
      setInspection(found);
      setFindings(findingsBody.findings ?? []);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [inspectionId]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);

  if (state === "loading") {
    return <p className="p-8 text-sm text-muted">Preparing the report…</p>;
  }
  if (state === "error" || !inspection) {
    return (
      <p role="alert" className="p-8 text-sm text-[var(--danger)]">
        That report could not be loaded, or it is not yours to print.
      </p>
    );
  }

  const placed = findings.filter(
    (finding) => finding.placed && finding.positionX !== null && finding.positionY !== null,
  );
  const isDraft = inspection.issuedAt === null;

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-black print:p-0" data-testid="wdo-print">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
        }
      `}</style>

      <div className="no-print mb-6 flex items-center justify-between gap-3 rounded border border-neutral-300 p-3">
        <p className="text-sm text-neutral-600">
          Use your browser&apos;s Print (Ctrl/Cmd+P) to save this as a PDF — the rendering happens
          on your machine, not on a server.
        </p>
        <button
          type="button"
          className="rounded bg-neutral-900 px-4 py-2 text-sm text-white"
          onClick={() => window.print()}
        >
          Print
        </button>
      </div>

      {isDraft ? (
        <p className="mb-4 border-2 border-dashed border-red-600 p-2 text-center text-sm font-bold uppercase tracking-widest text-red-600">
          Draft — not an issued report
        </p>
      ) : null}

      <header className="border-b-2 border-black pb-4">
        <h1 className="text-xl font-bold">Wood-Destroying Organism Inspection Report</h1>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <div>
            <dt className="inline font-semibold">Report number: </dt>
            <dd className="inline">{inspection.reportNumber}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">Inspected on: </dt>
            <dd className="inline">{inspection.inspectedOn}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">Issued: </dt>
            <dd className="inline">{inspection.issuedAt ? inspection.issuedAt.slice(0, 10) : "Not issued"}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">Structures inspected: </dt>
            <dd className="inline">{inspection.structuresInspected}</dd>
          </div>
        </dl>
      </header>

      <section className="mt-4">
        <h2 className="text-base font-bold">Verdict</h2>
        <p className="mt-1 text-sm">
          {inspection.visibleEvidence
            ? "Visible evidence of wood-destroying organisms WAS found. The findings below are the record."
            : "No visible evidence of wood-destroying organisms was found in the areas that could be inspected."}
        </p>
      </section>

      <section className="mt-4">
        <h2 className="text-base font-bold">Areas that could not be inspected</h2>
        <p className="mt-1 text-sm">
          {inspection.inaccessibleAreas
            ?? "None recorded — every area of the structures named above was accessible."}
        </p>
        {inspection.obstructions ? (
          <p className="mt-1 text-sm">
            <span className="font-semibold">Obstructions: </span>
            {inspection.obstructions}
          </p>
        ) : null}
      </section>

      <section className="mt-4">
        <h2 className="text-base font-bold">Findings ({findings.length})</h2>
        {findings.length === 0 ? (
          <p className="mt-1 text-sm">No findings were recorded.</p>
        ) : (
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-black text-left">
                <th className="py-1 pr-2 font-semibold">#</th>
                <th className="py-1 pr-2 font-semibold">Kind</th>
                <th className="py-1 pr-2 font-semibold">Area</th>
                <th className="py-1 pr-2 font-semibold">Organism</th>
                <th className="py-1 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((finding, index) => (
                <tr key={finding.id} className="border-b border-neutral-300 align-top">
                  <td className="py-1 pr-2">{index + 1}</td>
                  <td className="py-1 pr-2">{KIND_LABEL[finding.kind] ?? finding.kind}</td>
                  <td className="py-1 pr-2">{finding.area}</td>
                  <td className="py-1 pr-2">{finding.organism ?? "—"}</td>
                  <td className="py-1">
                    {[finding.note, finding.treatmentNote ? `Treatment: ${finding.treatmentNote}` : null]
                      .filter(Boolean)
                      .join(" ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-4">
        <h2 className="text-base font-bold">Diagram ({inspection.diagramKind})</h2>
        {placed.length === 0 ? (
          <p className="mt-1 text-sm">
            No findings are placed on the diagram
            {findings.length > 0 ? " — the table above is the complete record" : ""}.
          </p>
        ) : (
          <svg
            viewBox="0 0 100 60"
            role="img"
            aria-label={`Structure diagram with ${placed.length} placed finding${placed.length === 1 ? "" : "s"}`}
            className="mt-2 w-full border border-black"
          >
            {placed.map((finding) => {
              const index = findings.findIndex((row) => row.id === finding.id) + 1;
              return (
                <g key={finding.id}>
                  <circle
                    cx={(finding.positionX as number) * 100}
                    cy={(finding.positionY as number) * 60}
                    r={2.2}
                    fill={finding.adverse ? "#b91c1c" : "#1d4ed8"}
                  />
                  <text
                    x={(finding.positionX as number) * 100}
                    y={(finding.positionY as number) * 60 + 1.1}
                    textAnchor="middle"
                    fontSize="3"
                    fill="white"
                  >
                    {index}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        <p className="mt-1 text-xs text-neutral-600">
          Numbered marks correspond to the findings table. Red marks are adverse findings.
        </p>
      </section>

      {inspection.recommendation ? (
        <section className="mt-4">
          <h2 className="text-base font-bold">Recommendation</h2>
          <p className="mt-1 text-sm">{inspection.recommendation}</p>
        </section>
      ) : null}
    </div>
  );
}
