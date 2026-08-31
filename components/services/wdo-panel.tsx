"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bug } from "lucide-react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * Wood-destroying-organism reports.
 *
 * The diagram is the part of this that is not a form. It is an SVG in a
 * 0..1 coordinate space — click the outline and the click becomes a mark
 * at that fraction of the width and height — so a mark keeps its meaning
 * whatever the drawing is later rendered over, and at any screen size.
 *
 * Two things on this page are deliberately not conveniences:
 *
 *   * The verdict radio has no preselected value. `visibleEvidence` is the
 *     legal question this document exists to answer, and defaulting it
 *     would be this page answering on the inspector's behalf.
 *   * Issuing is refused by the DATABASE when the report contradicts its
 *     own findings. This page shows that refusal in the inspector's own
 *     terms before they press it, but the refusal itself is not here —
 *     it is a check across two tables, where it cannot be bypassed.
 */

const FINDING_KINDS = [
  "live_infestation",
  "visible_damage",
  "previous_infestation",
  "previous_treatment",
  "conducive_condition",
] as const;

const ADVERSE = new Set<string>(["live_infestation", "visible_damage", "previous_infestation"]);

const KIND_LABELS: Record<string, string> = {
  live_infestation: "Live infestation",
  visible_damage: "Visible damage",
  previous_infestation: "Previous infestation",
  previous_treatment: "Previous treatment",
  conducive_condition: "Conducive condition",
};

const KIND_TONES: Record<string, string> = {
  live_infestation: "border-rose-200 bg-rose-50 text-rose-700",
  visible_damage: "border-rose-200 bg-rose-50 text-rose-700",
  previous_infestation: "border-amber-200 bg-amber-50 text-amber-700",
  previous_treatment: "border-sky-200 bg-sky-50 text-sky-700",
  conducive_condition: "border-amber-200 bg-amber-50 text-amber-700",
};

const MARK_FILL: Record<string, string> = {
  live_infestation: "#e11d48",
  visible_damage: "#e11d48",
  previous_infestation: "#d97706",
  previous_treatment: "#0284c7",
  conducive_condition: "#d97706",
};

