"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SignalHigh, SignalZero } from "lucide-react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  applyOutcome,
  dueWrites,
  newWrite,
  queueSummary,
  reconcile,
  type QueuedWrite,
  type SubmitOutcome,
} from "@/lib/services/field-queue";

/**
 * The technician's surface, built for a phone in a crawlspace.
 *
 * The queue's decisions live in lib/services/field-queue.ts and are tested
 * directly; this component is the storage, the network and the words.
 *
 * The rule the whole screen is built around: **nothing ever says "saved"
 * until the server has confirmed it.** A completed visit reads "waiting to
 * send" for as long as that is true, however long that is, and the count
 * of unsent work is always on screen. A technician who is told their day
 * is filed when it is sitting in browser storage will find out from a
 * customer dispute weeks later.
 */

const STORAGE_KEY = "crm.field.queue.v1";

type Visit = {
  id: string;
  serviceType: string;
  status: string;
  scheduledStart: string | null;
  propertyLabel: string | null;
};

function loadQueue(): QueuedWrite[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedWrite[]) : [];
  } catch {
    /* A private window, cleared storage, or a browser refusing it. An
     * empty queue is the honest reading; it must not throw and lose the
     * page. */
    return [];
  }
}

function saveQueue(queue: readonly QueuedWrite[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    /* Storage refused the write. The queue still lives in memory for this
     * session, and the badge still counts it, so nothing reads as sent. */
  }
}

function mintToken(): string {
  return crypto.randomUUID();
}

