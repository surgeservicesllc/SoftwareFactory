"use client";

import { useCallback, useEffect, useState } from "react";

import { StatusBadge } from "@/components/ui";
import { isBrowserSupabaseConfigured } from "@/lib/supabase/browser-config";

type WorkerStatus = {
  connectionStatus: "connected" | "stale" | "not_connected";
  statusLabel: string;
  lastHeartbeatAt: string | null;
  activeWorkers: number;
  availableWorkers: number;
  staleAfterSeconds: number;
};

type StatusState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "setup" }
  | { kind: "error" }
  | { kind: "ready"; worker: WorkerStatus };

function isFresh(worker: WorkerStatus) {
  if (worker.connectionStatus !== "connected" || worker.availableWorkers < 1 || !worker.lastHeartbeatAt) return false;
  const heartbeat = Date.parse(worker.lastHeartbeatAt);
  if (!Number.isFinite(heartbeat)) return false;
  const age = Date.now() - heartbeat;
  return age >= -60_000 && age <= worker.staleAfterSeconds * 1000;
}

export function WorkerStatusBadge({ enabled = true }: { enabled?: boolean }) {
  const canLoad = isBrowserSupabaseConfigured() && enabled;
  const [state, setState] = useState<StatusState>(() => canLoad ? { kind: "loading" } : { kind: "signed-out" });

  const load = useCallback(async () => {
    if (!canLoad) return setState({ kind: "signed-out" });
    try {
      const response = await fetch("/api/worker/status", { cache: "no-store" });
      if (response.status === 401) return setState({ kind: "signed-out" });
      if (response.status === 403 || response.status === 409) return setState({ kind: "setup" });
      const body = await response.json() as { worker?: WorkerStatus };
      if (!response.ok || !body.worker) return setState({ kind: "error" });
      setState({ kind: "ready", worker: body.worker });
    } catch {
      setState({ kind: "error" });
    }
  }, [canLoad]);

  useEffect(() => {
    if (!canLoad) return;
    const initial = window.setTimeout(() => void load(), 0);
    const poll = window.setInterval(() => void load(), 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(poll);
    };
  }, [canLoad, load]);

  if (state.kind === "loading") return <StatusBadge tone="neutral">Checking worker</StatusBadge>;
  if (state.kind === "signed-out") return <StatusBadge tone="neutral">Worker status requires sign-in</StatusBadge>;
  if (state.kind === "setup") return <StatusBadge tone="neutral">Choose workspace for worker status</StatusBadge>;
  if (state.kind === "error") return <StatusBadge tone="warning">Worker status unavailable</StatusBadge>;

  const fresh = isFresh(state.worker);
  const label = fresh
    ? "Worker Connected"
    : state.worker.lastHeartbeatAt
      ? "Worker Stale"
      : "Worker Not Connected";
  return (
    <span aria-live="polite">
      <StatusBadge tone={fresh ? "safe" : state.worker.lastHeartbeatAt ? "warning" : "danger"}>{label}</StatusBadge>
    </span>
  );
}
