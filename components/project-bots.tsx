"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Loader2,
  Pause,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  BRANCH_STRATEGIES,
  branchStrategyLabel,
  ENVIRONMENT_ACCESS_LEVELS,
  environmentAccessLabel,
  elevatedPermissions,
  LEAST_PRIVILEGE_CONFIG,
  MAX_BOTS_PER_ASSIGNMENT,
  MAX_CONCURRENT_TASKS,
  normalizeAssignmentConfig,
  PIPELINE_ACCESS_LEVELS,
  pipelineAccessLabel,
  priorityLabel,
  REPOSITORY_ACCESS_LEVELS,
  repositoryAccessLabel,
  ROLE_PRESETS,
  type AssignmentConfig,
  type BranchStrategy,
  type EnvironmentAccess,
  type PipelineAccess,
  type RepositoryAccess,
} from "@/lib/bots/assignment-config";
import { accountProvisionCredentialChoice } from "@/lib/bots/account-credential-choice";
import { BOT_ROLE_TEMPLATES, findBotProvider } from "@/lib/bots/catalog";
import { ModalDialog } from "@/components/modal-dialog";
import { StatusBadge } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * The bots serving one project, and the wizard that puts them there.
 *
 * A project is staffed by several bots at once, each with its own role and its
 * own idea of what it may touch — so the flow is Select, Configure, Review,
 * Confirm rather than one dropdown repeated. The configure step is the reason
 * the wizard exists: assigning three bots that all have the same permissions
 * is the same as assigning one.
 *
 * Honest about authority throughout. Assignment is routing intent; no worker
 * executes because of it in this phase, and the review step says so next to
 * the permissions rather than in fine print somewhere else.
 */

type ProjectBot = {
  id: string;
  name: string;
  provider: string;
  providerLabel: string;
  providerVendor: string;
  model: string;
  currentReadiness: string;
  readinessLabel: string;
  readinessTone: "safe" | "warning" | "danger" | "neutral";
  aiAccountId: string | null;
  /** Operational credential metadata only; never proof of account identity. */
  credentialRef?: string | null;
  assignable: boolean;
  blockedReason: string | null;
  alreadyOnThisProject: boolean;
  currentProjectId: string | null;
  currentProjectName: string | null;
  currentAssignmentId: string | null;
  currentAssignmentProjectId: string | null;
  currentAssignmentRevision: number | null;
  currentRoleId: string | null;
  currentRole: ProjectRole | null;
  currentAssignmentConfig: AssignmentConfig | null;
  workload: number;
};

/** A connected AI account from the Bot Manager, offered for linking here. */
type LinkableAccount = {
  id: string;
  provider: string;
  providerLabel: string;
  displayName: string;
  status: string;
  credentialPurpose?: string | null;
};

/** The provision endpoint's pattern-checked name for the same slot. */
function accountCredentialChoice(account: LinkableAccount): string | null {
  return accountProvisionCredentialChoice(account.provider, account.credentialPurpose);
}

type ProjectRole = { id: string; name: string; slug: string; summary: string };

type Posting = {
  id: string;
  revision: number;
  botId: string;
  projectId: string;
  roleId: string;
  status: "active" | "paused" | "released";
  assignedAt: string;
  /** Per-posting model override; null means the bot's own default model. */
  model?: string | null;
  /** How hard this posting should think: low, medium, high, or max. */
  workEffort?: string;
  config: AssignmentConfig;
  bot: ProjectBot | null;
  role: ProjectRole | null;
};

const WORK_EFFORTS = [
  { value: "low", label: "Low — quick passes" },
  { value: "medium", label: "Medium — the default" },
  { value: "high", label: "High — thorough" },
  { value: "max", label: "Max — hardest thinking" },
] as const;

type Roster = {
  canManage: boolean;
  assigned: Posting[];
  available: ProjectBot[];
  roles: ProjectRole[];
};

type UsageWindow = { windowKey: string; label: string; usedPercent: number };
type UsageByAccount = Record<string, UsageWindow[]>;

/** One bot's choices while the wizard is open. */
type Draft = { roleId: string; config: AssignmentConfig };

const STEPS = ["Select", "Configure", "Review"] as const;
type Step = (typeof STEPS)[number];

function statusTone(status: Posting["status"]) {
  if (status === "active") return "safe" as const;
  if (status === "paused") return "warning" as const;
  return "neutral" as const;
}

/* --------------------------------------------------------------- the roster */

