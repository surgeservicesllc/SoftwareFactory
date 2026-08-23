"use client";

import { useCallback, useState } from "react";

/**
 * The decision, offered where the gate is.
 *
 * Deliberately rendered beside the work rather than gathered into a separate
 * "approvals" panel: a gate is a fact about one stage, and separating the
 * question from the work it guards is how someone approves a thing they have
 * not looked at.
 *
 * The button says what the click does rather than what the state is, and the
 * outcome is whatever the route reports — including its refusals, which carry
 * the database's own sentence about why. A friendlier message written here
 * would discard the only text that says what actually happened.
 *
 * Extracted from the runs panel when the stage pages needed the same control.
 * One implementation, because two copies of an approval button is how the two
 * surfaces end up disagreeing about what an approval did.
 */
export function GateDecision({
  gateId,
  gateKind,
  gateState,
  anchorCount,
  onDecided,
}: {
  readonly gateId: string | null | undefined;
  readonly gateKind: string | null | undefined;
  readonly gateState: string | null | undefined;
  readonly anchorCount: number | null | undefined;
  readonly onDecided: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const decide = useCallback(
    async (approved: boolean) => {
      if (!gateId) return;
      setBusy(true);
      setNotice("");
      try {
        const response = await fetch(`/api/graph-gates/${gateId}/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approved }),
        });
        const body = (await response.json()) as {
          error?: { message?: string };
          note?: string;
        };
        if (!response.ok) {
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
    [gateId, onDecided],
  );

  if (!gateId || gateState !== "OPEN") return null;

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
        {gateKind === "HUMAN" ? "Human gate" : "Automatic gate"}
        {typeof anchorCount === "number"
          ? ` · ${anchorCount} anchor${anchorCount === 1 ? "" : "s"}`
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