type Inspection = {
  id: string;
  accountId: string;
  propertyId: string;
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
  supersedesId: string | null;
  editable: boolean;
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

type Summary = {
  inspections: number;
  issued: number;
  drafts: number;
  withEvidence: number;
  clean: number;
  reportsWithObstructions: number;
  findings: number;
  unplacedFindings: number;
  latestInspectedOn: string | null;
};

export function WdoPanel() {
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /*
   * Findings are stored WITH the report they belong to, rather than cleared
   * by an effect when the selection changes. Deriving the visible list
   * means a stale set can never render for a moment against the wrong
   * report while its own fetch is still in flight.
   */
  const [loadedFindings, setLoadedFindings] = useState<{ id: string; rows: Finding[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);

  const [markKind, setMarkKind] = useState<(typeof FINDING_KINDS)[number]>("live_infestation");
  const [markArea, setMarkArea] = useState("");
  const [markOrganism, setMarkOrganism] = useState("");
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [placing, setPlacing] = useState(false);
  const diagramRef = useRef<SVGSVGElement | null>(null);

  const selected = useMemo(
    () => inspections.find((inspection) => inspection.id === selectedId) ?? null,
    [inspections, selectedId],
  );

  const findings = useMemo(
    () => (loadedFindings !== null && loadedFindings.id === selectedId ? loadedFindings.rows : []),
    [loadedFindings, selectedId],
  );

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/services/wdo", { headers: { accept: "application/json" } });
      const body = (await response.json()) as {
        inspections?: Inspection[];
        summary?: Summary | null;
        error?: { message?: string };
      };
      if (!response.ok) {
        setLoadError(body.error?.message ?? "WDO reports could not be loaded.");
        return;
      }
      setLoadError(null);
      setInspections(body.inspections ?? []);
      setSummary(body.summary ?? null);
      setSelectedId((current) =>
        current !== null && (body.inspections ?? []).some((row) => row.id === current)
          ? current
          : ((body.inspections ?? [])[0]?.id ?? null),
      );
    } catch {
      setLoadError("WDO reports could not be loaded.");
    }
  }, []);

  const loadFindings = useCallback(async (inspectionId: string | null) => {
    if (inspectionId === null) return;
    try {
      const response = await fetch(`/api/services/wdo/${inspectionId}/findings`, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) return;
      const body = (await response.json()) as { findings: Finding[] };
      setLoadedFindings({ id: inspectionId, rows: body.findings });
    } catch {
      /* The list above still rendered; a failed detail read is not the
       * whole page's problem. */
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  useEffect(() => {
    // Deferred for the same reason the initial load is: the fetch sets
    // state, and an effect that does so synchronously is what the lint
    // rule is there to catch.
    const kickoff = window.setTimeout(() => void loadFindings(selectedId), 0);
    return () => window.clearTimeout(kickoff);
  }, [loadFindings, selectedId]);

  /**
   * A click on the outline, in the diagram's own 0..1 space. Reading the
   * rendered box rather than assuming a fixed size is what makes the mark
   * land where the inspector pointed on a phone as well as a laptop.
   */
  const onDiagramClick = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      if (selected === null || !selected.editable) return;
      const box = diagramRef.current?.getBoundingClientRect();
      if (box === undefined || box.width === 0 || box.height === 0) return;
      const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
      const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
      setPending({ x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) });
    },
    [selected],
  );

  const record = useCallback(async () => {
    if (selectedId === null) return;
    setPlacing(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/services/wdo/${selectedId}/findings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: markKind,
          area: markArea.trim(),
          organism: markOrganism.trim().length === 0 ? null : markOrganism.trim(),
          positionX: pending?.x ?? null,
          positionY: pending?.y ?? null,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setActionError(body.error?.message ?? "That finding could not be recorded.");
        return;
      }
      setMarkArea("");
      setMarkOrganism("");
      setPending(null);
      await loadFindings(selectedId);
      await refresh();
    } catch {
      setActionError("That finding could not be recorded.");
    } finally {
      setPlacing(false);
    }
  }, [loadFindings, markArea, markKind, markOrganism, pending, refresh, selectedId]);

  const issue = useCallback(async () => {
    if (selectedId === null) return;
    setIssuing(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/services/wdo/${selectedId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "issue" }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        // The database's sentence says exactly what is wrong with the
        // report. It is shown as written rather than flattened.
        setActionError(body.error?.message ?? "That report could not be issued.");
        return;
      }
      await refresh();
    } catch {
      setActionError("That report could not be issued.");
    } finally {
      setIssuing(false);
    }
  }, [refresh, selectedId]);

  const adverseCount = findings.filter((finding) => ADVERSE.has(finding.kind)).length;
  const placedCount = findings.filter((finding) => finding.placed).length;

  /**
   * The same contradiction the database refuses, restated here so an
   * inspector sees it before pressing Issue rather than after. This is a
   * courtesy, not the guarantee — the guarantee is in SQL.
   */
  const contradiction =
    selected === null
      ? null
      : selected.visibleEvidence && adverseCount === 0
        ? "This report says visible evidence was observed but records no infestation, damage or previous infestation."
        : !selected.visibleEvidence && adverseCount > 0
          ? `This report says no visible evidence was observed while ${adverseCount} adverse finding${adverseCount === 1 ? "" : "s"} ${adverseCount === 1 ? "is" : "are"} recorded against it.`
          : null;

  return (
    <div>
      <PageHeader
        title="WDO Reports"
        description="Wood-destroying-organism inspections, their findings, and the diagram that places them."
      />

      {loadError !== null ? <Notice tone="warning">{loadError}</Notice> : null}
      {actionError !== null ? <Notice tone="warning">{actionError}</Notice> : null}

      <Card className="mb-6">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="wdo-figures">
          <Figure label="Reports" value={summary === null ? "—" : String(summary.inspections)} />
          <Figure label="Issued" value={summary === null ? "—" : String(summary.issued)} />
          <Figure
            label="Evidence found"
            value={summary === null ? "—" : String(summary.withEvidence)}
            tone={(summary?.withEvidence ?? 0) > 0 ? "rose" : undefined}
          />
          <Figure
            label="Findings not placed"
            value={summary === null ? "—" : String(summary.unplacedFindings)}
            tone={(summary?.unplacedFindings ?? 0) > 0 ? "amber" : undefined}
          />
        </dl>
        {summary === null ? (
          <p className="mt-4 text-sm text-muted" data-testid="wdo-empty">
            No WDO inspections have been recorded yet. This page counts nothing because nothing has
            been inspected — not because everything came back clean.
          </p>
        ) : (
          <p className="mt-4 text-sm text-muted">
            {summary.issued} issued and {summary.drafts} still in draft. A draft has not answered the
            question yet, so it is counted in neither the evidence nor the clean column.{" "}
            {summary.reportsWithObstructions > 0
              ? `${summary.reportsWithObstructions} report${summary.reportsWithObstructions === 1 ? "" : "s"} name something that could not be inspected.`
              : "No report names an area it could not inspect."}
          </p>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <Card>
          <SectionTitle title="Reports" description="Newest first." />
          {inspections.length === 0 ? (
            <p className="mt-4 text-sm text-muted" data-testid="wdo-list-empty">
              Nothing yet.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-line" data-testid="wdo-list">
              {inspections.map((inspection) => (
                <li key={inspection.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(inspection.id)}
                    className={cn(
                      "w-full rounded-lg px-2 py-3 text-left",
                      selectedId === inspection.id ? "bg-violet-50" : "hover:bg-slate-50",
                    )}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {inspection.reportNumber}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold",
                          inspection.status === "issued"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-slate-100 text-slate-600",
                        )}
                      >
                        {inspection.status}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs text-faint">
                      {inspection.inspectedOn} ·{" "}
                      {inspection.status === "issued"
                        ? inspection.visibleEvidence
                          ? "evidence observed"
                          : "no visible evidence"
                        : "verdict not yet issued"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div>
          <Card className="mb-6">
            <SectionTitle
              title={selected === null ? "Diagram" : `Diagram — ${selected.reportNumber}`}
              description="Click the outline to place the next finding. Coordinates are recorded as a fraction of the drawing, so a mark keeps its place at any size."
            />

            {selected !== null ? (
              <p className="mt-2 text-sm">
                <a
                  className="underline"
                  href={`/Services/wdo/print/${selected.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open the printable report
                </a>{" "}
                <span className="text-muted">
                  — print-to-PDF happens in your browser; a draft prints with a DRAFT banner.
                </span>
              </p>
            ) : null}
            {selected === null ? (
              <p className="mt-4 text-sm text-muted">Choose a report.</p>
            ) : (
              <>
                <div className="mt-4 overflow-x-auto">
                  <svg
                    ref={diagramRef}
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    role="img"
                    aria-label={`Structure diagram for report ${selected.reportNumber}`}
                    onClick={onDiagramClick}
                    className={cn(
                      "h-64 w-full min-w-[20rem] rounded-lg border border-line bg-white sm:h-80",
                      selected.editable ? "cursor-crosshair" : "cursor-not-allowed",
                    )}
                    data-testid="wdo-diagram"
                  >
                    {/* The built-in structure outline. An uploaded floor
                        plan needs object storage, which is Not Connected. */}
                    <rect x="6" y="10" width="88" height="76" fill="none" stroke="#cbd5e1" strokeWidth="0.8" />
                    <line x1="6" y1="48" x2="94" y2="48" stroke="#e2e8f0" strokeWidth="0.5" />
                    <line x1="50" y1="10" x2="50" y2="86" stroke="#e2e8f0" strokeWidth="0.5" />
                    <text x="8" y="8" fontSize="3.4" fill="#94a3b8">front</text>
                    <text x="8" y="92" fontSize="3.4" fill="#94a3b8">rear</text>

                    {findings
                      .filter((finding) => finding.placed)
                      .map((finding) => (
                        <circle
                          key={finding.id}
                          cx={(finding.positionX ?? 0) * 100}
                          cy={(finding.positionY ?? 0) * 100}
                          r="2.2"
                          fill={MARK_FILL[finding.kind] ?? "#64748b"}
                          stroke="#ffffff"
                          strokeWidth="0.6"
                        >
                          <title>{`${KIND_LABELS[finding.kind] ?? finding.kind} — ${finding.area}`}</title>
                        </circle>
                      ))}

                    {pending === null ? null : (
                      <circle
                        cx={pending.x * 100}
                        cy={pending.y * 100}
                        r="2.6"
                        fill="none"
                        stroke="#7c3aed"
                        strokeWidth="0.9"
                        strokeDasharray="1.5 1.2"
                        data-testid="wdo-pending-mark"
                      />
                    )}
                  </svg>
                </div>

                <p className="mt-2 text-xs text-faint" data-testid="wdo-placed-count">
                  {/* A diagram showing some of the marks is not a diagram of
                      the inspection, so the gap is stated. */}
                  {placedCount} of {findings.length} finding{findings.length === 1 ? "" : "s"} placed
                  on the diagram
                  {placedCount === findings.length
                    ? "."
                    : `. ${findings.length - placedCount} recorded without a location and listed below only.`}
                </p>

                {selected.editable ? null : (
                  <Notice tone="info">
                    This report was issued{selected.issuedAt === null ? "" : ` on ${selected.issuedAt.slice(0, 10)}`}
                    . It is frozen — correct it with a new report that supersedes it.
                  </Notice>
                )}
              </>
            )}
          </Card>

          {selected !== null && selected.editable ? (
            <Card className="mb-6">
              <SectionTitle
                title="Record a finding"
                description={
                  pending === null
                    ? "Click the diagram first to place it, or record it without a location."
                    : `Placing at ${(pending.x * 100).toFixed(0)}% across, ${(pending.y * 100).toFixed(0)}% down.`
                }
              />
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs uppercase tracking-wide text-faint">What</span>
                  <select
                    value={markKind}
                    onChange={(event) =>
                      setMarkKind(event.target.value as (typeof FINDING_KINDS)[number])
                    }
                    className="w-full rounded-lg border border-line px-2 py-1.5 text-sm"
                    data-testid="wdo-finding-kind"
                  >
                    {FINDING_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {KIND_LABELS[kind]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs uppercase tracking-wide text-faint">Where</span>
                  <input
                    value={markArea}
                    onChange={(event) => setMarkArea(event.target.value)}
                    maxLength={300}
                    placeholder="Crawlspace, NE corner joists"
                    className="w-full rounded-lg border border-line px-2 py-1.5 text-sm"
                    data-testid="wdo-finding-area"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-xs uppercase tracking-wide text-faint">
                    Organism <span className="normal-case text-faint">(if identified)</span>
                  </span>
                  <input
                    value={markOrganism}
                    onChange={(event) => setMarkOrganism(event.target.value)}
                    maxLength={120}
                    placeholder="Eastern subterranean termite"
                    className="w-full rounded-lg border border-line px-2 py-1.5 text-sm"
                  />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={placing || markArea.trim().length === 0}
                  onClick={() => void record()}
                  className="btn btn-primary px-4 py-2 text-sm"
                  data-testid="wdo-record-finding"
                >
                  {placing ? "Recording…" : pending === null ? "Record without a location" : "Record here"}
                </button>
                {pending === null ? null : (
                  <button
                    type="button"
                    onClick={() => setPending(null)}
                    className="btn btn-secondary px-4 py-2 text-sm"
                  >
                    Clear the pin
                  </button>
                )}
              </div>
            </Card>
          ) : null}

          <Card>
            <SectionTitle
              title="Findings"
              description="Everything recorded against this report, placed or not."
            />
            {findings.length === 0 ? (
              <p className="mt-4 text-sm text-muted" data-testid="wdo-findings-empty">
                Nothing recorded yet. For a report that will say no visible evidence was observed,
                that is the expected state — the verdict is the answer, not the empty list.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-line" data-testid="wdo-findings-list">
                {findings.map((finding) => (
                  <li key={finding.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                          KIND_TONES[finding.kind] ?? KIND_TONES.conducive_condition,
                        )}
                      >
                        {KIND_LABELS[finding.kind] ?? finding.kind}
                      </span>
                      <span className="text-sm text-foreground">{finding.area}</span>
                      {finding.organism === null ? null : (
                        <span className="text-xs text-faint">{finding.organism}</span>
                      )}
                      {finding.placed ? null : (
                        <span className="text-xs text-faint">not on the diagram</span>
                      )}
                    </div>
                    {finding.note === null ? null : (
                      <p className="mt-1 text-sm text-muted">{finding.note}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {selected !== null && selected.editable ? (
              <div className="mt-6 border-t border-line pt-4">
                {contradiction === null ? null : (
                  <Notice tone="warning">
                    <span data-testid="wdo-contradiction">{contradiction}</span> The database refuses
                    to issue it in this state.
                  </Notice>
                )}
                <button
                  type="button"
                  disabled={issuing || contradiction !== null}
                  onClick={() => void issue()}
                  className="btn btn-primary mt-3 px-4 py-2 text-sm"
                  data-testid="wdo-issue"
                >
                  {issuing ? "Issuing…" : "Issue this report"}
                </button>
                <p className="mt-2 text-xs text-faint">
                  Issuing freezes the report and its findings. A correction is a new report that
                  supersedes this one.
                </p>
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "amber" | "rose" }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <dt className="flex items-center gap-2 text-xs uppercase tracking-wide text-faint">
        <Bug className="size-3.5" aria-hidden="true" />
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "rose" ? "text-rose-700" : tone === "amber" ? "text-amber-700" : "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
