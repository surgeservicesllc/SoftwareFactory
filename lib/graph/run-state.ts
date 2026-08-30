/** Durable graph-run states, kept in the same order as the database enum. */
export const GRAPH_RUN_STATES = [
  "PLANNED",
  "RUNNING",
  "PARTIAL",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "BUDGET_STOPPED",
] as const;

export type GraphRunState = (typeof GRAPH_RUN_STATES)[number];

export type GraphRunStateMetadata = Readonly<{
  label: string;
  terminal: boolean;
  tone: "neutral" | "info" | "safe" | "warning" | "danger";
}>;

/** One exhaustive truth table for every UI that renders a graph run. */
export const GRAPH_RUN_STATE_METADATA: Readonly<Record<GraphRunState, GraphRunStateMetadata>> =
  Object.freeze({
    PLANNED: { label: "planned", terminal: false, tone: "neutral" },
    RUNNING: { label: "running", terminal: false, tone: "info" },
    PARTIAL: { label: "partial", terminal: true, tone: "warning" },
    COMPLETED: { label: "completed", terminal: true, tone: "safe" },
    FAILED: { label: "failed", terminal: true, tone: "danger" },
    CANCELLED: { label: "cancelled", terminal: true, tone: "neutral" },
    BUDGET_STOPPED: { label: "budget stopped", terminal: true, tone: "warning" },
  });

export function isGraphRunState(state: string): state is GraphRunState {
  return Object.hasOwn(GRAPH_RUN_STATE_METADATA, state);
}

export function graphRunStateMetadata(state: string): GraphRunStateMetadata {
  return isGraphRunState(state)
    ? GRAPH_RUN_STATE_METADATA[state]
    : { label: state.toLowerCase().replaceAll("_", " "), terminal: false, tone: "neutral" };
}

export function isTerminalGraphRunState(state: string): boolean {
  return graphRunStateMetadata(state).terminal;
}
