/**
 * The short form of a graph run's id — the eight characters the AI Factory's
 * breadcrumb shows, so a row in Runs and a run's own page name it identically.
 *
 * One function rather than two `slice(0, 8)` calls: the point of the label is
 * that the same run reads the same on both surfaces, and two copies of that
 * rule are two chances for it to stop being true.
 *
 * The run list carries analysis rows under an `analysis:` prefixed id, which
 * is a list-level detail and never part of what a run is called. It is
 * stripped here so callers can pass either form.
 */
export function shortRunId(id: string): string {
  return id.replace(/^analysis:/, "").slice(0, 8);
}
