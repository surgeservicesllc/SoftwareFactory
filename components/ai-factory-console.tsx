"use client";

import {
  ArrowRight,
  Bot,
  Boxes,
  Check,
  Factory,
  GitBranch,
  Loader2,
  PlugZap,
  Plus,
  Settings2,
  Terminal,
  Workflow,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { AddProjectForm } from "@/components/add-project-form";
import { BotManagerHome } from "@/components/bot-manager/home";
import { CommandComposer } from "@/components/command-composer";
import { ConnectionsConsole } from "@/components/connections-console";
import { ModalDialog } from "@/components/modal-dialog";
import { PipelineTemplatesManager } from "@/components/pipeline-templates-manager";
import { pipelineStage, type PipelineTemplateSummary } from "@/components/pipelines-console";
import { ProjectAgentSelector } from "@/components/project-agent-selection";
import { ProjectBots } from "@/components/project-bots";
import { BlockedState, Card, PageHeader, StatusBadge } from "@/components/ui";
import {
  assignmentPostingIsConfigured,
  LEAST_PRIVILEGE_CONFIG,
  type AssignmentConfig,
} from "@/lib/bots/assignment-config";
import { cn } from "@/lib/cn";

/**
 * AI Factory: the guided end-to-end journey with the real controls opening
 * as overlays over this page. Choosing an option — create a project, review
 * templates, assign a bot, issue a command — opens the same component the
 * rest of the console uses inside a dialog; finishing there closes it and
 * lands you back here with the selection already reflected, because
 * completion is derived from the live records each control produces — a
 * connected installation, a project, an assignment, a saved command — never
 * from a stored wizard state. That is what makes progress survive refresh
 * and navigation by construction, and what makes this page unable to
 * disagree with the rest of the console.
 */

/** One description for the page, whatever state it is able to render in. */
const PAGE_DESCRIPTION =
  "From new project to shipped pull request: the whole journey, one guided path over your live workspace.";

const FACTORY_SELECTION_STORAGE_PREFIX = "softwarefactory:ai-factory:selected-project:";

function readFactorySelection(organizationId: string): string | null {
  if (!organizationId || typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(`${FACTORY_SELECTION_STORAGE_PREFIX}${organizationId}`);
  } catch {
    return null;
  }
}

function writeFactorySelection(organizationId: string, projectId: string) {
  if (!organizationId || !projectId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${FACTORY_SELECTION_STORAGE_PREFIX}${organizationId}`, projectId);
  } catch {
    // Storage can be disabled. The live project records remain authoritative;
    // only the convenience of restoring this view is lost.
  }
}

type StepId =
  | "connect_github"
  | "create_project"
  | "pipeline"
  | "select_agents"
  | "connect_bots"
  | "assign_bots"
  | "configure_bots"
  | "command"
  | "watch";

type FactoryData = {
  activeOrganizationId: string;
  connectedInstallations: number;
  repositories: number;
  projects: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; status: string }>;
  bots: Array<{
    id: string;
    name: string;
    aiAccountId: string | null;
    currentReadiness: string;
  }>;
  assignments: Array<{
    id: string;
    botId: string;
    projectId: string | null;
    status: string;
    configured: boolean;
  }>;
  /** Missing/false means assignment-derived progress must fail closed. */
  assignmentsComplete: boolean;
  commands: Array<{
    id: string;
    prompt: string;
    status: string;
    executionMode: "manual" | "record_only" | "unknown";
    project: { id: string; name: string } | null;
  }>;
  pipelines: Array<{ projectId: string; templateKey: string; name: string }>;
  /** Which logical agents each project's factory includes, and whether the
   * selection store exists on this database at all. */
  agentSelections: Array<{ projectId: string; agentId: string; agentName: string }>;
  agentSelectionsAvailable: boolean;
  /**
   * Whether anything actually executes a command, read from the same
   * `/api/bots` field the bot fabric already publishes rather than restated
   * here. A journey whose last step describes shipping must say when nothing
   * ships; the page used to promise "every run lands as a draft pull request"
   * while the executor was Not Connected and a submitted command sat queued.
   */
  executor: { connected: boolean; label: string; detail: string };
  /** Pipeline templates this tenant recorded of its own, from Supabase. */
  customTemplates: number;
};

type State =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "unavailable" }
  | { kind: "setup" }
  | { kind: "ready"; data: FactoryData; stale: boolean };

function staleOrUnavailable(current: State): State {
  return current.kind === "ready"
    ? { ...current, stale: true }
    : { kind: "unavailable" };
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/**
 * The overlay every step opens in. Same shell idiom as the console's other
 * dialogs; top-aligned and scrollable because whole consoles render inside.
 * Closing — the X, the backdrop, or Escape — always returns to the page,
 * and the caller refreshes the journey on close so whatever was selected in
 * here is already showing when the overlay is gone.
 */
function StepOverlay({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description: string;
  onClose: () => boolean | void | Promise<boolean | void>;
  children: React.ReactNode;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const closingRef = useRef(false);
  const [closePending, setClosePending] = useState(false);
  const [closeError, setCloseError] = useState("");

  const requestClose = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosePending(true);
    setCloseError("");
    try {
      const canClose = await onClose();
      if (canClose === false) {
        closingRef.current = false;
        setClosePending(false);
      }
    } catch {
      closingRef.current = false;
      setClosePending(false);
      setCloseError("The dialog could not close safely. Try again.");
    }
  }, [onClose]);

  return (
    <ModalDialog
      label={title}
      onRequestClose={() => void requestClose()}
      initialFocusRef={closeButtonRef}
      ariaBusy={closePending}
      className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/60 p-3 sm:p-6"
      panelClassName="relative my-auto w-full max-w-3xl rounded-2xl border border-line bg-surface p-4 shadow-2xl sm:p-6"
    >
      <button
        type="button"
        ref={closeButtonRef}
        onClick={() => void requestClose()}
        disabled={closePending}
        className="btn btn-secondary btn-sm absolute right-3 top-3 z-10 size-9 px-0 sm:right-4 sm:top-4"
        aria-label="Close"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
      <h3 className="pr-12 text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-1 pr-12 text-sm text-muted">{description}</p>
      {closeError ? <p className="mt-2 text-sm text-danger" role="alert">{closeError}</p> : null}
      <div className="mt-4">{children}</div>
    </ModalDialog>
  );
}

export function AiFactoryConsole({ builtIns }: { builtIns: readonly PipelineTemplateSummary[] }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  // Which step's control is open as an overlay. Nothing opens on its own —
  // an uninvited modal is a trap, not a guide — and closing always lands
  // back on the journey with the fresh records already read.
  const [openStep, setOpenStep] = useState<StepId | null>(null);
  // Most embedded controls can close immediately. Account connection is the
  // exception: while its broker POST/session is live it registers a guard
  // that must confirm server cancellation before this owner unmounts it.
  const overlayCloseGuardRef = useRef<(() => Promise<boolean>) | null>(null);
  const setOverlayCloseGuard = useCallback((guard: (() => Promise<boolean>) | null) => {
    overlayCloseGuardRef.current = guard;
  }, []);
  /**
   * Which factory the journey is showing, and whether a brand-new one is being
   * started. Both are a *view* over live records, never a substitute for them:
   * clearing the selection cannot mark a finished step unfinished for a
   * project that still exists, it only stops pointing at that project.
   */
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  // Refs let an in-flight refresh consult the latest selection/new-factory
  // intent without rebuilding the polling callback or restoring an older
  // project over a choice the person just made.
  const activeProjectIdRef = useRef<string | null>(null);
  const activeOrganizationIdRef = useRef<string | null>(null);
  // Refreshes can overlap (polling, closing an overlay, and a control's own
  // completion all call `load`). Only the newest complete snapshot may win;
  // otherwise a slower older response can visibly undo just-saved progress.
  const loadGenerationRef = useRef(0);
  const [startingNewFactory, setStartingNewFactory] = useState(false);
  const startingNewFactoryRef = useRef(false);
  // Creation returns an exact server-issued id. Keep that identity paired with
  // its organization until the live project snapshot contains that same row;
  // another tab or member may create a different project in the meantime.
  const pendingCreatedProjectRef = useRef<{
    organizationId: string;
    projectId: string;
  } | null>(null);

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    const isCurrent = () => loadGenerationRef.current === generation;
    try {
      const results = await Promise.allSettled([
        fetch("/api/github/connections", { cache: "no-store" }),
        fetch("/api/projects", { cache: "no-store" }),
        fetch("/api/ai-accounts", { cache: "no-store" }),
        fetch("/api/bots", { cache: "no-store" }),
        fetch("/api/commands", { cache: "no-store" }),
        fetch("/api/project-pipelines", { cache: "no-store" }),
        fetch("/api/pipeline-templates", { cache: "no-store" }),
        fetch("/api/worker/status", { cache: "no-store" }),
        fetch("/api/project-agents", { cache: "no-store" }),
      ]);
      if (!isCurrent()) return;

      const responses = results.map((result) => (
        result.status === "fulfilled" ? result.value : null
      ));

      // Authentication and tenant setup are whole-page states. Any one of the
      // eight routes can discover that state first, so none of them is allowed
      // to masquerade as an empty slice while only the connections route is
      // inspected.
      if (responses.some((response) => response?.status === 401)) {
        setState({ kind: "signed-out" });
        return;
      }
      if (responses.some((response) => response?.status === 409)) {
        setState({ kind: "setup" });
        return;
      }
      // A factory view is one snapshot, not seven independently optional
      // cards. If even one request rejected or returned a non-success status,
      // retain the last complete snapshot instead of turning that slice into a
      // synthetic zero. On first load there is no honest progress to render.
      if (responses.some((response) => !response?.ok)) {
        setState(staleOrUnavailable);
        return;
      }

      const [
        connectionsBody,
        projectsBody,
        accountsBody,
        botsBody,
        commandsBody,
        pipelinesBody,
        templatesBody,
        workerBody,
        agentSelectionsBody,
      ] = await Promise.all([
        readJson<{
          connections?: Array<{
            status: string;
            installation: unknown;
            repositories?: Array<{ selected: boolean; archived: boolean }>;
          }>;
        }>(responses[0]!),
        readJson<{ projects?: Array<{ id: string; name: string }> }>(responses[1]!),
        readJson<{ accounts?: Array<{ id?: string; status?: string }> }>(responses[2]!),
        readJson<{
          activeOrganizationId?: string;
          bots?: Array<{
            id?: string;
            name?: string;
            aiAccountId?: string | null;
            currentReadiness?: string;
          }>;
          assignments?: Array<{
            id?: string;
            botId?: string;
            projectId?: string | null;
            status?: string;
            config?: Partial<AssignmentConfig>;
            model?: string | null;
            workEffort?: string | null;
          }>;
          assignmentsComplete?: boolean;
          executor?: { connected?: boolean; label?: string; detail?: string };
        }>(responses[3]!),
        readJson<{ commands?: FactoryData["commands"] }>(responses[4]!),
        readJson<{ pipelines?: FactoryData["pipelines"] }>(responses[5]!),
        readJson<{ templates?: unknown[] }>(responses[6]!),
        readJson<{
          worker?: {
            connectionStatus?: string;
            statusLabel?: string;
            lastHeartbeatAt?: string | null;
            activeWorkers?: number;
            availableWorkers?: number;
          };
        }>(responses[7]!),
        readJson<{
          available?: boolean;
          selections?: Array<{ projectId: string; agentId: string; agentName: string }>;
        }>(responses[8]!),
      ]);
      if (!isCurrent()) return;

      if (
        connectionsBody === null
        || projectsBody === null
        || accountsBody === null
        || botsBody === null
        || commandsBody === null
        || pipelinesBody === null
        || templatesBody === null
        || workerBody === null
        || agentSelectionsBody === null
      ) {
        setState(staleOrUnavailable);
        return;
      }

      const projects = (projectsBody.projects ?? []).map((project) => ({
        id: project.id,
        name: project.name,
      }));
      const activeOrganizationId = typeof botsBody.activeOrganizationId === "string"
        ? botsBody.activeOrganizationId
        : "";

      const data: FactoryData = {
        activeOrganizationId,
        connectedInstallations: (connectionsBody.connections ?? []).filter(
          (connection) => connection.status === "connected" && connection.installation,
        ).length,
        repositories: (connectionsBody.connections ?? [])
          .filter((connection) => connection.status === "connected" && connection.installation)
          .reduce(
            (sum, connection) => sum + (connection.repositories ?? [])
              .filter((repository) => repository.selected && !repository.archived).length,
            0,
          ),
        projects,
        accounts: (accountsBody.accounts ?? []).map((account) => ({
          id: typeof account.id === "string" ? account.id : "",
          status: typeof account.status === "string" ? account.status : "unknown",
        })),
        bots: (botsBody.bots ?? []).map((bot) => ({
          id: typeof bot.id === "string" ? bot.id : "",
          name: typeof bot.name === "string" && bot.name.trim() ? bot.name : "Unnamed bot",
          aiAccountId: typeof bot.aiAccountId === "string" ? bot.aiAccountId : null,
          currentReadiness: typeof bot.currentReadiness === "string"
            ? bot.currentReadiness
            : "not_connected",
        })),
        assignments: (botsBody.assignments ?? [])
          .filter((assignment) => assignment.status !== "released")
          .map((assignment) => ({
            id: typeof assignment.id === "string" ? assignment.id : "",
            botId: typeof assignment.botId === "string" ? assignment.botId : "",
            // Read from `config`, where the API actually puts these fields,
            // and measure it against the least-privilege baseline.
            configured: assignmentPostingIsConfigured({
              config: {
                ...LEAST_PRIVILEGE_CONFIG,
                ...(assignment.config ?? {}),
              },
              model: assignment.model,
              workEffort: assignment.workEffort,
            }),
            projectId: assignment.projectId ?? null,
            status: typeof assignment.status === "string" ? assignment.status : "unknown",
          })),
        // This is a positive completeness proof, not a default. An older API
        // or a truncated projection may still carry plausible rows, but those
        // rows cannot truthfully complete Assign or Configure.
        assignmentsComplete: botsBody.assignmentsComplete === true,
        commands: (commandsBody.commands ?? []).map((command) => ({
          ...command,
          executionMode: command.executionMode === "manual"
            || command.executionMode === "record_only"
            ? command.executionMode
            : "unknown",
        })),
        pipelines: (pipelinesBody.pipelines ?? []).map((pipeline) => ({
          name: pipeline.name,
          projectId: pipeline.projectId,
          templateKey: pipeline.templateKey,
        })),
        // A null body here means the route itself failed; the migration being
        // absent arrives as available:false with an empty list, which the
        // Select Agents step reports as Not Connected rather than "none".
        agentSelections: agentSelectionsBody?.selections ?? [],
        agentSelectionsAvailable: agentSelectionsBody?.available ?? false,
        // Command execution has its own live readiness route. Bot-fabric
        // readiness is a separate control-plane fact and must not overwrite it.
        executor: {
          connected: workerBody.worker?.connectionStatus === "connected",
          label: workerBody.worker?.statusLabel ?? "Worker Not Connected",
          detail: workerBody.worker?.lastHeartbeatAt
            ? `Last heartbeat: ${workerBody.worker.lastHeartbeatAt}`
            : "No fresh worker heartbeat is available.",
        },
        customTemplates: (templatesBody.templates ?? []).length,
      };

      // Restore the selected factory while the page is still showing its
      // loading state. The key is organization-scoped, and a stale/deleted
      // project id is ignored in favor of the first live project.
      if (
        activeOrganizationId
        && activeOrganizationIdRef.current !== activeOrganizationId
      ) {
        activeOrganizationIdRef.current = activeOrganizationId;
        activeProjectIdRef.current = null;
        const pendingProject = pendingCreatedProjectRef.current;
        if (pendingProject && pendingProject.organizationId !== activeOrganizationId) {
          pendingCreatedProjectRef.current = null;
          startingNewFactoryRef.current = false;
          setStartingNewFactory(false);
        }
      }

      const pendingProject = pendingCreatedProjectRef.current;
      const newProject = startingNewFactoryRef.current
        && pendingProject?.organizationId === activeOrganizationId
        ? projects.find((project) => project.id === pendingProject.projectId) ?? null
        : null;

      if (newProject) {
        activeProjectIdRef.current = newProject.id;
        startingNewFactoryRef.current = false;
        pendingCreatedProjectRef.current = null;
        setActiveProjectId(newProject.id);
        setStartingNewFactory(false);
        writeFactorySelection(activeOrganizationId, newProject.id);
      } else if (!startingNewFactoryRef.current) {
        const currentProjectId = activeProjectIdRef.current;
        const currentStillExists = currentProjectId !== null
          && projects.some((project) => project.id === currentProjectId);
        const storedProjectId = readFactorySelection(activeOrganizationId);
        const storedStillExists = storedProjectId !== null
          && projects.some((project) => project.id === storedProjectId);
        const nextProjectId = currentStillExists
          ? currentProjectId
          : storedStillExists
            ? storedProjectId
            : projects[0]?.id ?? null;

        activeProjectIdRef.current = nextProjectId;
        setActiveProjectId(nextProjectId);
        if (nextProjectId) writeFactorySelection(activeOrganizationId, nextProjectId);
      }

      setState({ kind: "ready", data, stale: false });
    } catch {
      if (isCurrent()) setState(staleOrUnavailable);
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 20_000);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(interval);
      loadGenerationRef.current += 1;
    };
  }, [load]);

  // Return to the page with whatever was just selected already read back in.
  const closeOverlay = useCallback(async (): Promise<boolean> => {
    const guard = overlayCloseGuardRef.current;
    if (guard && !(await guard())) return false;
    overlayCloseGuardRef.current = null;
    setOpenStep(null);
    void load();
    return true;
  }, [load]);

  // The roster's visible Return action waits for the parent snapshot before
  // revealing the journey, so its completion badges cannot flash stale.
  const returnFromRoster = useCallback(async (): Promise<boolean> => {
    await load();
    setOpenStep(null);
    return true;
  }, [load]);

  /**
   * The footer link leaves this route, so it is another close path whenever a
   * broker sign-in is mounted inside the overlay. Keep ordinary primary-click
   * navigation behind the same awaited cancellation guard as X, Escape, and
   * backdrop; modified clicks open another tab and do not unmount this one.
   */
  const followOverlayPageLink = useCallback(async (
    event: React.MouseEvent<HTMLAnchorElement>,
    href: string,
  ) => {
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) return;

    event.preventDefault();
    if (await closeOverlay()) router.push(href);
  }, [closeOverlay, router]);

  /*
   * Every state keeps the page's own heading.
   *
   * The blocked states used to replace the whole page, h1 included, so a
   * console that could not read its data rendered a panel with no page title
   * and no place in the heading outline. Nobody noticed while the only
   * reachable blocked state needed a session the browser suite never has;
   * the unavailable state made it reachable, and the /solutions/ai-factory
   * page check caught it.
   */
  const framed = (children: React.ReactNode) => (
    <div className="space-y-6">
      <PageHeader title="AI Factory" description={PAGE_DESCRIPTION} />
      {children}
    </div>
  );

  if (state.kind === "loading") {
    return framed(
      <Card className="grid min-h-64 place-items-center">
        <Loader2 className="size-6 animate-spin text-accent" aria-label="Loading the factory" />
      </Card>,
    );
  }
  if (state.kind === "signed-out") {
    return framed(
      <BlockedState icon={Factory} title="Sign in to run your factory" description="The guided journey reads your workspace's live state." href="/auth/sign-in?next=/solutions/ai-factory" label="Sign in" />,
    );
  }
  if (state.kind === "setup") {
    return framed(
      <BlockedState icon={Factory} title="Finish setting up" description="Create or choose a workspace first." href="/solutions/connections" label="Open connections" />,
    );
  }
  if (state.kind === "unavailable") {
    return framed(
      <Card className="grid min-h-64 place-items-center p-6 text-center">
        <div className="max-w-md">
          <Factory className="mx-auto size-7 text-muted" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-semibold text-foreground">AI Factory is unavailable</h2>
          <p className="mt-1 text-sm text-muted">
            We could not read a complete workspace snapshot. No progress was inferred from missing data.
          </p>
          <button type="button" className="btn btn-primary mt-4" onClick={() => void load()}>
            Retry
          </button>
        </div>
      </Card>,
    );
  }

  const { data } = state;
  const compiledBuiltIns = builtIns.filter((template) => template.compiles).length;

  /**
   * The factory being built right now.
   *
   * Steps 2-9 are properties of one project, so with two projects the journey
   * has to say *which*. GitHub stays out of it: an installation is account
   * level, so it is genuinely done for every factory once it is done for one.
   *
   * `null` means a new factory is being started. Nothing is deleted to get
   * there -- the steps read empty because they are genuinely empty for a
   * project that does not exist yet, which keeps completion derived from live
   * records rather than from a wizard remembering it was reset.
   */
  const activeProject = activeProjectId
    ? data.projects.find((project) => project.id === activeProjectId) ?? null
    : startingNewFactory
      ? null
      : data.projects[0] ?? null;

  const handleProjectCreated = async (projectId: string) => {
    const organizationId = data.activeOrganizationId;
    pendingCreatedProjectRef.current = { organizationId, projectId };
    activeProjectIdRef.current = projectId;
    startingNewFactoryRef.current = true;
    setActiveProjectId(projectId);
    setStartingNewFactory(true);
    writeFactorySelection(organizationId, projectId);
    setOpenStep(null);
    await load();
  };

  /* The roster — assigning bots and configuring each posting's role,
     responsibilities, repository access, model, and work effort — is one
     control serving two steps. It receives exactly the factory the journey is
     measuring; there is no second project selector that can diverge from it. */
  const rosterEmbed = activeProject ? (
    <div className="space-y-4">
      <ProjectBots
        key={activeProject.id}
        projectId={activeProject.id}
        projectName={activeProject.name}
        divided={false}
        embedded
        onAssignmentComplete={load}
        onReturnToFactory={returnFromRoster}
      />
    </div>
  ) : (
    <div>
      <p className="text-sm text-muted">
        Bots are assigned per project, so this step opens once your first project exists.
      </p>
      <button type="button" onClick={() => setOpenStep("create_project")} className="btn btn-secondary btn-sm mt-3">
        Go to Create Project
        <ArrowRight className="size-4" aria-hidden="true" />
      </button>
    </div>
  );

  /** Still choosing: the flow is open and no project has appeared for it yet. */
  const isStartingNew = startingNewFactory && activeProject === null;

  const scopedPipelines = activeProject
    ? data.pipelines.filter((pipeline) => pipeline.projectId === activeProject.id)
    : [];
  const scopedAgentSelections = activeProject
    ? data.agentSelections.filter((selection) => selection.projectId === activeProject.id)
    : [];
  const connectedAccounts = data.accounts.filter(
    (account) => account.id.length > 0 && account.status === "connected",
  );
  const connectedAccountIds = new Set(connectedAccounts.map((account) => account.id));
  const linkedBots = data.bots.filter(
    (bot) => bot.id.length > 0
      && bot.aiAccountId !== null
      && connectedAccountIds.has(bot.aiAccountId),
  );
  const readyLinkedBots = linkedBots.filter((bot) => bot.currentReadiness === "ready");
  const readyLinkedBotIds = new Set(readyLinkedBots.map((bot) => bot.id));
  const scopedAssignments = activeProject
    ? data.assignments.filter((assignment) => assignment.projectId === activeProject.id)
    : [];
  const activeScopedAssignments = scopedAssignments.filter(
    (assignment) => assignment.status === "active",
  );
  const routedAssignments = activeScopedAssignments.filter(
    (assignment) => readyLinkedBotIds.has(assignment.botId),
  );
  const configuredRoutedAssignments = routedAssignments.filter(
    (assignment) => assignment.configured,
  );
  const unusableActiveAssignments = activeScopedAssignments.length - routedAssignments.length;
  const allScopedAssignmentsConfigured = routedAssignments.length > 0
    && data.assignmentsComplete
    && unusableActiveAssignments === 0
    && configuredRoutedAssignments.length === routedAssignments.length;
  const scopedCommands = activeProject
    ? data.commands.filter((command) => command.project?.id === activeProject.id)
    : [];

  const latestCommand = scopedCommands[0] ?? null;
  const latestExecutionMode = latestCommand?.executionMode ?? null;
  const latestIsRecordOnly = latestExecutionMode === "record_only";
  const latestModeIsUnknown = latestExecutionMode === "unknown";
  const recordOnlyCount = scopedCommands.filter(
    (command) => command.executionMode === "record_only",
  ).length;
  const hasSucceededCommand = scopedCommands.some(
    (command) => command.executionMode === "manual" && command.status === "succeeded",
  );
  const recent = scopedCommands.slice(0, 3);

  const steps: Array<{
    id: StepId;
    title: string;
    description: string;
    done: boolean;
    evidence: string;
    action: string;
    icon: typeof Factory;
    /** Rendered under the evidence line when a step has something to show. */
    detail?: React.ReactNode;
    body: React.ReactNode;
    pageHref: string;
    pageLabel: string;
  }> = [
    {
      id: "connect_github",
      title: "Connect Repository",
      description: "Authorize GitHub and choose the repositories your factory may work on.",
      done: data.connectedInstallations > 0 && data.repositories > 0,
      evidence: data.connectedInstallations > 0
        ? `${data.connectedInstallations} installation${data.connectedInstallations === 1 ? "" : "s"} · ${data.repositories} repositor${data.repositories === 1 ? "y" : "ies"} authorized`
        : "No GitHub installation yet",
      action: "Connect GitHub",
      icon: GitBranch,
      body: <ConnectionsConsole />,
      pageHref: "/solutions/connections",
      pageLabel: "Connections",
    },
    {
      id: "create_project",
      title: "Create Project",
      description: "A project is one repository. Name it and it persists with its branch and history.",
      done: activeProject !== null,
      evidence: activeProject
        ? `This factory: ${activeProject.name}`
        : "No project yet for this factory",
      action: "Create a project",
      icon: Factory,
      body: <AddProjectForm onCreated={handleProjectCreated} />,
      pageHref: "/solutions/projects",
      pageLabel: "All Projects",
    },
    {
      id: "pipeline",
      title: "Configure Pipeline",
      description: "Every goal runs the same verified lifecycle. Use a built-in template, or define your own stages and record a pipeline for a project.",
      /*
       * Done means this factory has chosen a pipeline, not that a project
       * exists. The step used to read done the moment step 2 finished, which
       * made it the one step on the page that could not be worked on: there
       * was nothing to select and nothing that could have been.
       */
      done: scopedPipelines.length > 0,
      evidence: scopedPipelines.length > 0
        ? `${scopedPipelines.length} pipeline${scopedPipelines.length === 1 ? "" : "s"} selected: ${scopedPipelines.map((pipeline) => pipeline.name).join(", ")}`
        : compiledBuiltIns === 0 && data.customTemplates === 0
          ? "No pipeline template compiles right now"
          : `No pipeline selected yet · ${compiledBuiltIns} built-in and ${data.customTemplates} custom template${data.customTemplates === 1 ? "" : "s"} available`,
      action: scopedPipelines.length > 0 ? "Change pipelines" : "Choose a pipeline",
      icon: Workflow,
      /*
       * The selections themselves, on the page rather than only inside the
       * overlay that made them. Pressing Use is only believable if what it
       * chose is still here after the overlay closes.
       */
      detail: scopedPipelines.length > 0 ? (
        <ul aria-label="Selected pipelines" className="mt-2 flex flex-wrap gap-1.5">
          {scopedPipelines.map((pipeline) => (
            <li
              key={pipeline.templateKey}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-[var(--surface-raised)] px-2.5 py-1 text-xs text-muted"
            >
              <Check className="size-3.5 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
              {pipeline.name}
            </li>
          ))}
        </ul>
      ) : null,
      /*
       * The project this journey is building, handed to the step, so Use
       * writes against it without asking again — and `load` on every toggle,
       * so the page behind the overlay is already right when it closes.
       *
       * `null`, not `undefined`, while a new factory is being started: the
       * journey has a project concept and no project yet, and letting the
       * control fall back to some other project would select a pipeline for a
       * factory the person is not looking at.
       */
      body: (
        <PipelineTemplatesManager
          builtIns={builtIns}
          onSelectionChanged={() => void load()}
          projectContext={activeProject ? { id: activeProject.id, name: activeProject.name } : null}
          embedded
        />
      ),
      pageHref: "/solutions/pipelines?view=templates",
      pageLabel: "Pipelines",
    },
    {
      id: "select_agents",
      title: "Select Agents",
      description: "Choose which logical agents this factory includes. Selection is routing intent — provider and model stay per-agent settings, and nothing dispatches from here.",
      done: scopedAgentSelections.length > 0,
      evidence: !data.agentSelectionsAvailable
        ? "Not Connected — the project_agents migration is not applied on this database"
        : scopedAgentSelections.length > 0
          ? `${scopedAgentSelections.length} agent${scopedAgentSelections.length === 1 ? "" : "s"} included: ${scopedAgentSelections.map((selection) => selection.agentName).join(", ")}`
          : "No agents included yet",
      action: scopedAgentSelections.length > 0 ? "Change agents" : "Choose agents",
      icon: Boxes,
      /*
       * The selections themselves, on the page rather than only inside the
       * overlay that made them — the same contract the pipeline step keeps.
       */
      detail: scopedAgentSelections.length > 0 ? (
        <ul aria-label="Included agents" className="mt-2 flex flex-wrap gap-1.5">
          {scopedAgentSelections.map((selection) => (
            <li
              key={selection.agentId}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-[var(--surface-raised)] px-2.5 py-1 text-xs text-muted"
            >
              <Check className="size-3.5 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
              {selection.agentName}
            </li>
          ))}
        </ul>
      ) : null,
      body: (
        <ProjectAgentSelector
          onSelectionChanged={() => void load()}
          projectContext={activeProject ? { id: activeProject.id, name: activeProject.name } : null}
        />
      ),
      pageHref: "/solutions/agents",
      pageLabel: "Agents",
    },
    {
      id: "connect_bots",
      title: "Connect Bots",
      description: "Sign in with an AI account, create the bot bound to that exact account, and verify its current readiness.",
      // Account count and bot count are not a relationship. Done requires one
      // exact aiAccountId binding whose current server-side readiness is ready.
      done: readyLinkedBots.length > 0,
      evidence: connectedAccounts.length === 0
        ? "No AI account connected yet"
        : linkedBots.length === 0
          ? `${connectedAccounts.length} account${connectedAccounts.length === 1 ? "" : "s"} connected · no bot linked to those accounts yet`
          : readyLinkedBots.length === 0
            ? `${linkedBots.length} linked bot${linkedBots.length === 1 ? "" : "s"} · none currently ready`
            : `${readyLinkedBots.length} ready bot${readyLinkedBots.length === 1 ? "" : "s"} linked to ${connectedAccounts.length} connected account${connectedAccounts.length === 1 ? "" : "s"}`,
      action: connectedAccounts.length === 0
        ? "Connect an account"
        : linkedBots.length === 0
          ? "Create a bot"
          : readyLinkedBots.length === 0
            ? "Check bot readiness"
            : "Manage bots",
      icon: PlugZap,
      detail: readyLinkedBots.length > 0 ? (
        <ul aria-label="Ready connected bots" className="mt-2 flex flex-wrap gap-1.5">
          {readyLinkedBots.map((bot) => (
            <li
              key={bot.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-[var(--surface-raised)] px-2.5 py-1 text-xs text-muted"
            >
              <Check className="size-3.5 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
              {bot.name}
            </li>
          ))}
        </ul>
      ) : null,
      /*
       * The project this journey is building, handed to the step.
       *
       * Without it Connect Bots could only connect: the selection had nowhere
       * to go, and finishing meant closing the overlay and starting the assign
       * step over from a project picker this page had already filled in.
       */
      body: (
        <BotManagerHome
          projectContext={activeProject ? { id: activeProject.id, name: activeProject.name } : null}
          onFinished={closeOverlay}
          embedded
          onBeforeOuterCloseChange={setOverlayCloseGuard}
        />
      ),
      pageHref: "/solutions/bot-manager",
      pageLabel: "Bot Manager",
    },
    {
      id: "assign_bots",
      title: "Assign Bots to Project",
      description: "Put one or many bots on the project. The wizard walks Select → Configure → Review.",
      done: data.assignmentsComplete && routedAssignments.length > 0,
      evidence: !data.assignmentsComplete
        ? "Assignment roster is incomplete · reload before trusting this step"
        : activeScopedAssignments.length === 0
        ? "No active bot assignment on this factory yet"
        : routedAssignments.length === 0
          ? `${activeScopedAssignments.length} active assignment${activeScopedAssignments.length === 1 ? "" : "s"} exist${activeScopedAssignments.length === 1 ? "s" : ""}, but none route a ready bot linked to a connected account`
          : unusableActiveAssignments > 0
            ? `${routedAssignments.length} ready route${routedAssignments.length === 1 ? "" : "s"} on this factory · ${unusableActiveAssignments} assignment${unusableActiveAssignments === 1 ? "" : "s"} unavailable`
            : `${routedAssignments.length} ready bot route${routedAssignments.length === 1 ? "" : "s"} on this factory`,
      action: routedAssignments.length > 0 ? "Change assignments" : "Assign bots",
      icon: Bot,
      body: rosterEmbed,
      pageHref: "/solutions/myprojects",
      pageLabel: "My Projects",
    },
    {
      id: "configure_bots",
      title: "Configure Bot Settings",
      description: "On each posting card: role, responsibilities, repository access, the model it runs (Fable 5, Opus 5, …), and work effort.",
      done: allScopedAssignmentsConfigured,
      evidence: !data.assignmentsComplete
        ? "Assignment roster is incomplete · reload before trusting this step"
        : activeScopedAssignments.length === 0
        ? "Assign a ready bot first"
        : unusableActiveAssignments > 0
          ? `${unusableActiveAssignments} of ${activeScopedAssignments.length} active assignment${activeScopedAssignments.length === 1 ? "" : "s"} are not backed by a ready bot linked to a connected account`
          : configuredRoutedAssignments.length > 0
            ? `${configuredRoutedAssignments.length} of ${routedAssignments.length} assignment${routedAssignments.length === 1 ? "" : "s"} configured`
            : "Ready assignments exist; every one is still on the default least-privilege settings",
      action: "Configure",
      icon: Settings2,
      body: rosterEmbed,
      pageHref: "/solutions/myprojects",
      pageLabel: "My Projects",
    },
    {
      id: "command",
      title: "Issue a Command",
      description: "Describe the outcome you want in plain words. The server verifies and records its pipeline and bot route without dispatching a worker.",
      done: scopedCommands.length > 0,
      evidence: scopedCommands.length > 0
        ? `${scopedCommands.length} command${scopedCommands.length === 1 ? "" : "s"} on this factory${
          recordOnlyCount > 0 ? ` · ${recordOnlyCount} recorded only` : ""
        }`
        : "No command yet for this factory",
      action: "Give a bot work",
      icon: Terminal,
      body: (
        <CommandComposer
          projectContext={activeProject ? { id: activeProject.id, name: activeProject.name } : null}
          onSaved={closeOverlay}
        />
      ),
      pageHref: "/solutions/bot-manager",
      pageLabel: "Bot Manager",
    },
    {
      id: "watch",
      title: "Watch It Ship",
      description: latestIsRecordOnly
        ? "This command is recorded only. By design it creates no worker dispatch, execution run, branch, or pull request."
        : latestModeIsUnknown
          ? "The command is recorded, but this database does not report its execution mode yet. Nothing is claimed to be running."
          : data.executor.connected
            ? "Every run lands as a draft pull request with CI evidence; you review and merge."
            : "When an executor is connected, a manual command can run toward a draft pull request with CI evidence for you to review and merge.",
      done: !latestIsRecordOnly && !latestModeIsUnknown && hasSucceededCommand,
      evidence: latestIsRecordOnly
        ? `${recordOnlyCount} command${recordOnlyCount === 1 ? "" : "s"} recorded only · no execution is queued`
        : latestModeIsUnknown
          ? "Command recorded · execution mode unavailable"
          : hasSucceededCommand
            ? "At least one command has completed end to end"
            : scopedCommands.length > 0
              ? data.executor.connected
                ? "Work is in flight — watch it on Pipelines"
                : `${scopedCommands.length} command${scopedCommands.length === 1 ? "" : "s"} queued; ${data.executor.label}`
              : "Nothing has run yet",
      action: latestIsRecordOnly ? "Review command record" : "Watch execution",
      icon: Workflow,
      body: (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-base font-semibold text-foreground">
              {latestIsRecordOnly ? "Command record" : "Command execution"}
            </h4>
            <StatusBadge tone={!latestIsRecordOnly && !latestModeIsUnknown && data.executor.connected ? "safe" : "neutral"}>
              {latestIsRecordOnly
                ? "Recorded only"
                : latestModeIsUnknown
                  ? "Execution mode unavailable"
                  : data.executor.label}
            </StatusBadge>
          </div>
          <p className="mt-1 text-sm text-muted">
            {latestIsRecordOnly
              ? "The selected bot's verified route was saved as durable command evidence. Record-only mode creates no worker dispatch, execution run, branch, or pull request by design."
              : latestModeIsUnknown
                ? "This command predates execution-mode reporting or the database rollout is incomplete. Its durable record is visible, but no execution, branch, or pull request is inferred."
                : "A manual command runs the same lifecycle: verified intake → queue → a worker claims it → isolated branch → draft pull request with CI. Merging stays yours, and production deploys from the merge."}
          </p>
          {latestIsRecordOnly || latestModeIsUnknown || data.executor.connected ? null : (
            <p className="mt-2 text-sm text-faint">
              {data.executor.detail
                || "No worker executes commands in this phase."}{" "}
              A command you submit is recorded and queued; it will not start until an executor is
              connected.
            </p>
          )}
          {recent.length ? (
            <ul className="mt-4 divide-y divide-[var(--border)]">
              {recent.map((command) => {
                const stage = pipelineStage(command.status);
                return (
                  <li key={command.id} className="flex flex-wrap items-center gap-2 py-2.5">
                    <p className="min-w-0 flex-1 truncate text-sm text-foreground" title={command.prompt}>
                      {command.prompt}
                    </p>
                    <StatusBadge tone={stage.tone} dot={false}>
                      {command.executionMode === "record_only"
                        ? "Recorded only"
                        : command.executionMode === "unknown"
                          ? "Mode unavailable"
                          : stage.label}
                    </StatusBadge>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-faint">
              No commands yet — your first one will appear here with its recorded stage.
            </p>
          )}
          <Link href="/solutions/pipelines" className="btn btn-secondary btn-sm mt-4">
            <Workflow className="size-4" aria-hidden="true" />
            Open Pipelines
          </Link>
        </div>
      ),
      pageHref: "/solutions/pipelines",
      pageLabel: "Pipelines",
    },
  ];

  const currentIndex = steps.findIndex((step) => !step.done);
  const doneCount = steps.filter((step) => step.done).length;
  const open = openStep ? steps.find((step) => step.id === openStep) : undefined;

  const startNewFactory = () => {
    // Nothing is deleted. The journey stops pointing at the current project,
    // so every project-scoped step reads empty because it genuinely is empty
    // for a factory that has no project yet.
    pendingCreatedProjectRef.current = null;
    activeProjectIdRef.current = null;
    setActiveProjectId(null);
    startingNewFactoryRef.current = true;
    setStartingNewFactory(true);
    setOpenStep("create_project");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Factory"
        description={PAGE_DESCRIPTION}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {data.projects.length > 1 || (isStartingNew && data.projects.length > 0) ? (
              <label className="flex items-center gap-2 text-xs text-muted">
                <span className="sr-only">Factory</span>
                <select
                  aria-label="Factory"
                  className="input h-9 py-0 text-sm"
                  value={activeProject?.id ?? ""}
                  onChange={(event) => {
                    const next = event.target.value;
                    const nextProjectId = next === "" ? null : next;
                    const newFactory = nextProjectId === null;
                    startingNewFactoryRef.current = newFactory;
                    setStartingNewFactory(newFactory);
                    activeProjectIdRef.current = nextProjectId;
                    setActiveProjectId(nextProjectId);
                    if (nextProjectId) {
                      pendingCreatedProjectRef.current = null;
                      writeFactorySelection(data.activeOrganizationId, nextProjectId);
                    }
                  }}
                >
                  {isStartingNew ? <option value="">New factory…</option> : null}
                  {data.projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <button type="button" className="btn btn-primary" onClick={startNewFactory}>
              <Plus className="size-4" aria-hidden="true" />
              Create New AI Factory
            </button>
          </div>
        }
      />

      {state.stale ? (
        <div role="alert">
          <Card className="flex flex-wrap items-center justify-between gap-3 border-amber-400/40 bg-amber-400/10 p-4">
            <div>
              <p className="text-sm font-medium text-foreground">Factory data may be out of date</p>
              <p className="mt-0.5 text-xs text-muted">
                The latest refresh was incomplete, so this is the last complete snapshot.
              </p>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
              Retry
            </button>
          </Card>
        </div>
      ) : null}

      {isStartingNew ? (
        <Card className="border-[var(--accent-border)] bg-[var(--accent-surface)] p-4">
          <p className="text-sm text-foreground">
            Starting a new factory. Nothing was deleted — the steps below are empty because this
            factory has no project yet.
            {data.projects.length > 0 ? " Your existing factories are still in the picker above." : ""}
          </p>
        </Card>
      ) : null}

      {open ? (
        <StepOverlay title={open.title} description={open.description} onClose={closeOverlay}>
          {open.body}
          <p className="mt-4 text-xs text-faint">
            This is the same control as{" "}
            <Link
              href={open.pageHref}
              onClick={(event) => void followOverlayPageLink(event, open.pageHref)}
              className="underline underline-offset-2 hover:text-foreground"
            >
              {open.pageLabel}
            </Link>
            {" "}— finish it in either place, then close to come back to the journey.
          </p>
        </StepOverlay>
      ) : null}

      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Your factory, step by step</h2>
            <p className="mt-1 text-sm text-muted">
              Every option opens right here, over this page — no jumping away. Progress is read
              from your live records, so it survives refresh.
            </p>
          </div>
          <StatusBadge tone={doneCount === steps.length ? "safe" : "info"} dot={false}>
            {doneCount} of {steps.length} complete
          </StatusBadge>
        </div>

        {/* The reference's horizontal band, shown where it fits. Each number
            is a real control: it opens that step's overlay. */}
        <nav aria-label="Factory steps" className="mt-5 hidden items-center md:flex">
          {steps.map((step, index) => (
            <div key={step.id} className={cn("flex items-center", index > 0 && "flex-1")}>
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  className={cn("h-0.5 min-w-3 flex-1", steps[index - 1].done ? "bg-[var(--accent)]" : "bg-[var(--border)]")}
                />
              ) : null}
              <button
                type="button"
                onClick={() => setOpenStep(step.id)}
                title={step.title}
                aria-label={`Step ${index + 1}: ${step.title}`}
                aria-haspopup="dialog"
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-full border text-sm font-semibold transition-colors",
                  step.done
                    ? "border-[var(--accent-border)] bg-[var(--accent-surface)] text-[var(--accent-text)]"
                    : "border-line bg-surface text-faint",
                  index === currentIndex && "ring-2 ring-[var(--accent-border)]",
                )}
              >
                {step.done ? <Check className="size-4" /> : index + 1}
              </button>
            </div>
          ))}
        </nav>

        <ol className="mt-6 space-y-0">
          {steps.map((step, index) => {
            const isCurrent = index === currentIndex;
            const Icon = step.icon;
            return (
              <li key={step.id} className="relative flex gap-4 pb-6 last:pb-0">
                {/* The connector, drawn per row so the column stays honest on
                    every viewport. */}
                {index < steps.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute left-[15px] top-8 h-full w-0.5",
                      step.done ? "bg-[var(--accent)]" : "bg-[var(--border)]",
                    )}
                  />
                ) : null}
                <span
                  className={cn(
                    "z-10 grid size-8 shrink-0 place-items-center rounded-full border text-sm font-semibold",
                    step.done
                      ? "border-[var(--accent-border)] bg-[var(--accent-surface)] text-[var(--accent-text)]"
                      : isCurrent
                        ? "border-[var(--accent-border)] bg-surface text-foreground ring-2 ring-[var(--accent-border)]"
                        : "border-line bg-surface text-faint",
                  )}
                  aria-hidden="true"
                >
                  {step.done ? <Check className="size-4" /> : index + 1}
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon className="size-4 shrink-0 text-faint" aria-hidden="true" />
                    <h3 className="font-semibold text-foreground">{step.title}</h3>
                    {step.done ? (
                      <StatusBadge tone="safe" dot={false}>Done</StatusBadge>
                    ) : isCurrent ? (
                      <StatusBadge tone="info" dot={false}>You are here</StatusBadge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-muted">{step.description}</p>
                  <p className="mt-1 text-xs text-faint">{step.evidence}</p>
                  {step.detail}
                  <button
                    type="button"
                    onClick={() => setOpenStep(step.id)}
                    aria-haspopup="dialog"
                    className={cn("mt-2 inline-flex", isCurrent ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm")}
                  >
                    {step.action}
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-base font-semibold text-foreground">Integrated services</h2>
          <ul className="mt-3 space-y-2.5 text-sm">
            <li className="flex items-center gap-2.5">
              <GitBranch className="size-4 shrink-0 text-faint" aria-hidden="true" />
              <span className="flex-1 text-muted">GitHub — repositories, branches, draft PRs, webhooks</span>
              <StatusBadge tone={data.connectedInstallations > 0 ? "safe" : "neutral"} dot={false}>
                {data.connectedInstallations > 0 ? "Connected" : "Not Connected"}
              </StatusBadge>
            </li>
            <li className="flex items-center gap-2.5">
              <ArrowRight className="size-4 shrink-0 text-faint" aria-hidden="true" />
              <span className="flex-1 text-muted">Vercel — production deploys from every merge to main</span>
              <StatusBadge tone="safe" dot={false}>Wired</StatusBadge>
            </li>
            <li className="flex items-center gap-2.5">
              <PlugZap className="size-4 shrink-0 text-faint" aria-hidden="true" />
              <span className="flex-1 text-muted">Supabase — persistence, auth, and the audit trail</span>
              <StatusBadge tone="safe" dot={false}>Wired</StatusBadge>
            </li>
          </ul>
          <p className="mt-3 text-xs text-faint">
            Only services this workspace actually integrates are listed — nothing here is decorative.
          </p>
        </Card>

        <Card className="p-5">
          <h2 className="text-base font-semibold text-foreground">Observability &amp; control</h2>
          <ul className="mt-3 grid grid-cols-2 gap-2 text-sm">
            {([
              ["Runs", "/solutions/runs"],
              ["Reports", "/solutions/reports"],
              ["Bot Usage", "/solutions/bot-usage"],
              ["Activity", "/solutions/activity"],
              ["Operations", "/solutions/operations"],
              ["Safety", "/solutions/settings"],
            ] as const).map(([label, href]) => (
              <li key={href}>
                <Link href={href} className="btn btn-secondary btn-sm w-full justify-between">
                  {label}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-faint">
            Everything a bot does lands in these views as recorded evidence.
          </p>
        </Card>
      </div>
    </div>
  );
}
