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
  readonly lifecycle_stage?: string | null;
};

/** The route's exact post-decision dispatch result. */
export type GateDecisionResult = {
  readonly workerWoken: boolean;
  readonly note: string;
};

function approvalLabel(stage: string | null | undefined): string {
  if (stage === "TEST") return "Accept merged pull request";
  if (stage === "DEPLOYMENT") return "Accept production deployment";
  return "Approve";
}

function approvalGuidance(stage: string | null | undefined): string | null {
  if (stage === "TEST") {
    return "This verifies an already-merged pull request against the exact CI evidence. It never merges the pull request.";
  }
  if (stage === "DEPLOYMENT") {
    return "This verifies and records the exact successful Production deployment. It never creates a deployment.";
  }
  if (stage === "ARCHITECTURE") {
    return "This approval is bound to the exact architecture artifact shown with this run.";
  }
  return null;
}

export function GateDecision({
  evidenceArtifactId,
  approvalRequiresEvidence = false,
  approvalUnavailableMessage,
  node,
  onDecided,
}: {
  readonly evidenceArtifactId?: string | null;
  readonly approvalRequiresEvidence?: boolean;
  readonly approvalUnavailableMessage?: string;
  readonly node: GateHolder;
  readonly onDecided: (approved: boolean, result: GateDecisionResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const exactEvidenceArtifactId = evidenceArtifactId ?? node.gate_evidence_artifact_id ?? null;
  const approvalBlocked = approvalRequiresEvidence && exactEvidenceArtifactId === null;
  const guidance = approvalGuidance(node.lifecycle_stage);

  const decide = useCallback(
    async (approved: boolean) => {
      if (!node.gate_id) return;
      let decidedResult: GateDecisionResult | null = null;
      setBusy(true);
      setNotice("");
      try {
        const response = await fetch(`/api/graph-gates/${node.gate_id}/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approved,
            ...(approved && exactEvidenceArtifactId
              ? { evidenceArtifactId: exactEvidenceArtifactId }
              : {}),
          }),
        });
        const body = (await response.json()) as {
          error?: { message?: string };
          note?: string;
          workerWoken?: boolean;
        };
        if (!response.ok) {
          // The route passes the database's sentence through; showing a
          // friendlier one here would discard the only text that says why.
          setNotice(body.error?.message ?? "The decision could not be recorded.");
          return;
        }
        const result: GateDecisionResult = {
          // Missing or malformed wake evidence is never treated as a wake.
          workerWoken: body.workerWoken === true,
          note: body.note ?? "The decision is recorded. No worker wake was confirmed.",
        };
        setNotice(result.note);
        decidedResult = result;
      } catch {
        setNotice("The request did not reach the server.");
      } finally {
        setBusy(false);
      }
      // Keep consumer navigation outside the request catch. The decision is
      // already durable, so a rendering callback cannot turn that success
      // into the false claim that the request never reached the server.
      if (decidedResult) onDecided(approved, decidedResult);
    },
    [exactEvidenceArtifactId, node.gate_id, onDecided],
  );

  if (!node.gate_id || node.gate_state !== "OPEN") return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy || approvalBlocked}
        onClick={() => void decide(true)}
        className="btn btn-secondary btn-sm"
      >
        {approvalLabel(node.lifecycle_stage)}
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
      {guidance ? (
        <span className="basis-full text-muted">{guidance}</span>
      ) : null}
      {approvalBlocked ? (
        <span role="status" className="basis-full text-[var(--warning)]">
          {approvalUnavailableMessage
            ?? "Approval is unavailable until the exact evidence artifact is loaded. Refresh this run and try again."}
        </span>
      ) : null}
      {notice ? (
        <span role="status" className="basis-full text-muted">
          {notice}
        </span>
      ) : null}
    </div>
  );
}