export function FieldPanel() {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [queue, setQueue] = useState<QueuedWrite[]>([]);
  const [online, setOnline] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const summary = useMemo(() => queueSummary(queue), [queue]);

  const persist = useCallback((next: QueuedWrite[]) => {
    setQueue(next);
    saveQueue(next);
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => setQueue(loadQueue()), 0);
    return () => window.clearTimeout(kickoff);
  }, []);

  useEffect(() => {
    const update = () => setOnline(window.navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/services/work-orders?status=dispatched", {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        setLoadError("Today's work could not be loaded. Anything you record still queues.");
        return;
      }
      const body = (await response.json()) as { workOrders?: Visit[] };
      setLoadError(null);
      setVisits(body.workOrders ?? []);
    } catch {
      // Offline is the expected case here, not an error worth shouting
      // about — the queue is what makes it survivable.
      setLoadError(null);
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  /** One attempt at one write. The server's answer is the only authority. */
  const send = useCallback(async (write: QueuedWrite): Promise<SubmitOutcome> => {
    try {
      const response = await fetch("/api/services/field", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: write.kind,
          clientToken: write.clientToken,
          occurredAt: write.occurredAt,
          ...write.body,
        }),
      });
      const body = (await response.json()) as {
        settled?: boolean;
        replayed?: boolean;
        permanent?: boolean;
        error?: { message?: string };
      };
      if (response.ok && body.settled === true) {
        return { settled: true, replayed: body.replayed === true };
      }
      if (body.permanent === true) {
        return {
          settled: false,
          permanent: true,
          reason: body.error?.message ?? "That was refused.",
        };
      }
      return { settled: false, permanent: false };
    } catch {
      // No signal. Not a refusal — it stays queued and is tried again.
      return { settled: false, permanent: false };
    }
  }, []);

  const drain = useCallback(async () => {
    setBusy(true);
    try {
      const pending = dueWrites(queue);
      let next = queue;
      for (const write of pending) {
        const outcome = await send(write);
        const at = new Date().toISOString();
        next = next.map((entry) =>
          entry.clientToken === write.clientToken ? applyOutcome(entry, outcome, at) : entry,
        );
      }

      // Ask the server which tokens it actually holds. Its answer wins over
      // anything this device believes — that is what closes the tunnel case
      // where the request landed and the response never came back.
      const stillOwed = dueWrites(next).map((entry) => entry.clientToken);
      if (stillOwed.length > 0) {
        try {
          const response = await fetch("/api/services/field", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ tokens: stillOwed }),
          });
          if (response.ok) {
            const body = (await response.json()) as { settled: { clientToken: string }[] };
            next = reconcile(
              next,
              body.settled.map((entry) => entry.clientToken),
              new Date().toISOString(),
            );
          }
        } catch {
          /* Still offline. The queue is unchanged and still owed. */
        }
      }

      persist(next);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [persist, queue, refresh, send]);

  const completeVisit = useCallback(
    (visit: Visit) => {
      // The token is minted HERE, before any attempt, and never changes.
      // A fresh token per retry is how one visit becomes six.
      const write = newWrite(
        "complete_work_order",
        { workOrderId: visit.id },
        mintToken(),
        new Date().toISOString(),
      );
      persist([...queue, write]);
    },
    [persist, queue],
  );

  return (
    <div>
      <PageHeader
        title="Today"
        description="Your dispatched work. Everything you record here is kept on this device until the server confirms it."
      />

      <Card className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold",
              online
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700",
            )}
            data-testid="field-connection"
          >
            {online ? (
              <SignalHigh className="size-4" aria-hidden="true" />
            ) : (
              <SignalZero className="size-4" aria-hidden="true" />
            )}
            {online ? "Online" : "No signal — still recording"}
          </span>

          <span className="text-sm text-muted" data-testid="field-queue-summary">
            {summary.unsent === 0
              ? "Everything you have recorded is filed."
              : `${summary.unsent} not sent yet${summary.oldestUnsentAt === null ? "" : `, oldest ${summary.oldestUnsentAt.slice(11, 16)}`}.`}
          </span>

          <button
            type="button"
            disabled={busy || summary.waiting === 0}
            onClick={() => void drain()}
            className="btn btn-primary px-3 py-2 text-sm"
            data-testid="field-sync"
          >
            {busy ? "Sending…" : "Send now"}
          </button>
        </div>

        {summary.refused > 0 ? (
          <Notice tone="warning">
            {summary.refused} item{summary.refused === 1 ? "" : "s"} could not be sent and will not
            be retried. They are listed below and are still your work — they have not been filed.
          </Notice>
        ) : null}
      </Card>

      {loadError !== null ? <Notice tone="info">{loadError}</Notice> : null}

      <Card className="mb-6">
        <SectionTitle title="Dispatched to you" description="Tap to record a visit as complete." />
        {visits.length === 0 ? (
          <p className="mt-4 text-sm text-muted" data-testid="field-visits-empty">
            Nothing dispatched right now. If you are offline, this list is whatever was last loaded.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line" data-testid="field-visits">
            {visits.map((visit) => {
              const queued = queue.find(
                (entry) =>
                  entry.kind === "complete_work_order" &&
                  (entry.body as { workOrderId?: string }).workOrderId === visit.id,
              );
              return (
                <li key={visit.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">
                      {visit.serviceType}
                    </span>
                    <span className="block text-xs text-faint">
                      {visit.propertyLabel ?? "No site named"}
                      {visit.scheduledStart === null
                        ? ""
                        : ` · ${visit.scheduledStart.slice(11, 16)}`}
                    </span>
                  </div>
                  {queued === undefined ? (
                    <button
                      type="button"
                      onClick={() => completeVisit(visit)}
                      className="btn btn-primary px-3 py-2 text-sm"
                      data-testid={`field-complete-${visit.id}`}
                    >
                      Complete
                    </button>
                  ) : (
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                        queued.state === "settled"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : queued.state === "refused"
                            ? "border-rose-200 bg-rose-50 text-rose-700"
                            : "border-amber-200 bg-amber-50 text-amber-700",
                      )}
                    >
                      {/* Never "saved" for something the server has not
                          confirmed. This wording is the whole contract. */}
                      {queued.state === "settled"
                        ? "filed"
                        : queued.state === "refused"
                          ? "refused"
                          : "waiting to send"}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <SectionTitle
          title="On this device"
          description="Kept here until the server has it. Closing the app does not lose them."
        />
        {queue.length === 0 ? (
          <p className="mt-4 text-sm text-muted" data-testid="field-queue-empty">
            Nothing recorded yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line" data-testid="field-queue">
            {queue.map((write) => (
              <li key={write.clientToken} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-foreground">
                    {write.kind === "complete_work_order" ? "Visit completed" : "Station scanned"}
                  </span>
                  <span className="text-xs text-faint">
                    recorded {write.occurredAt.slice(11, 16)}
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                      write.state === "settled"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : write.state === "refused"
                          ? "border-rose-200 bg-rose-50 text-rose-700"
                          : "border-amber-200 bg-amber-50 text-amber-700",
                    )}
                  >
                    {write.state === "settled"
                      ? "filed"
                      : write.state === "refused"
                        ? "refused"
                        : `waiting${write.attempts > 0 ? ` · ${write.attempts} tries` : ""}`}
                  </span>
                </div>
                {write.refusedReason === null ? null : (
                  <p className="mt-1 text-sm text-rose-800">{write.refusedReason}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
