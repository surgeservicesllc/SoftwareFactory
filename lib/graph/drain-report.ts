/**
 * What a graph drain actually did, in one line.
 *
 * "SoftwareFactory graph worker is done." is true of a drain that executed six
 * graphs and of one that found none, so on its own it answers nothing.
 */
export function describeDrainOutcome(graphsRun: number): string {
  if (graphsRun === 0) return "No planned graph was claimable; nothing ran.";
  const graphs = graphsRun === 1 ? "graph" : "graphs";
  return `Ran ${graphsRun} ${graphs}; each run's final state is reported above.`;
}
