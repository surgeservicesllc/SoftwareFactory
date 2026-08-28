"use client";

import { useCallback, useState } from "react";

/**
 * The decision, offered where the gate is.
 *
 * Deliberately inline beside the work it guards rather than gathered into a
 * separate "approvals" panel: a gate is a fact about one stage, and separating
 * the question from the work is how someone approves a thing they have not
 * looked at. Extracted from the runs panel so the lifecycle pages offer the
 * same control — one implementation, one wording, one route.
 *
 * The button says what the click does rather than what the state is, and the
 * outcome is whatever the route reports — including its refusals, which carry
 * the database's own sentence about why.
 */

/** The gate columns as the runs endpoint projects them onto a node. */
export type GateHolder = {
  readonly gate_evidence_artifact_id?: string | null;
  readonly gate_id?: string | null;
  readonly gate_kind?: string | null;
  readonly gate_state?: string | null;
  readonly gate_anchor_count?: number | null;
};

export function GateDecision({
  evidenceArtifactId,
  node,
  onDecided,
}: {
  readonly evidenceArtifactId?: string | null;
  readonly node: GateHolder;
  readonly onDecided: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const decide = useCallback(
    async (approved: boolean) => {
      if (!node.gate_id) return;
      setBusy(true);
      setNotice("");
      try {
        const response = await fetch(`/api/graph-gates/${node.gate_id}/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approved,
            ...(approved && (evidenceArtifactId ?? node.gate_evidence_artifact_id)
              ? { evidenceArtifactId: evidenceArtifactId ?? node.gate_evidence_artifact_id }
              : {}),
          }),
        });
        const body = (await response.json()) as {
          error?: { message?: string };
          note?: string;
        };
        if (!response.ok) {
          // The route passes the database's sentence through; showing a
          // friendlier one here would discard the only text that says why.
          setNotice(body.error?.message ?? "The decision could not be recorded.");
          return;
        }
        setNotice(body.note ?? "Recorded.");
        onDecided();
      } catch {
        setNotice("The request did not reach the server.");
      } finally {
        setBusy(false);
      }
    },
    [evidenceArtifactId, node.gate_evidence_artifact_id, node.gate_id, onDecided],
  );

  if (!node.gate_id || node.gate_state !== "OPEN") return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void decide(true)}
        className="btn btn-secondary btn-sm"
      >
        Approve
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void decide(false)}
        className="btn btn-secondary btn-sm"
      >
        Reject
      </button>
      <span className="text-muted">
        {node.gate_kind === "HUMAN" ? "Human gate" : "Automatic gate"}
        {typeof node.gate_anchor_count === "number"
          ? ` · ${node.gate_anchor_count} anchor${node.gate_anchor_count === 1 ? "" : "s"}`
          : ""}
      </span>
      {notice ? (
        <span role="status" className="basis-full text-muted">
          {notice}
        </span>
      ) : null}
    </div>
  );
}
