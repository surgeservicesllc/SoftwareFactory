/**
 * The shape of the portfolio scheduling read.
 *
 * These live here rather than in the route because a Next.js route module may
 * only export its handlers and config — exporting types from it fails the
 * build's route-type validation. The console and the route both import from
 * this file so there is still exactly one definition of the contract.
 */

export interface SchedulingCapacity {
  readonly activeRuns: number;
  readonly emergencyQueued: number;
  readonly emergencyReserved: number;
  readonly fairnessPromotionSeconds: number;
  readonly focusedProjects: number;
  readonly openBreakers: number;
  readonly ordinaryCeiling: number;
  readonly organizationLimit: number;
  readonly pausedProjects: number;
  readonly queuedRuns: number;
  readonly workerCapacity: number;
  readonly workerCount: number;
  readonly workerLeases: number;
}

export interface SchedulingQueueItem {
  /** Null when nothing is holding this item back, or when it is running. */
  readonly blockedReason: string | null;
  readonly effectivePriority: number;
  readonly emergency: boolean;
  readonly projectName: string;
  readonly projectPriority: number;
  /** Null for running work: a running item is not in a queue. */
  readonly queuePosition: number | null;
  readonly runId: string;
  readonly runStatus: string;
  readonly strategicFocus: boolean;
  readonly taskTitle: string;
  readonly waitingSeconds: number;
}

export interface SchedulingProject {
  readonly activeRuns: number;
  readonly engineeringPaused: boolean;
  readonly engineeringPauseReason: string | null;
  readonly engineeringPriority: number;
  readonly maximumConcurrentRuns: number;
  readonly projectId: string;
  readonly projectName: string;
  readonly queuedRuns: number;
  readonly strategicFocus: boolean;
}

export interface SchedulingView {
  /** Null when the capacity projection could not be read — never zeros. */
  readonly capacity: SchedulingCapacity | null;
  readonly projects: readonly SchedulingProject[];
  readonly queue: readonly SchedulingQueueItem[];
  /** Sections that could not be read, so the console can say which. */
  readonly unavailable: readonly string[];
}
