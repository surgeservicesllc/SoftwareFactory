import { requirePortalViewer } from "@/lib/portal/viewer-gate";

/**
 * The gate for every Services destination, applied in the layout rather
 * than per page — a gate repeated across files is a gate eventually
 * forgotten in one of them. The rule lives in `lib/portal/viewer-gate`,
 * shared with the Job Seeker and Budget Tracker, so no product drifts on
 * who may see its pages. Row-level security still decides who may read a
 * *row*, and that half does not depend on this file being right.
 */
export default async function ServicesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requirePortalViewer("/Services");
  return <>{children}</>;
}