export function ProjectBots({
  projectId,
  projectName,
  /**
   * The inspector stacks this panel under other panels, where the rule reads
   * as a divider. On the project page it sits alone inside a card, where the
   * same rule reads as a stray line directly under the card's own border.
   */
  divided = true,
  /**
   * AI Factory already supplies the modal shell for this control. In that
   * surface the assignment/configuration flows render in place so opening one
   * never stacks a second modal, backdrop, close button, or focus boundary on
   * top of the first.
   */
  embedded = false,
  /** Refresh the parent journey only after an exact assignment read-back. */
  onAssignmentComplete,
  /** AI Factory's explicit, accessible way back from the embedded roster. */
  onReturnToFactory,
}: {
  projectId: string;
  projectName: string;
  divided?: boolean;
  embedded?: boolean;
  onAssignmentComplete?: () => Promise<void> | void;
  onReturnToFactory?: () => Promise<boolean | void> | boolean | void;
}) {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [usage, setUsage] = useState<UsageByAccount>({});
  const [accounts, setAccounts] = useState<LinkableAccount[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<Posting | null>(null);
  const [returning, setReturning] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/bots`, { cache: "no-store" });
      if (!response.ok) {
        // A failed read is an error state, never an empty roster pretending
        // the project has no bots.
        setFailed(true);
        return;
      }
      const body = (await response.json()) as Partial<Roster>;
      setFailed(false);
      /*
       * Normalized on arrival rather than trusted. A response missing a list —
       * an older deployment, a partial projection — must render an empty
       * roster, not throw on `.length` and take the whole project page down
       * with it. The panel is one section of a page; it does not get to be the
       * reason the rest disappears.
       */
      const normalized: Roster = {
        canManage: body.canManage === true,
        assigned: Array.isArray(body.assigned) ? body.assigned : [],
        available: Array.isArray(body.available) ? body.available : [],
        roles: Array.isArray(body.roles) ? body.roles : [],
      };
      setRoster(normalized);
      return normalized;
    } catch {
      setFailed(true);
    }
  }, [projectId]);

  /**
   * Recorded usage, joined by AI account. Best-effort on purpose: a database
   * without the usage migration answers with an empty list, and a bot with no
   * observation simply shows no bar rather than a fabricated zero.
   */
  const loadUsage = useCallback(async () => {
    try {
      const response = await fetch("/api/ai-accounts/usage", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as {
        usage?: Array<{ accountId: string; windows?: UsageWindow[] }>;
      };
      const next: UsageByAccount = {};
      for (const entry of body.usage ?? []) next[entry.accountId] = entry.windows ?? [];
      setUsage(next);
    } catch {
      /* Usage is decoration here; its absence must not break the roster. */
    }
  }, []);

  /**
   * The Bot Manager's connected accounts, so the assign wizard can offer to
   * link them — an account with no bot is one click from being staffable
   * instead of a dead end. Best-effort like usage: an unreadable list means
   * the section simply is not offered.
   */
  const loadAccounts = useCallback(async () => {
    try {
      const response = await fetch("/api/ai-accounts", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { accounts?: LinkableAccount[] };
      setAccounts((body.accounts ?? []).filter((account) => account.status === "connected"));
    } catch {
      /* Absence, not failure. */
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
      void loadUsage();
      void loadAccounts();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, loadUsage, loadAccounts]);

  /** Per-posting execution preferences: model override and work effort. */
  const setExecution = useCallback(
    async (posting: Posting, patch: { model?: string; workEffort?: string }) => {
      setBusy(posting.id);
      setNotice("");
      try {
        const response = await fetch(`/api/bot-assignments/${posting.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...patch,
            expectedProjectId: posting.projectId,
            expectedRevision: posting.revision,
          }),
        });
        if (!response.ok) {
          const body = (await response.json()) as { error?: { message?: string } };
          setNotice(body.error?.message ?? "The posting's execution settings could not be changed.");
          return;
        }
        await load();
      } catch {
        setNotice("The posting's execution settings could not be changed.");
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const setStatus = useCallback(
    async (posting: Posting, status: "active" | "paused") => {
      setBusy(posting.id);
      setNotice("");
      try {
        const response = await fetch(`/api/projects/${projectId}/bots/${posting.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          // The configuration travels with the status so a pause cannot land
          // without the permissions it was paired with.
          body: JSON.stringify({
            status,
            config: toConfigInput(posting.config),
            expectedRevision: posting.revision,
          }),
        });
        if (!response.ok) {
          const body = (await response.json()) as { error?: { message?: string } };
          setNotice(body.error?.message ?? "That bot could not be updated.");
          return;
        }
        await load();
      } catch {
        setNotice("That bot could not be updated.");
      } finally {
        setBusy(null);
      }
    },
    [projectId, load],
  );

  const release = useCallback(
    async (posting: Posting) => {
      setBusy(posting.id);
      setNotice("");
      try {
        const response = await fetch(`/api/projects/${projectId}/bots/${posting.id}`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedRevision: posting.revision }),
        });
        if (!response.ok) {
          const body = (await response.json()) as { error?: { message?: string } };
          setNotice(body.error?.message ?? "That bot could not be removed.");
          return;
        }
        await load();
      } catch {
        setNotice("That bot could not be removed.");
      } finally {
        setBusy(null);
      }
    },
    [projectId, load],
  );

  const assignmentComplete = useCallback(async () => {
    setWizardOpen(false);
    await load();
    setNotice(
      embedded
        ? "Assignment verified. Return to AI Factory to see the refreshed journey."
        : "Assignment verified against the project roster.",
    );
    await onAssignmentComplete?.();
  }, [embedded, load, onAssignmentComplete]);

  const returnToFactory = useCallback(async () => {
    if (!onReturnToFactory || returning) return;
    setReturning(true);
    try {
      await onReturnToFactory();
    } finally {
      setReturning(false);
    }
  }, [onReturnToFactory, returning]);

  if (failed) {
    return (
      <div className={cn("p-5", divided && "border-t border-line")}>
        <p className="label">Bots on this project</p>
        <p className="mt-2 text-sm text-[var(--warning)]">
          The bot roster could not be loaded, so this project&apos;s bots are unknown.
        </p>
      </div>
    );
  }

  if (!roster) return null;

  const assigned = roster.assigned;

  if (embedded && wizardOpen) {
    return (
      <div className={cn("p-5", divided && "border-t border-line")}>
        <AssignWizard
          projectId={projectId}
          projectName={projectName}
          bots={roster.available}
          roles={roster.roles}
          usage={usage}
          accounts={accounts}
          inline
          onRosterRefresh={load}
          onClose={() => setWizardOpen(false)}
          onAssigned={assignmentComplete}
        />
      </div>
    );
  }

  if (embedded && editing) {
    return (
      <div className={cn("p-5", divided && "border-t border-line")}>
        <EditPostingDialog
          projectId={projectId}
          posting={editing}
          roles={roster.roles}
          inline
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      </div>
    );
  }

  return (
    <div className={cn("p-5", divided && "border-t border-line")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="label">Bots</p>
          <p className="mt-1 text-sm text-faint">
            {assigned.length === 0
              ? "No bots assigned yet"
              : `${assigned.length} ${assigned.length === 1 ? "bot" : "bots"} assigned`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {embedded && onReturnToFactory ? (
            <button
              type="button"
              onClick={() => void returnToFactory()}
              disabled={returning}
              className="btn btn-secondary btn-sm"
            >
              {returning ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <ArrowLeft className="size-3.5" aria-hidden="true" />
              )}
              Return to AI Factory
            </button>
          ) : null}
          {roster.canManage ? (
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="btn btn-primary btn-sm"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              {assigned.length === 0 ? "Assign Bots" : "Assign More"}
            </button>
          ) : null}
        </div>
      </div>

      {notice ? (
        <p role="status" className="mt-3 text-sm text-[var(--warning)]">
          {notice}
        </p>
      ) : null}

      {assigned.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line p-4 text-sm text-muted">
          Add bots to automate and accelerate your workflows. Assignment is routing intent — no
          worker executes because of it yet.
        </p>
      ) : (
        // `grid-cols-1` rather than a bare `grid`. Without an explicit template the
        // implicit column is `auto`, whose minimum is the item's min-content — so
        // one card that could not shrink sized the whole column to 369px inside
        // 248px of space and pushed the roster off the screen. Tailwind's
        // `grid-cols-1` is `minmax(0, 1fr)`, which clamps.
        <ul className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {assigned.map((posting) => (
            <PostingCard
              key={posting.id}
              posting={posting}
              busy={busy === posting.id}
              canManage={roster.canManage}
              projectName={projectName}
              onPause={() => void setStatus(posting, "paused")}
              onResume={() => void setStatus(posting, "active")}
              onEdit={() => setEditing(posting)}
              onRemove={() => void release(posting)}
              onSetExecution={(patch) => void setExecution(posting, patch)}
            />
          ))}
        </ul>
      )}

      {wizardOpen ? (
        <AssignWizard
          projectId={projectId}
          projectName={projectName}
          bots={roster.available}
          roles={roster.roles}
          usage={usage}
          accounts={accounts}
          inline={false}
          onRosterRefresh={load}
          onClose={() => setWizardOpen(false)}
          onAssigned={assignmentComplete}
        />
      ) : null}

      {editing ? (
        <EditPostingDialog
          projectId={projectId}
          posting={editing}
          roles={roster.roles}
          inline={false}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function PostingCard({
  posting,
  busy,
  canManage,
  projectName,
  onPause,
  onResume,
  onEdit,
  onRemove,
  onSetExecution,
}: {
  posting: Posting;
  busy: boolean;
  canManage: boolean;
  projectName: string;
  onPause: () => void;
  onResume: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onSetExecution: (patch: { model?: string; workEffort?: string }) => void;
}) {
  const name = posting.bot?.name ?? "Unknown bot";
  const elevated = elevatedPermissions(posting.config);
  // Suggested models come from the bot's own provider; the bot's default is
  // always the first, honest option. A stored override outside the suggestion
  // list still renders — the row shows what is set, never a normalized guess.
  const suggestedModels = posting.bot
    ? findBotProvider(posting.bot.provider)?.suggestedModels ?? []
    : [];
  const modelOptions = Array.from(new Set([
    ...suggestedModels,
    ...(posting.model ? [posting.model] : []),
  ]));

  return (
    <li className="rounded-lg border border-line p-4">
      <div className="flex items-start gap-3">
        <Bot className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{name}</p>
          <p className="truncate text-sm text-faint">
            {posting.role?.name ?? "No role"} · {priorityLabel(posting.config.priority)} ·{" "}
            {posting.config.maxConcurrentTasks} at a time
          </p>
        </div>
        <StatusBadge tone={statusTone(posting.status)}>
          {posting.status === "active" ? "Active" : posting.status === "paused" ? "Paused" : "Released"}
        </StatusBadge>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-2 sm:block">
          <dt className="text-faint">Repository</dt>
          <dd className="text-muted">{repositoryAccessLabel(posting.config.repositoryAccess)}</dd>
        </div>
        <div className="flex justify-between gap-2 sm:block">
          <dt className="text-faint">Pipelines</dt>
          <dd className="text-muted">{pipelineAccessLabel(posting.config.pipelineAccess)}</dd>
        </div>
      </dl>

      {/* Execution preferences: which model this posting runs, and how hard
          it thinks. Saved on change through the owner/admin operation; the
          empty value clears the override back to the bot's own default. */}
      {canManage ? (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/*
            `min-w-0` on the cells and `w-full` on the controls.

            A select sizes itself to its widest option, and a model identifier
            is long — "Bot default (claude-opus-5-…)" is wider than a phone. An
            auto-sized grid track takes that as its minimum, so the whole
            posting card was pushed past the right edge of a 320px screen by
            one dropdown nobody had measured.
          */}
          <div className="min-w-0">
            <label htmlFor={`posting-model-${posting.id}`} className="field-label">Model</label>
            <select
              id={`posting-model-${posting.id}`}
              value={posting.model ?? ""}
              disabled={busy}
              onChange={(event) => onSetExecution({ model: event.target.value })}
              className="input w-full"
            >
              <option value="">
                Bot default{posting.bot?.model ? ` (${posting.bot.model})` : ""}
              </option>
              {modelOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label htmlFor={`posting-effort-${posting.id}`} className="field-label">Work effort</label>
            <select
              id={`posting-effort-${posting.id}`}
              value={posting.workEffort ?? "medium"}
              disabled={busy}
              onChange={(event) => onSetExecution({ workEffort: event.target.value })}
              className="input w-full"
            >
              {WORK_EFFORTS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-faint">
          Model: {posting.model ?? `bot default${posting.bot?.model ? ` (${posting.bot.model})` : ""}`} ·
          Effort: {posting.workEffort ?? "medium"}
        </p>
      )}

      {posting.config.responsibilities.length ? (
        <p className="mt-2 text-sm text-muted">
          {posting.config.responsibilities.join(" · ")}
        </p>
      ) : null}

      {elevated.length ? (
        <p className="mt-2 flex items-start gap-1.5 text-sm text-[var(--warning)]">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{elevated.join(" · ")}</span>
        </p>
      ) : null}

      {canManage ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {posting.status === "active" ? (
            <button
              type="button"
              onClick={onPause}
              disabled={busy}
              className="btn btn-secondary btn-sm"
              aria-label={`Pause ${name}`}
            >
              <Pause className="size-3.5" aria-hidden="true" />
              Pause
            </button>
          ) : (
            <button
              type="button"
              onClick={onResume}
              disabled={busy}
              className="btn btn-secondary btn-sm"
              aria-label={`Resume ${name}`}
            >
              <Play className="size-3.5" aria-hidden="true" />
              Resume
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            disabled={busy}
            className="btn btn-secondary btn-sm"
            aria-label={`Configure ${name}`}
          >
            <Settings2 className="size-3.5" aria-hidden="true" />
            Configure
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="btn btn-secondary btn-sm"
            aria-label={`Remove ${name} from ${projectName}`}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <X className="size-3.5" aria-hidden="true" />
            )}
            Remove
          </button>
        </div>
      ) : null}
    </li>
  );
}

/* --------------------------------------------------------------- the wizard */

function toConfigInput(config: AssignmentConfig) {
  return {
    preset: config.preset ?? undefined,
    responsibilities: [...config.responsibilities],
    // Keep the controlled textarea byte-for-byte while somebody is typing.
    // Normalization belongs at the write boundary: trimming in `onChange`
    // removes a trailing space before the next word can be entered.
    instructions: config.instructions?.trim() || undefined,
    repositoryAccess: config.repositoryAccess,
    branchStrategy: config.branchStrategy,
    canOpenPullRequest: config.canOpenPullRequest,
    canMergePullRequest: config.canMergePullRequest,
    pipelineAccess: config.pipelineAccess,
    environmentAccess: config.environmentAccess,
    tools: [...config.tools],
    requiresHumanApproval: config.requiresHumanApproval,
    maxConcurrentTasks: config.maxConcurrentTasks,
    priority: config.priority,
  };
}

/**
 * Picks the role whose slug matches a preset, so choosing "Tester" lands on
 * the organization's own Tester role rather than whichever one sorts first.
 */
function matchingRoleForPreset(roles: ProjectRole[], presetId: string): string | null {
  return roles.find((role) => role.slug === presetId)?.id ?? null;
}

function initialRoleForPreset(roles: ProjectRole[], presetId: string): string {
  return matchingRoleForPreset(roles, presetId) ?? roles[0]?.id ?? "";
}

function botCanBeSelected(bot: ProjectBot): boolean {
  return bot.assignable && !bot.alreadyOnThisProject;
}

function DialogShell({
  label,
  onClose,
  children,
  inline = false,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
  inline?: boolean;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  if (inline) {
    return <section aria-label={label}>{children}</section>;
  }

  return (
    <ModalDialog
      label={label}
      onRequestClose={onClose}
      initialFocusRef={closeButtonRef}
      className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/60 p-3 sm:p-6"
      panelClassName="relative my-auto w-full max-w-2xl rounded-2xl border border-line bg-surface p-4 shadow-2xl sm:p-6"
    >
      <button
        ref={closeButtonRef}
        type="button"
        onClick={onClose}
        className="btn btn-secondary btn-sm absolute right-3 top-3 size-9 px-0 sm:right-4 sm:top-4"
        aria-label="Close"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
      {children}
    </ModalDialog>
  );
}

function AssignWizard({
  projectId,
  projectName,
  bots,
  roles,
  usage,
  accounts,
  inline,
  onRosterRefresh,
  onClose,
  onAssigned,
}: {
  projectId: string;
  projectName: string;
  bots: ProjectBot[];
  roles: ProjectRole[];
  usage: UsageByAccount;
  accounts: LinkableAccount[];
  inline: boolean;
  onRosterRefresh: () => Promise<Roster | void> | Roster | void;
  onClose: () => void;
  onAssigned: () => Promise<void> | void;
}) {
  const [step, setStep] = useState<Step>("Select");
  const [selected, setSelected] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  // The Bot Manager linkage: which accounts are ticked for linking, and
  // whether a linking round-trip is in flight.
  const [linkSelected, setLinkSelected] = useState<string[]>([]);
  const [linking, setLinking] = useState(false);
  const [starterRoleSlug, setStarterRoleSlug] = useState("backend");
  const [starterRoleBusy, setStarterRoleBusy] = useState(false);
  const [createdRoles, setCreatedRoles] = useState<ProjectRole[]>([]);

  const effectiveRoles = useMemo(
    () => [
      ...roles,
      ...createdRoles.filter((created) => !roles.some((role) => role.id === created.id)),
    ],
    [roles, createdRoles],
  );

  /**
   * Connected accounts without an exact bot relationship. Credential names
   * are deliberately ignored here: only aiAccountId proves identity. The
   * provision RPC owns the guarded adoption of an eligible legacy bot.
   */
  const linkable = useMemo(
    () =>
      accounts.filter((account) =>
        accountCredentialChoice(account) !== null
          && !bots.some((bot) => bot.aiAccountId === account.id)),
    [accounts, bots],
  );

  const assignable = useMemo(() => bots.filter(botCanBeSelected), [bots]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return bots;
    return bots.filter((bot) =>
      `${bot.name} ${bot.providerLabel} ${bot.model}`.toLowerCase().includes(needle),
    );
  }, [bots, query]);

  const toggle = useCallback(
    (bot: ProjectBot) => {
      if (!botCanBeSelected(bot)) return;
      setSelected((current) => {
        if (current.includes(bot.id)) return current.filter((id) => id !== bot.id);
        if (current.length >= MAX_BOTS_PER_ASSIGNMENT) return current;
        return [...current, bot.id];
      });
      setDrafts((current) => {
        if (current[bot.id]) return current;
        // A bot's existing role is the better starting point than a guess; only
        // fall back to a preset when it has none.
        const preset = ROLE_PRESETS[0];
        const preservedConfig = bot.currentAssignmentConfig
          ? normalizeAssignmentConfig(toConfigInput(bot.currentAssignmentConfig))
          : null;
        return {
          ...current,
          [bot.id]: {
            roleId: bot.currentRoleId ?? initialRoleForPreset(effectiveRoles, preset.id),
            config: preservedConfig ?? normalizeAssignmentConfig({
                ...preset.config,
                responsibilities: [...preset.config.responsibilities],
                tools: [...preset.config.tools],
                preset: preset.id,
              }),
          },
        };
      });
    },
    [effectiveRoles],
  );

  /**
   * A newly onboarded organization intentionally owns its role definitions,
   * but that used to leave the first assignment at a blank required select
   * with a link away from the wizard. Adopt one of the existing, reviewed
   * starter templates through the same authorized and audited role API used by
   * Bot Manager, then apply its exact returned id to every selected draft.
   */
  const createStarterRole = useCallback(async () => {
    const template = BOT_ROLE_TEMPLATES.find((entry) => entry.slug === starterRoleSlug);
    if (!template) return;

    setStarterRoleBusy(true);
    setError("");
    try {
      const response = await fetch("/api/bot-roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          roleId: null,
          name: template.name,
          slug: template.slug,
          summary: template.summary,
          instructions: template.instructions,
          riskCeiling: template.riskCeiling,
          capabilities: [...template.capabilities],
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        role?: ProjectRole;
        error?: { code?: string; message?: string };
      };
      if (!response.ok || !body.role?.id) {
        if (response.status === 409 && body.error?.code === "bot_fabric_conflict") {
          const refreshed = await onRosterRefresh();
          const concurrentRole = refreshed?.roles.find((role) => role.slug === template.slug);
          if (concurrentRole) {
            setCreatedRoles((current) => (
              current.some((entry) => entry.id === concurrentRole.id)
                ? current
                : [...current, concurrentRole]
            ));
            setDrafts((current) => {
              const next = { ...current };
              for (const id of selected) {
                const draft = next[id];
                if (draft && !draft.roleId) {
                  next[id] = { ...draft, roleId: concurrentRole.id };
                }
              }
              return next;
            });
            return;
          }
        }
        throw new Error(body.error?.message ?? "The starter role could not be added.");
      }

      const role = body.role;
      setCreatedRoles((current) => (
        current.some((entry) => entry.id === role.id) ? current : [...current, role]
      ));
      setDrafts((current) => {
        const next = { ...current };
        for (const id of selected) {
          const draft = next[id];
          if (draft && !draft.roleId) next[id] = { ...draft, roleId: role.id };
        }
        return next;
      });
      await onRosterRefresh();
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : "The starter role could not be added.");
    } finally {
      setStarterRoleBusy(false);
    }
  }, [starterRoleSlug, selected, onRosterRefresh]);

  const selectAll = useCallback(() => {
    const everything = assignable.slice(0, MAX_BOTS_PER_ASSIGNMENT);
    if (selected.length === everything.length) {
      setSelected([]);
      return;
    }
    for (const bot of everything) {
      if (!selected.includes(bot.id)) toggle(bot);
    }
  }, [assignable, selected, toggle]);

  /**
   * Create a bot for each ticked account — the same provision call the Bot
   * Manager's own Create Bot uses, aimed at that account's credential slot —
   * then read the roster back and select the exact bot ids the server returned.
   * "Link" means exactly what it says: those Bot Manager accounts become
   * selected, staffable bots here without credential-ref inference.
   */
  const linkAccounts = useCallback(async () => {
    setLinking(true);
    setError("");
    const botIds: string[] = [];
    try {
      for (const id of linkSelected) {
        const account = linkable.find((entry) => entry.id === id);
        if (!account) continue;
        const credential = accountCredentialChoice(account);
        if (!credential) {
          throw new Error(`${account.displayName} has an unrecognized sign-in slot. Reconnect it and try again.`);
        }
        const response = await fetch("/api/bots/connect/provision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: account.provider,
            credential,
            aiAccountId: account.id,
            additional: false,
          }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          provisioned?: boolean;
          outcome?: string;
          botId?: string;
          reason?: string;
          error?: { message?: string };
        };
        // "skipped" arrives as a 200 with a reason; celebrating it is how a
        // linked account produced no bot and no sentence.
        if (!response.ok || !body.botId
          || (body.outcome !== "created" && body.outcome !== "bound" && body.outcome !== "exists")) {
          throw new Error(
            body.reason
              ?? body.error?.message
              ?? `A bot for ${account.displayName} could not be created.`,
          );
        }
        botIds.push(body.botId);
      }
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "Those accounts could not be linked.");
    }
    // Whatever succeeded before a failure is real: read the roster back,
    // select the bots the linked accounts produced, and let the parent
    // refresh so the list behind the wizard agrees.
    if (botIds.length) {
      try {
        const response = await fetch(`/api/projects/${projectId}/bots`, { cache: "no-store" });
        if (response.ok) {
          const body = (await response.json()) as { available?: ProjectBot[] };
          for (const created of (body.available ?? []).filter(
            (entry) => botIds.includes(entry.id) && botCanBeSelected(entry),
          )) {
            toggle(created);
          }
        }
      } catch {
        /* The bots exist either way; the refreshed roster below shows them. */
      }
      setLinkSelected([]);
      await onRosterRefresh();
    }
    setLinking(false);
  }, [linkSelected, linkable, projectId, toggle, onRosterRefresh]);

  const selectedBots = useMemo(
    () => selected.map((id) => bots.find((bot) => bot.id === id)).filter((bot): bot is ProjectBot => Boolean(bot)),
    [selected, bots],
  );

  const totalConcurrency = useMemo(
    () => selected.reduce((sum, id) => sum + (drafts[id]?.config.maxConcurrentTasks ?? 1), 0),
    [selected, drafts],
  );

  const anyElevated = useMemo(
    () => selected.some((id) => elevatedPermissions(drafts[id]?.config ?? LEAST_PRIVILEGE_CONFIG).length > 0),
    [selected, drafts],
  );

  const everySelectedBotHasRole = useMemo(
    () => selected.length > 0 && selected.every((id) => Boolean(drafts[id]?.roleId)),
    [selected, drafts],
  );

  const moving = useMemo(
    () => selectedBots.filter((bot) => bot.currentProjectId && !bot.alreadyOnThisProject),
    [selectedBots],
  );

  async function confirm() {
    setBusy(true);
    setError("");
    const requested = selected.map((id) => ({
      botId: id,
      roleId: drafts[id].roleId,
      config: drafts[id].config,
      expectedAssignmentId: bots.find((bot) => bot.id === id)?.currentAssignmentId ?? null,
      expectedProjectId: bots.find((bot) => bot.id === id)?.currentAssignmentProjectId ?? null,
      expectedAssignmentRevision: bots.find((bot) => bot.id === id)?.currentAssignmentRevision ?? null,
    }));
    try {
      const response = await fetch(`/api/projects/${projectId}/bots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bots: requested.map((entry) => ({
            botId: entry.botId,
            roleId: entry.roleId,
            config: toConfigInput(entry.config),
            expectedAssignmentId: entry.expectedAssignmentId,
            expectedProjectId: entry.expectedProjectId,
            expectedAssignmentRevision: entry.expectedAssignmentRevision,
          })),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        assignments?: Array<{
          id: string;
          botId: string;
          projectId: string;
          roleId: string;
          status: string;
          config: AssignmentConfig;
        }>;
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "These bots could not be assigned.");
        return;
      }

      const returnedByBot = new Map(
        (body.assignments ?? []).map((assignment) => [assignment.botId, assignment]),
      );
      const exactResponse = (body.assignments ?? []).length === requested.length
        && returnedByBot.size === requested.length
        && requested.every((expected) => {
          const actual = returnedByBot.get(expected.botId);
          return Boolean(actual?.id)
            && actual?.projectId === projectId
            && actual.roleId === expected.roleId
            && actual.status === "active"
            && JSON.stringify(toConfigInput(actual.config))
              === JSON.stringify(toConfigInput(expected.config));
        });
      if (!exactResponse) {
        setError("The server did not confirm the exact assignments. Reload the roster before trying again.");
        await onRosterRefresh();
        return;
      }

      // Verify the committed read model too. A 201 response is not enough if
      // the roster immediately reads back a different role or grant.
      const readbackResponse = await fetch(`/api/projects/${projectId}/bots`, { cache: "no-store" });
      const readbackBody = (await readbackResponse.json().catch(() => ({}))) as {
        assigned?: Posting[];
      };
      const readbackByBot = new Map(
        (readbackBody.assigned ?? []).map((assignment) => [assignment.botId, assignment]),
      );
      const exactReadback = readbackResponse.ok && requested.every((expected) => {
        const returned = returnedByBot.get(expected.botId);
        const actual = readbackByBot.get(expected.botId);
        return actual?.id === returned?.id
          && actual?.projectId === projectId
          && actual.roleId === expected.roleId
          && actual.status === "active"
          && JSON.stringify(toConfigInput(actual.config))
            === JSON.stringify(toConfigInput(expected.config));
      });
      if (!exactReadback) {
        setError("The assignments were saved but their exact readback could not be verified. Reload the roster before trying again.");
        await onRosterRefresh();
        return;
      }

      await onAssigned();
    } catch {
      setError("These bots could not be assigned.");
    } finally {
      setBusy(false);
    }
  }

  const stepIndex = STEPS.indexOf(step);

  return (
    <DialogShell label={`Assign bots to ${projectName}`} onClose={onClose} inline={inline}>
      <div className={inline ? undefined : "pr-10"}>
        {inline ? null : <h3 className="text-base font-semibold text-foreground">Assign Bots</h3>}
        <p className="mt-1 text-sm text-muted">
          Choose bots for {projectName}, then set what each one is responsible for.
        </p>
      </div>

      <ol className="mt-4 flex items-center gap-2 text-sm" aria-label="Assignment steps">
        {STEPS.map((entry, index) => (
          <li key={entry} className="flex items-center gap-2">
            <span
              aria-current={entry === step ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
                index === stepIndex
                  ? "bg-[var(--accent)] text-white"
                  : index < stepIndex
                    ? "text-accent"
                    : "text-faint",
              )}
            >
              {index < stepIndex ? <Check className="size-3.5" aria-hidden="true" /> : null}
              {entry}
            </span>
            {index < STEPS.length - 1 ? (
              <span className="text-faint" aria-hidden="true">
                /
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      <div className="mt-4 max-h-[55vh] overflow-y-auto">
        {step === "Select" ? (
          <>
            <SelectStep
              bots={shown}
              usage={usage}
              selected={selected}
              query={query}
              onQuery={setQuery}
              onToggle={toggle}
              onSelectAll={selectAll}
              allSelected={assignable.length > 0 && selected.length === assignable.length}
              hasLinkableAccounts={linkable.length > 0}
            />

            {linkable.length > 0 ? (
              <section className="mt-4 rounded-xl border border-line p-3 sm:p-4" aria-label="Link accounts from the Bot Manager">
                <h4 className="text-sm font-semibold text-foreground">From your Bot Manager</h4>
                <p className="mt-1 text-xs text-muted">
                  These connected AI accounts do not have an exact account-bound bot. Link or
                  repair each one through the verified Bot Manager path; it can adopt an eligible
                  legacy bot instead of creating a duplicate.
                </p>
                <ul className="mt-2 space-y-2">
                  {linkable.map((account) => {
                    const checked = linkSelected.includes(account.id);
                    return (
                      <li key={account.id}>
                        <label
                          className={cn(
                            "flex cursor-pointer items-center gap-3 rounded-lg border p-3",
                            checked ? "border-[var(--accent-border)] bg-[var(--accent-surface)]" : "border-line",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={linking}
                            onChange={() =>
                              setLinkSelected((current) =>
                                current.includes(account.id)
                                  ? current.filter((id) => id !== account.id)
                                  : [...current, account.id],
                              )
                            }
                            className="size-4 shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-foreground">{account.displayName}</span>
                            <span className="block text-xs text-muted">{account.providerLabel} · needs exact bot link</span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <button
                  type="button"
                  onClick={() => void linkAccounts()}
                  disabled={linking || linkSelected.length === 0}
                  className="btn btn-secondary btn-sm mt-3"
                >
                  {linking ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="size-3.5" aria-hidden="true" />
                  )}
                  Link or repair {linkSelected.length > 1 ? `${linkSelected.length} bots` : "bot"}
                </button>
              </section>
            ) : null}
          </>
        ) : null}

        {step === "Configure" ? (
          <div className="space-y-4">
            {effectiveRoles.length === 0 ? (
              <section
                className="rounded-xl border border-[var(--accent-border)] bg-[var(--accent-surface)] p-4"
                aria-label="Add a starter bot role"
              >
                <h4 className="text-sm font-semibold text-foreground">Add your first bot role</h4>
                <p className="mt-1 text-xs text-muted">
                  Every project posting needs an organization role. Choose a reviewed starter;
                  it is saved through the same audited role control as Bot Manager and remains
                  yours to edit.
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="min-w-0 flex-1">
                    <span className="label">Starter role</span>
                    <select
                      aria-label="Starter role"
                      value={starterRoleSlug}
                      onChange={(event) => setStarterRoleSlug(event.target.value)}
                      className="input mt-1.5 w-full"
                    >
                      {BOT_ROLE_TEMPLATES.map((template) => (
                        <option key={template.slug} value={template.slug}>{template.name}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => void createStarterRole()}
                    disabled={starterRoleBusy}
                    className="btn btn-primary btn-sm"
                  >
                    {starterRoleBusy ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Plus className="size-3.5" aria-hidden="true" />
                    )}
                    Add starter role
                  </button>
                </div>
              </section>
            ) : null}
            {selectedBots.map((bot) => (
              <ConfigureCard
                key={bot.id}
                bot={bot}
                roles={effectiveRoles}
                draft={drafts[bot.id]}
                onChange={(draft) => setDrafts((current) => ({ ...current, [bot.id]: draft }))}
                onRemove={() => toggle(bot)}
              />
            ))}
          </div>
        ) : null}

        {step === "Review" ? (
          <ReviewStep
            projectName={projectName}
            bots={selectedBots}
            drafts={drafts}
            roles={effectiveRoles}
            moving={moving}
            totalConcurrency={totalConcurrency}
          />
        ) : null}
      </div>

      {step === "Review" && anyElevated ? (
        <label className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning)]">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="mt-0.5 size-4 shrink-0"
          />
          <span>
            One or more of these bots has elevated permissions. I have reviewed what each bot may
            do on {projectName}.
          </span>
        </label>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        <p className="text-sm text-faint">
          {selected.length} {selected.length === 1 ? "bot" : "bots"} selected
        </p>
        <div className="flex flex-wrap gap-2">
          {inline && stepIndex === 0 ? (
            <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
              Cancel
            </button>
          ) : null}
          {stepIndex > 0 ? (
            <button
              type="button"
              onClick={() => setStep(STEPS[stepIndex - 1])}
              className="btn btn-secondary btn-sm"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Back
            </button>
          ) : null}

          {step === "Review" ? (
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={busy || selected.length === 0 || (anyElevated && !acknowledged)}
              className="btn btn-primary btn-sm"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
              Confirm
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep(STEPS[stepIndex + 1])}
              disabled={
                selected.length === 0 || (step === "Configure" && !everySelectedBotHasRole)
              }
              className="btn btn-primary btn-sm"
            >
              Next
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </DialogShell>
  );
}

function SelectStep({
  bots,
  usage,
  selected,
  query,
  onQuery,
  onToggle,
  onSelectAll,
  allSelected,
  hasLinkableAccounts,
}: {
  bots: ProjectBot[];
  usage: UsageByAccount;
  selected: string[];
  query: string;
  onQuery: (value: string) => void;
  onToggle: (bot: ProjectBot) => void;
  onSelectAll: () => void;
  allSelected: boolean;
  hasLinkableAccounts: boolean;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search bots…"
            aria-label="Search bots"
            className="input w-full pl-9"
          />
        </div>
        <button type="button" onClick={onSelectAll} className="btn btn-secondary btn-sm">
          {allSelected ? "Clear all" : "Select All"}
        </button>
      </div>

      {bots.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line p-4 text-sm text-muted">
          No bots match that search.{" "}
          {hasLinkableAccounts ? (
            <>Link one of your Bot Manager accounts below, or connect another on the{" "}</>
          ) : (
            <>Connect a bot on the{" "}</>
          )}
          <Link href="/solutions/bot-manager" className="underline underline-offset-2 hover:text-foreground">
            Bot Manager
          </Link>{" "}
          to staff this project.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {bots.map((bot) => {
            const checked = selected.includes(bot.id);
            const windows = bot.aiAccountId ? usage[bot.aiAccountId] ?? [] : [];
            const selectable = botCanBeSelected(bot);
            return (
              <li key={bot.id}>
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                    selectable
                      ? checked
                        ? "border-[var(--accent)] bg-surface-raised"
                        : "border-line hover:border-line-strong"
                      : "cursor-not-allowed border-line opacity-70",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!selectable}
                    onChange={() => onToggle(bot)}
                    aria-label={`Select ${bot.name}`}
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {bot.name}
                      </span>
                      <StatusBadge tone={bot.readinessTone}>{bot.readinessLabel}</StatusBadge>
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-faint">
                      {bot.providerLabel} · {bot.model}
                    </span>

                    {/* Naming the project it would leave is the difference
                        between an informed choice and a surprise. */}
                    {bot.alreadyOnThisProject ? (
                      <span className="mt-1 block text-sm text-muted">
                        Already on this project — use Configure, Pause, or Resume on its posting.
                      </span>
                    ) : bot.currentProjectName ? (
                      <span className="mt-1 block text-sm text-[var(--warning)]">
                        Currently on {bot.currentProjectName}. Assigning it here moves it.
                      </span>
                    ) : null}

                    {!selectable && bot.blockedReason ? (
                      <span className="mt-1 block text-sm text-[var(--warning)]">
                        {bot.blockedReason}
                      </span>
                    ) : null}

                    {windows.length ? (
                      <span className="mt-1 block text-sm text-faint">
                        {windows
                          .map((window) => `${window.label} ${Math.round(window.usedPercent)}%`)
                          .join(" · ")}
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ConfigureCard({
  bot,
  roles,
  draft,
  onChange,
  onRemove,
}: {
  bot: ProjectBot;
  roles: ProjectRole[];
  draft: Draft;
  onChange: (draft: Draft) => void;
  onRemove: () => void;
}) {
  const [invalid, setInvalid] = useState("");

  /**
   * Applies a change and reports an incoherent grant instead of storing one.
   * Silently repairing "merge without approval" would save something nobody
   * agreed to under a label they did.
   */
  function apply(partial: Partial<AssignmentConfig>) {
    try {
      const next = normalizeAssignmentConfig(toConfigInput({ ...draft.config, ...partial }));
      setInvalid("");
      // `normalizeAssignmentConfig` protects every coupled permission choice,
      // but the Instructions textarea is still an in-progress editor value.
      // Preserve it across changes to neighboring controls; it is normalized
      // only when `toConfigInput` serializes the eventual write.
      onChange({
        ...draft,
        config: { ...next, instructions: draft.config.instructions },
      });
    } catch (error) {
      setInvalid(error instanceof Error ? error.message : "That combination is not allowed.");
    }
  }

  function applyPreset(presetId: string) {
    const preset = ROLE_PRESETS.find((entry) => entry.id === presetId);
    if (!preset) return;
    setInvalid("");
    onChange({
      roleId: matchingRoleForPreset(roles, preset.id) ?? draft.roleId,
      config: normalizeAssignmentConfig({
        ...preset.config,
        responsibilities: [...preset.config.responsibilities],
        tools: [...preset.config.tools],
        preset: preset.id,
        instructions: draft.config.instructions,
      }),
    });
  }

  return (
    <section className="rounded-lg border border-line p-4">
      <div className="flex items-start gap-3">
        <Bot className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{bot.name}</p>
          <p className="truncate text-sm text-faint">{bot.providerLabel}</p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="btn btn-secondary btn-sm size-8 px-0"
          aria-label={`Remove ${bot.name} from this assignment`}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      <fieldset className="mt-3">
        <legend className="label">Preset</legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {ROLE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset.id)}
              aria-pressed={draft.config.preset === preset.id}
              title={preset.summary}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                draft.config.preset === preset.id
                  ? "border-[var(--accent)] text-accent"
                  : "border-line text-muted hover:border-line-strong",
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Role</span>
          <select
            value={draft.roleId}
            onChange={(event) => onChange({ ...draft, roleId: event.target.value })}
            className="input mt-1.5 w-full"
            aria-label={`Role for ${bot.name}`}
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
          {roles.length === 0 ? (
            /*
             * The parent wizard offers the inline, audited starter-role action.
             * Keep the custom-role route visible here too without telling a
             * first-time owner to abandon this assignment and "come back."
             */
            <span className="mt-1.5 block text-xs text-faint">
              No roles yet. Add a starter role above to continue, or manage custom roles in{" "}
              <Link
                href="/solutions/bot-manager"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Bot Manager
              </Link>
              .
            </span>
          ) : null}
        </label>

        <label className="block">
          <span className="label">Pipeline access</span>
          <select
            value={draft.config.pipelineAccess}
            onChange={(event) => apply({ pipelineAccess: event.target.value as PipelineAccess })}
            className="input mt-1.5 w-full"
            aria-label={`Pipeline access for ${bot.name}`}
          >
            {PIPELINE_ACCESS_LEVELS.map((value) => (
              <option key={value} value={value}>
                {pipelineAccessLabel(value)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="label">Repository access</span>
          <select
            value={draft.config.repositoryAccess}
            onChange={(event) =>
              apply({
                repositoryAccess: event.target.value as RepositoryAccess,
                // Narrowing repository access withdraws what it can no longer
                // support, rather than leaving a grant the server will refuse.
                ...(event.target.value === "write"
                  ? {}
                  : { canOpenPullRequest: false, canMergePullRequest: false }),
              })
            }
            className="input mt-1.5 w-full"
            aria-label={`Repository access for ${bot.name}`}
          >
            {REPOSITORY_ACCESS_LEVELS.map((value) => (
              <option key={value} value={value}>
                {repositoryAccessLabel(value)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="label">Branch strategy</span>
          <select
            value={draft.config.branchStrategy}
            onChange={(event) => apply({ branchStrategy: event.target.value as BranchStrategy })}
            className="input mt-1.5 w-full"
            aria-label={`Branch strategy for ${bot.name}`}
          >
            {BRANCH_STRATEGIES.map((value) => (
              <option key={value} value={value}>
                {branchStrategyLabel(value)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="label">Environment access</span>
          <select
            value={draft.config.environmentAccess}
            onChange={(event) =>
              apply({
                environmentAccess: event.target.value as EnvironmentAccess,
                ...(event.target.value === "production" ? { requiresHumanApproval: true } : {}),
              })
            }
            className="input mt-1.5 w-full"
            aria-label={`Environment access for ${bot.name}`}
          >
            {ENVIRONMENT_ACCESS_LEVELS.map((value) => (
              <option key={value} value={value}>
                {environmentAccessLabel(value)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="label">Priority</span>
          <select
            value={String(draft.config.priority)}
            onChange={(event) => apply({ priority: Number(event.target.value) })}
            className="input mt-1.5 w-full"
            aria-label={`Priority for ${bot.name}`}
          >
            {[0, 1, 2, 3].map((value) => (
              <option key={value} value={String(value)}>
                {priorityLabel(value)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="label">Tasks at once</span>
          <input
            type="number"
            min={1}
            max={MAX_CONCURRENT_TASKS}
            value={draft.config.maxConcurrentTasks}
            onChange={(event) =>
              apply({
                maxConcurrentTasks: Math.min(
                  MAX_CONCURRENT_TASKS,
                  Math.max(1, Number(event.target.value) || 1),
                ),
              })
            }
            className="input mt-1.5 w-full"
            aria-label={`Concurrent tasks for ${bot.name}`}
          />
        </label>
      </div>

      <div className="mt-3 space-y-2">
        <label className="flex items-start gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={draft.config.canOpenPullRequest}
            disabled={draft.config.repositoryAccess !== "write"}
            onChange={(event) =>
              apply({
                canOpenPullRequest: event.target.checked,
                ...(event.target.checked ? {} : { canMergePullRequest: false }),
              })
            }
            className="mt-0.5 size-4 shrink-0"
          />
          <span>
            Can open pull requests
            {draft.config.repositoryAccess !== "write" ? (
              <span className="block text-faint">Needs repository write access.</span>
            ) : null}
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={draft.config.canMergePullRequest}
            disabled={!draft.config.canOpenPullRequest}
            onChange={(event) =>
              apply({ canMergePullRequest: event.target.checked, requiresHumanApproval: true })
            }
            className="mt-0.5 size-4 shrink-0"
          />
          <span>
            Can merge pull requests
            <span className="block text-faint">Always waits for a person to approve.</span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={draft.config.requiresHumanApproval}
            disabled={draft.config.canMergePullRequest || draft.config.environmentAccess === "production"}
            onChange={(event) => apply({ requiresHumanApproval: event.target.checked })}
            className="mt-0.5 size-4 shrink-0"
          />
          <span>Work needs a person to approve it before it lands</span>
        </label>
      </div>

      <label className="mt-3 block">
        <span className="label">Instructions</span>
        <textarea
          value={draft.config.instructions ?? ""}
          onChange={(event) => onChange({
            ...draft,
            config: { ...draft.config, instructions: event.target.value },
          })}
          rows={2}
          maxLength={4000}
          placeholder="Anything this bot should always do on this project."
          aria-label={`Instructions for ${bot.name}`}
          className="input mt-1.5 w-full"
        />
      </label>

      {draft.config.responsibilities.length ? (
        <p className="mt-2 text-sm text-faint">
          Responsibilities: {draft.config.responsibilities.join(" · ")}
        </p>
      ) : null}

      {invalid ? (
        <p role="alert" className="mt-2 text-sm text-[var(--danger)]">
          {invalid}
        </p>
      ) : null}
    </section>
  );
}

function ReviewStep({
  projectName,
  bots,
  drafts,
  roles,
  moving,
  totalConcurrency,
}: {
  projectName: string;
  bots: ProjectBot[];
  drafts: Record<string, Draft>;
  roles: ProjectRole[];
  moving: ProjectBot[];
  totalConcurrency: number;
}) {
  const roleName = (id: string) => roles.find((role) => role.id === id)?.name ?? "No role";

  return (
    <div>
      <p className="text-sm text-muted">
        You are about to assign {bots.length} {bots.length === 1 ? "bot" : "bots"} to {projectName}.
      </p>

      {moving.length ? (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning)]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {moving.map((bot) => `${bot.name} leaves ${bot.currentProjectName}`).join("; ")}. A bot
            serves one project at a time.
          </span>
        </p>
      ) : null}

      <ul className="mt-3 space-y-2">
        {bots.map((bot) => {
          const draft = drafts[bot.id];
          const elevated = elevatedPermissions(draft.config);
          return (
            <li key={bot.id} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Bot className="size-4 shrink-0 text-accent" aria-hidden="true" />
                <span className="text-sm font-medium text-foreground">{bot.name}</span>
                <span className="text-sm text-faint">{roleName(draft.roleId)}</span>
              </div>
              <p className="mt-1 text-sm text-muted">
                {repositoryAccessLabel(draft.config.repositoryAccess)} ·{" "}
                {pipelineAccessLabel(draft.config.pipelineAccess)} ·{" "}
                {environmentAccessLabel(draft.config.environmentAccess)} ·{" "}
                {priorityLabel(draft.config.priority)} · {draft.config.maxConcurrentTasks} at a time
              </p>
              {elevated.length ? (
                <p className="mt-1 text-sm text-[var(--warning)]">{elevated.join(" · ")}</p>
              ) : (
                <p className="mt-1 text-sm text-faint">No elevated permissions.</p>
              )}
            </li>
          );
        })}
      </ul>

      <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-1 rounded-lg border border-line p-3 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-2">
          <dt className="text-faint">Total bots</dt>
          <dd className="text-foreground">{bots.length}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-faint">Project</dt>
          <dd className="truncate text-foreground">{projectName}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-faint">Estimated concurrency</dt>
          <dd className="text-foreground">{totalConcurrency} tasks at once</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-faint">Approval required</dt>
          <dd className="text-foreground">
            {bots.filter((bot) => drafts[bot.id].config.requiresHumanApproval).length} of{" "}
            {bots.length}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-sm text-faint">
        Assignment is routing intent. No worker executes because of it in this phase.
      </p>
    </div>
  );
}

/* ------------------------------------------------------ editing one posting */

function EditPostingDialog({
  projectId,
  posting,
  roles,
  inline,
  onClose,
  onSaved,
}: {
  projectId: string;
  posting: Posting;
  roles: ProjectRole[];
  inline: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<Draft>({
    roleId: posting.roleId,
    config: posting.config,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/bots/${posting.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedRevision: posting.revision,
          roleId: draft.roleId,
          config: toConfigInput(draft.config),
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "This bot could not be reconfigured.");
        return;
      }
      await onSaved();
    } catch {
      setError("This bot could not be reconfigured.");
    } finally {
      setBusy(false);
    }
  }

  const bot = posting.bot;
  if (!bot) return null;

  return (
    <DialogShell label={`Configure ${bot.name}`} onClose={onClose} inline={inline}>
      <div className={inline ? undefined : "pr-10"}>
        <h3 className="text-base font-semibold text-foreground">Configure {bot.name}</h3>
        <p className="mt-1 text-sm text-muted">
          Change what this bot is responsible for and what it may reach.
        </p>
      </div>

      <div className="mt-4 max-h-[60vh] overflow-y-auto">
        <ConfigureCard
          bot={bot}
          roles={roles}
          draft={draft}
          onChange={setDraft}
          onRemove={onClose}
        />
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="btn btn-primary btn-sm"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
          Save changes
        </button>
      </div>
    </DialogShell>
  );
}
