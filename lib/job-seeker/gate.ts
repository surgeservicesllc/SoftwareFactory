import { requirePortalViewer } from "@/lib/portal/viewer-gate";

/**
 * The gate every job-seeker destination passes through.
 *
 * The rule itself now lives in `lib/portal/viewer-gate.ts`, shared with the
 * Budget Tracker, which needs exactly the same one: signed in, and belonging
 * to a workspace. This function stays because both job-seeker entry points
 * name it and because the `next` path they pass is the part that differs per
 * destination — but it holds no logic of its own to drift from the original.
 *
 * @param next Where to return after signing in or onboarding.
 */
export async function requireJobSeekerViewer(next: string): Promise<void> {
  await requirePortalViewer(next);
}
