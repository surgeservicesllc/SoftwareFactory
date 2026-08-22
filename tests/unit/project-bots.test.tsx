import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectBots } from "@/components/project-bots";
import { LEAST_PRIVILEGE_CONFIG, type AssignmentConfig } from "@/lib/bots/assignment-config";

const projectId = "11111111-1111-4111-8111-111111111111";

function bot(
  id: string,
  name: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    name,
    provider: "anthropic",
    providerLabel: "Claude",
    providerVendor: "Anthropic",
    model: "claude-opus-5",
    currentReadiness: "ready",
    readinessLabel: "Ready to assign",
    readinessTone: "safe",
    aiAccountId: null,
    assignable: true,
    blockedReason: null,
    alreadyOnThisProject: false,
    currentProjectId: null,
    currentProjectName: null,
    currentAssignmentId: null,
    currentAssignmentProjectId: null,
    currentAssignmentRevision: null,
    currentRoleId: null,
    currentRole: null,
    currentAssignmentConfig: null,
    workload: 0,
    ...overrides,
  };
}

const roles = [
  { id: "role-dev", name: "Developer", slug: "developer", summary: "Builds" },
  { id: "role-test", name: "Tester", slug: "tester", summary: "Tests" },
  { id: "role-sec", name: "Security", slug: "security", summary: "Reviews" },
];

function roster(overrides: Record<string, unknown> = {}) {
  return {
    canManage: true,
    roles,
    assigned: [
      {
        id: "as-1",
        revision: 7,
        botId: "bot-1",
        projectId,
        roleId: "role-dev",
        status: "active",
        assignedAt: "2026-08-17T00:00:00.000Z",
        config: { ...LEAST_PRIVILEGE_CONFIG, maxConcurrentTasks: 2 },
        bot: bot("bot-1", "Auditor"),
        role: roles[0],
      },
    ],
    available: [
      bot("bot-1", "Auditor", {
        alreadyOnThisProject: true,
        currentAssignmentId: "as-1",
        currentAssignmentProjectId: projectId,
        currentAssignmentRevision: 7,
        currentRoleId: "role-dev",
        currentRole: roles[0],
        currentAssignmentConfig: { ...LEAST_PRIVILEGE_CONFIG, maxConcurrentTasks: 2 },
      }),
      bot("bot-2", "Code Master"),
      bot("bot-3", "Test Engineer"),
      bot("bot-4", "Offline Bot", {
        assignable: false,
        currentReadiness: "not_connected",
        readinessLabel: "Needs credential",
        readinessTone: "warning",
        blockedReason: "ANTHROPIC_API_KEY is not set on this server.",
      }),
    ],
    ...overrides,
  };
}

function stub(body: unknown, extra?: (url: string, init?: RequestInit) => Response | null) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const handled = extra?.(url, init);
      if (handled) return handled;
      if (url.endsWith("/bots")) {
        return { ok: true, status: 200, json: async () => body } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({ usage: [] }) } as unknown as Response;
    }),
  );
  return calls;
}

async function openWizard(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /assign more|assign bots/i }));
  return screen.getByRole("dialog", { name: /assign bots/i });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the project's bot roster", () => {
  it("contains standalone wizard focus and restores its opener after Escape or backdrop", async () => {
    stub(roster());
    const user = userEvent.setup();
    const { container } = render(
      <>
        <button type="button">Outside control</button>
        <ProjectBots projectId={projectId} projectName="SoftwareFactory" />
      </>,
    );

    const outside = screen.getByRole("button", { name: "Outside control" });
    const opener = await screen.findByRole("button", { name: "Assign More" });
    await user.click(opener);

    let dialog = await screen.findByRole("dialog", { name: /assign bots/i });
    let close = within(dialog).getByRole("button", { name: "Close" });
    await waitFor(() => expect(close).toHaveFocus());
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog).toHaveClass("z-[110]");
    expect(container).toHaveAttribute("inert", "");
    expect(container).toHaveAttribute("aria-hidden", "true");

    outside.focus();
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /assign bots/i }))
      .not.toBeInTheDocument());
    expect(container).not.toHaveAttribute("inert");
    expect(container).not.toHaveAttribute("aria-hidden");
    expect(opener).toHaveFocus();

    await user.click(opener);
    dialog = await screen.findByRole("dialog", { name: /assign bots/i });
    close = within(dialog).getByRole("button", { name: "Close" });
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.mouseDown(dialog);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /assign bots/i }))
      .not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("lists the bots serving this project with their configuration", async () => {
    stub(roster());

    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    expect(await screen.findByText("Auditor")).toBeInTheDocument();
    expect(screen.getByText(/1 bot assigned/)).toBeInTheDocument();
    expect(screen.getByText(/Read the repository/)).toBeInTheDocument();
  });

  it("says a failed read is unknown rather than showing an empty roster", async () => {
    stub(null, (url) =>
      url.endsWith("/bots")
        ? ({ ok: false, status: 503, json: async () => ({}) } as unknown as Response)
        : null,
    );

    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    expect(await screen.findByText(/roster could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/no bots assigned/i)).not.toBeInTheDocument();
  });

  it("shows a member who serves the project but no controls", async () => {
    stub(roster({ canManage: false }));

    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    expect(await screen.findByText("Auditor")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /assign/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove auditor/i })).not.toBeInTheDocument();
  });
});

describe("assigning several bots at once", () => {
  it("walks select, configure, review, confirm and posts one batch", async () => {
    const calls = stub(roster(), (_url, init) =>
      init?.method === "POST"
        ? ({ ok: true, status: 201, json: async () => ({ assigned: 2 }) } as unknown as Response)
        : null,
    );
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    const dialog = await openWizard(user);
    await user.click(within(dialog).getByLabelText("Select Code Master"));
    await user.click(within(dialog).getByLabelText("Select Test Engineer"));
    await user.click(within(dialog).getByRole("button", { name: /next/i }));
    await user.click(within(dialog).getByRole("button", { name: /next/i }));
    // Both default to the Developer preset, which writes — so the review step
    // requires the elevated-permission acknowledgement before it will confirm.
    await user.click(
      within(dialog).getByRole("checkbox", { name: /reviewed what each bot may do/i }),
    );
    await user.click(within(dialog).getByRole("button", { name: /confirm/i }));

    const post = calls.find((call) => call.method === "POST");
    // One request for the whole selection: assigning them one at a time can
    // half-succeed, and nobody can tell which half landed.
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(post?.url).toBe(`/api/projects/${projectId}/bots`);
    expect((post?.body as { bots: unknown[] }).bots).toHaveLength(2);
  });

  it("excludes an existing paused posting from Assign More and Select All", async () => {
    const authoredConfig = {
      ...LEAST_PRIVILEGE_CONFIG,
      preset: "reviewer",
      responsibilities: ["Review only the migration boundary"],
      instructions: "Keep the existing review instructions byte-for-byte.",
      repositoryAccess: "read" as const,
      pipelineAccess: "assigned" as const,
      maxConcurrentTasks: 4,
      priority: 2,
    };
    const initial = roster({
      assigned: [{
        id: "as-existing",
        botId: "bot-1",
        projectId,
        roleId: "role-test",
        status: "paused",
        revision: 7,
        assignedAt: "2026-08-17T00:00:00.000Z",
        config: authoredConfig,
        bot: bot("bot-1", "Auditor"),
        role: roles[1],
      }],
      available: [
        bot("bot-1", "Auditor", {
          alreadyOnThisProject: true,
          currentAssignmentId: "as-existing",
          currentAssignmentProjectId: projectId,
          currentAssignmentRevision: 7,
          currentRoleId: "role-test",
          currentRole: roles[1],
          currentAssignmentConfig: authoredConfig,
        }),
        bot("bot-2", "Code Master"),
        bot("bot-3", "Test Engineer"),
      ],
    });
    let submitted: Array<{
      botId: string;
      roleId: string;
      config: AssignmentConfig;
      expectedAssignmentId: string | null;
      expectedProjectId: string | null;
      expectedAssignmentRevision: number | null;
    }> | null = null;
    const calls = stub(null, (url, init) => {
      if (url.endsWith("/bots") && init?.method === "POST") {
        submitted = (JSON.parse(String(init.body)) as {
          bots: Array<{
            botId: string;
            roleId: string;
            config: AssignmentConfig;
            expectedAssignmentId: string | null;
            expectedProjectId: string | null;
            expectedAssignmentRevision: number | null;
          }>;
        }).bots;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            assigned: submitted?.length ?? 0,
            assignments: (submitted ?? []).map((entry, index) => ({
              id: entry.botId === "bot-1" ? "as-existing" : `as-new-${index}`,
              botId: entry.botId,
              projectId,
              roleId: entry.roleId,
              status: "active",
              config: entry.config,
            })),
          }),
        } as unknown as Response;
      }
      if (url.endsWith("/bots")) {
        const assigned = (submitted ?? []).map((entry, index) => ({
          id: entry.botId === "bot-1" ? "as-existing" : `as-new-${index}`,
          botId: entry.botId,
          projectId,
          roleId: entry.roleId,
          status: "active",
          assignedAt: "2026-08-22T00:00:00.000Z",
          config: entry.config,
          bot: initial.available.find((candidate) => candidate.id === entry.botId) ?? null,
          role: roles.find((candidate) => candidate.id === entry.roleId) ?? null,
        }));
        return {
          ok: true,
          status: 200,
          json: async () => submitted ? { ...initial, assigned } : initial,
        } as unknown as Response;
      }
      return null;
    });
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    const dialog = await openWizard(user);
    await user.click(within(dialog).getByRole("button", { name: "Select All" }));

    expect(within(dialog).getByLabelText("Select Auditor")).toBeDisabled();
    expect(within(dialog).getByLabelText("Select Auditor")).not.toBeChecked();
    expect(within(dialog).getByText(/2 bots selected/)).toBeInTheDocument();
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("does not claim success when the committed assignment reads back differently", async () => {
    const calls = stub(roster(), (url, init) => {
      if (url.endsWith("/bots") && init?.method === "POST") {
        const entry = (JSON.parse(String(init.body)) as {
          bots: Array<{ botId: string; roleId: string; config: AssignmentConfig }>;
        }).bots[0];
        return {
          ok: true,
          status: 201,
          json: async () => ({
            assigned: 1,
            assignments: [{
              id: "as-written",
              botId: entry.botId,
              projectId,
              roleId: entry.roleId,
              status: "active",
              config: entry.config,
            }],
          }),
        } as unknown as Response;
      }
      return null;
    });
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    const dialog = await openWizard(user);
    await user.click(within(dialog).getByLabelText("Select Code Master"));
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.click(within(dialog).getByRole("button", { name: "Security" }));
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/exact readback could not be verified/i);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: /assign bots/i })).toBeInTheDocument();
  });

  it("refreshes its embedded parent after exact assignment and offers an explicit return", async () => {
    const initial = roster({
      assigned: [],
      available: [bot("bot-2", "Code Master", { aiAccountId: "account-1" })],
    });
    let submitted: {
      bots: Array<{ botId: string; roleId: string; config: AssignmentConfig }>;
    } | null = null;
    stub(null, (url, init) => {
      if (url.endsWith("/bots") && init?.method === "POST") {
        submitted = JSON.parse(String(init.body)) as typeof submitted;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            assignments: submitted!.bots.map((entry) => ({
              id: "assignment-verified",
              botId: entry.botId,
              projectId,
              roleId: entry.roleId,
              status: "active",
              config: entry.config,
            })),
          }),
        } as unknown as Response;
      }
      if (url.endsWith("/bots")) {
        const assigned = submitted?.bots.map((entry) => ({
          id: "assignment-verified",
          revision: 1,
          botId: entry.botId,
          projectId,
          roleId: entry.roleId,
          status: "active" as const,
          assignedAt: "2026-08-22T00:00:00.000Z",
          config: entry.config,
          bot: initial.available[0],
          role: roles.find((candidate) => candidate.id === entry.roleId) ?? null,
        })) ?? [];
        return {
          ok: true,
          status: 200,
          json: async () => ({ ...initial, assigned }),
        } as unknown as Response;
      }
      return null;
    });
    const onAssignmentComplete = vi.fn(async () => undefined);
    const onReturnToFactory = vi.fn(async () => true);
    const user = userEvent.setup();
    render(
      <ProjectBots
        projectId={projectId}
        projectName="SoftwareFactory"
        embedded
        onAssignmentComplete={onAssignmentComplete}
        onReturnToFactory={onReturnToFactory}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Assign Bots" }));
    const wizard = screen.getByRole("region", { name: "Assign bots to SoftwareFactory" });
    await user.click(within(wizard).getByLabelText("Select Code Master"));
    await user.click(within(wizard).getByRole("button", { name: "Next" }));
    await user.click(within(wizard).getByRole("button", { name: "Security" }));
    await user.click(within(wizard).getByRole("button", { name: "Next" }));
    await user.click(within(wizard).getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(onAssignmentComplete).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/assignment verified.*return to ai factory/i)).toBeInTheDocument();
    expect(screen.getByText("1 bot assigned")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Return to AI Factory" }));
    await waitFor(() => expect(onReturnToFactory).toHaveBeenCalledTimes(1));
  });

  it("carries a different configuration for each bot", async () => {
    const calls = stub(roster(), (_url, init) =>
      init?.method === "POST"
        ? ({ ok: true, status: 201, json: async () => ({ assigned: 2 }) } as unknown as Response)
        : null,
    );
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    const dialog = await openWizard(user);
    await user.click(within(dialog).getByLabelText("Select Code Master"));
    await user.click(within(dialog).getByLabelText("Select Test Engineer"));
    await user.click(within(dialog).getByRole("button", { name: /next/i }));

    // Second bot becomes Security: read-only, where Developer writes. Assigning
    // several bots that share one configuration is the same as assigning one.
    const cards = within(dialog).getAllByRole("button", { name: "Security" });
    await user.click(cards[1]);

    await user.click(within(dialog).getByRole("button", { name: /next/i }));
    await user.click(
      within(dialog).getByRole("checkbox", { name: /reviewed what each bot may do/i }),
    );
    await user.click(within(dialog).getByRole("button", { name: /confirm/i }));

    const body = calls.find((call) => call.method === "POST")?.body as {
      bots: Array<{ botId: string; config: { repositoryAccess: string } }>;
    };
    expect(body.bots[0].config.repositoryAccess).toBe("write");
    expect(body.bots[1].config.repositoryAccess).toBe("read");
  });

  it("keeps a manually selected role and instructions when a preset role is absent", async () => {
    const backendRole = {
      id: "role-backend",
      name: "Backend engineer",
      slug: "backend",
      summary: "Builds server code.",
    };
    stub(roster({
      assigned: [],
      roles: [backendRole],
      available: [bot("bot-2", "Code Master")],
    }));
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    const dialog = await openWizard(user);
    await user.click(within(dialog).getByLabelText("Select Code Master"));
    await user.click(within(dialog).getByRole("button", { name: /next/i }));

    const role = within(dialog).getByLabelText("Role for Code Master");
    const instructions = within(dialog).getByLabelText("Instructions for Code Master");
    expect(role).toHaveValue(backendRole.id);
    await user.clear(instructions);
    await user.type(instructions, "Keep the custom backend review boundary.");
    await user.click(within(dialog).getByRole("button", { name: "Reviewer" }));

    expect(role).toHaveValue(backendRole.id);
    expect(instructions).toHaveValue("Keep the custom backend review boundary.");
  });

  it("cannot select a bot that is not connected, and says why", async () => {
    stub(roster());
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    const dialog = await openWizard(user);

    // Hiding it would leave someone staring at a roster with a bot missing.
    expect(within(dialog).getByText(/ANTHROPIC_API_KEY is not set/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Select Offline Bot")).toBeDisabled();
  });

  it("warns that assigning a bot from another project moves it", async () => {
    stub(
      roster({
        available: [
          bot("bot-2", "Code Master", {
            currentProjectId: "other",
            currentProjectName: "Mobile App",
          }),
        ],
      }),
    );
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    const dialog = await openWizard(user);
    expect(within(dialog).getByText(/Currently on Mobile App/)).toBeInTheDocument();

    await user.click(within(dialog).getByLabelText("Select Code Master"));
    await user.click(within(dialog).getByRole("button", { name: /next/i }));
    await user.click(within(dialog).getByRole("button", { name: /next/i }));

    expect(within(dialog).getByText(/Code Master leaves Mobile App/)).toBeInTheDocument();
  });

  it("selects every connected bot with Select All, and no unconnected one", async () => {
    stub(roster());
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    const dialog = await openWizard(user);
    await user.click(within(dialog).getByRole("button", { name: /select all/i }));

    // The existing project posting and offline bot are both excluded.
    expect(within(dialog).getByText(/2 bots selected/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Select Auditor")).toBeDisabled();
    expect(within(dialog).getByLabelText("Select Auditor")).not.toBeChecked();
    expect(within(dialog).getByLabelText("Select Offline Bot")).not.toBeChecked();
  });

  it("filters the list by search", async () => {
    stub(roster());
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    const dialog = await openWizard(user);
    await user.type(within(dialog).getByLabelText("Search bots"), "Test");

    expect(within(dialog).getByLabelText("Select Test Engineer")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Select Code Master")).not.toBeInTheDocument();
  });

  it("cannot advance with nothing selected", async () => {
    stub(roster());
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    const dialog = await openWizard(user);
    expect(within(dialog).getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("adopts an audited starter role in place and unblocks a fresh workspace", async () => {
    let current = roster({ assigned: [], roles: [] });
    const returnedRole = {
      id: "role-backend",
      name: "Backend engineer",
      slug: "backend",
      summary: "Implements server logic, contracts, and validation.",
    };
    const calls = stub(current, (url, init) => {
      if (url === "/api/bot-roles" && init?.method === "POST") {
        current = roster({ assigned: [], roles: [returnedRole] });
        return {
          ok: true,
          status: 201,
          json: async () => ({ role: returnedRole }),
        } as unknown as Response;
      }
      if (url.endsWith("/bots") && init?.method === "POST") {
        const request = JSON.parse(String(init.body)) as {
          bots: Array<{ botId: string; roleId: string; config: AssignmentConfig }>;
        };
        const submitted = request.bots[0];
        const assignment = {
          id: "as-new",
          revision: 1,
          botId: submitted.botId,
          projectId,
          roleId: submitted.roleId,
          status: "active",
          assignedAt: "2026-08-22T00:00:00.000Z",
          config: submitted.config,
          bot: bot(submitted.botId, "Code Master"),
          role: returnedRole,
        };
        current = roster({ assigned: [assignment], roles: [returnedRole] });
        return {
          ok: true,
          status: 201,
          json: async () => ({ assignments: [assignment] }),
        } as unknown as Response;
      }
      if (url.endsWith("/bots")) {
        return { ok: true, status: 200, json: async () => current } as unknown as Response;
      }
      return null;
    });
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    const dialog = await openWizard(user);
    await user.click(within(dialog).getByLabelText("Select Code Master"));
    await user.click(within(dialog).getByRole("button", { name: /next/i }));

    expect(within(dialog).getByText(/every project posting needs an organization role/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /next/i })).toBeDisabled();
    expect(within(dialog).getByRole("combobox", { name: "Starter role" })).toHaveValue("backend");
    expect(within(dialog).getByRole("option", { name: "Backend engineer" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Add starter role" }));

    await within(dialog).findByRole("option", { name: "Backend engineer" });
    expect(within(dialog).getByLabelText("Role for Code Master")).toHaveValue("role-backend");
    expect(within(dialog).getByRole("button", { name: /next/i })).toBeEnabled();

    const roleSave = calls.find((call) => call.url === "/api/bot-roles" && call.method === "POST");
    expect(roleSave?.body).toMatchObject({
      roleId: null,
      name: "Backend engineer",
      slug: "backend",
      riskCeiling: "YELLOW",
    });

    // Complete the screenshot path. The exact id returned by the audited role
    // boundary is the id sent in the assignment and read back before close.
    await user.click(within(dialog).getByRole("button", { name: /next/i }));
    const acknowledgement = within(dialog).queryByRole("checkbox", {
      name: /reviewed what each bot may do/i,
    });
    if (acknowledgement) await user.click(acknowledgement);
    await user.click(within(dialog).getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /assign bots/i }))
      .not.toBeInTheDocument());

    const assignmentSave = calls.find((call) => (
      call.url.endsWith("/bots") && call.method === "POST"
    ));
    expect(assignmentSave?.body).toMatchObject({
      bots: [{ botId: "bot-2", roleId: returnedRole.id }],
    });
  });

  it("adopts the exact starter role after a concurrent-create conflict", async () => {
    const returnedRole = {
      id: "role-backend",
      name: "Backend engineer",
      slug: "backend",
      summary: "Implements server logic, contracts, and validation.",
    };
    let current = roster({ assigned: [], roles: [] });
    stub(null, (url, init) => {
      if (url === "/api/bot-roles" && init?.method === "POST") {
        current = roster({ assigned: [], roles: [returnedRole] });
        return {
          ok: false,
          status: 409,
          json: async () => ({
            error: { code: "bot_fabric_conflict", message: "That role already exists." },
          }),
        } as unknown as Response;
      }
      if (url.endsWith("/bots")) {
        return { ok: true, status: 200, json: async () => current } as unknown as Response;
      }
      return null;
    });
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    const dialog = await openWizard(user);
    await user.click(within(dialog).getByLabelText("Select Code Master"));
    await user.click(within(dialog).getByRole("button", { name: /next/i }));
    await user.click(within(dialog).getByRole("button", { name: "Add starter role" }));

    await within(dialog).findByRole("option", { name: "Backend engineer" });
    expect(within(dialog).getByLabelText("Role for Code Master")).toHaveValue(returnedRole.id);
    expect(within(dialog).getByRole("button", { name: /next/i })).toBeEnabled();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps a fresh workspace blocked and shows the audited role refusal", async () => {
    stub(roster({ assigned: [], roles: [] }), (url, init) => (
      url === "/api/bot-roles" && init?.method === "POST"
        ? ({
          ok: false,
          status: 403,
          json: async () => ({ error: { message: "Owner or administrator access is required." } }),
        } as unknown as Response)
        : null
    ));
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    const dialog = await openWizard(user);
    await user.click(within(dialog).getByLabelText("Select Code Master"));
    await user.click(within(dialog).getByRole("button", { name: /next/i }));
    await user.click(within(dialog).getByRole("button", { name: "Add starter role" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/owner or administrator/i);
    expect(within(dialog).getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("requires acknowledgement before confirming an elevated grant", async () => {
    const calls = stub(roster(), (_url, init) =>
      init?.method === "POST"
        ? ({ ok: true, status: 201, json: async () => ({ assigned: 1 }) } as unknown as Response)
        : null,
    );
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    const dialog = await openWizard(user);
    await user.click(within(dialog).getByLabelText("Select Code Master"));
    await user.click(within(dialog).getByRole("button", { name: /next/i }));
    await user.click(within(dialog).getByRole("button", { name: /next/i }));

    // Developer is the default preset and it writes, so this is elevated.
    const confirm = within(dialog).getByRole("button", { name: /confirm/i });
    expect(confirm).toBeDisabled();

    await user.click(within(dialog).getByRole("checkbox", { name: /reviewed what each bot may do/i }));
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    expect(calls.some((call) => call.method === "POST")).toBe(true);
  });

  it("refuses to offer merge without the write access it depends on", async () => {
    stub(roster());
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    const dialog = await openWizard(user);
    await user.click(within(dialog).getByLabelText("Select Code Master"));
    await user.click(within(dialog).getByRole("button", { name: /next/i }));

    await user.selectOptions(
      within(dialog).getByLabelText("Repository access for Code Master"),
      "read",
    );

    // Narrowing repository access withdraws what it can no longer support,
    // rather than leaving a grant the server would refuse at confirm time.
    expect(within(dialog).getByRole("checkbox", { name: /can open pull requests/i })).toBeDisabled();
    expect(within(dialog).getByRole("checkbox", { name: /can merge pull requests/i })).toBeDisabled();
  });

  it("keeps approval on for a bot that may merge", async () => {
    stub(roster());
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    const dialog = await openWizard(user);
    await user.click(within(dialog).getByLabelText("Select Code Master"));
    await user.click(within(dialog).getByRole("button", { name: /next/i }));
    await user.click(within(dialog).getByRole("checkbox", { name: /can merge pull requests/i }));

    const approval = within(dialog).getByRole("checkbox", {
      name: /needs a person to approve/i,
    });
    expect(approval).toBeChecked();
    expect(approval).toBeDisabled();
  });

  it("links Bot Manager accounts as bots and selects them for assignment", async () => {
    // Two connected accounts, no bots at all: the wizard's dead end before
    // linking existed. Linking provisions a bot per ticked account against
    // that account's credential slot, and the refreshed roster's new bots
    // select themselves.
    let provisioned = 0;
    const calls = stub(null, (url, init) => {
      if (url === "/api/bots/connect/provision" && init?.method === "POST") {
        provisioned += 1;
        const request = JSON.parse(String(init.body)) as { aiAccountId: string };
        return {
          ok: true, status: 200,
          json: async () => ({
            provisioned: true,
            outcome: "created",
            botId: request.aiAccountId === "acc-1" ? "bot-new-1" : "bot-new-2",
          }),
        } as unknown as Response;
      }
      if (url === "/api/ai-accounts") {
        return {
          ok: true, status: 200,
          json: async () => ({
            accounts: [
              { id: "acc-1", provider: "anthropic", providerLabel: "Claude", displayName: "Claude Blackstone", status: "connected", credentialPurpose: "claude" },
              { id: "acc-2", provider: "anthropic", providerLabel: "Claude", displayName: "Claude NWV", status: "connected", credentialPurpose: "claude_2" },
            ],
          }),
        } as unknown as Response;
      }
      if (url.endsWith("/bots")) {
        return {
          ok: true, status: 200,
          json: async () => roster({
            assigned: [],
            available: provisioned >= 2
              ? [
                bot("bot-new-1", "Claude", { aiAccountId: "acc-1", credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN" }),
                bot("bot-new-2", "Claude 2", { aiAccountId: "acc-2", credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_2" }),
              ]
              : [],
          }),
        } as unknown as Response;
      }
      return null;
    });
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    const dialog = await openWizard(user);
    expect(within(dialog).getByText("Claude Blackstone")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("checkbox", { name: /claude blackstone/i }));
    await user.click(within(dialog).getByRole("checkbox", { name: /claude nwv/i }));
    await user.click(within(dialog).getByRole("button", { name: /link or repair 2 bots/i }));

    // Both provisions carry the exact account id and are idempotent.
    const provisions = calls.filter((call) => call.url === "/api/bots/connect/provision");
    expect(provisions.map((call) => call.body)).toEqual([
      { provider: "anthropic", credential: "subscription", aiAccountId: "acc-1", additional: false },
      { provider: "anthropic", credential: "subscription_2", aiAccountId: "acc-2", additional: false },
    ]);

    // The refreshed roster's new bots arrive selected, ready for Configure.
    expect(await within(dialog).findByText(/2 bots selected/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /next/i })).toBeEnabled();
  });

  it("offers exact repair for a connected account even when an unbound bot shares its credential", async () => {
    let bound = false;
    const legacy = bot("bot-legacy", "Claude - Daniel", {
      aiAccountId: null,
      credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
    });
    const calls = stub(null, (url, init) => {
      if (url === "/api/ai-accounts") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accounts: [{
              id: "acc-1",
              provider: "anthropic",
              providerLabel: "Claude",
              displayName: "Claude - Daniel",
              status: "connected",
              credentialPurpose: "claude",
            }],
          }),
        } as unknown as Response;
      }
      if (url === "/api/bots/connect/provision" && init?.method === "POST") {
        bound = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({ outcome: "bound", botId: legacy.id }),
        } as unknown as Response;
      }
      if (url.endsWith("/bots")) {
        return {
          ok: true,
          status: 200,
          json: async () => roster({
            assigned: [],
            available: [{ ...legacy, aiAccountId: bound ? "acc-1" : null }],
          }),
        } as unknown as Response;
      }
      return null;
    });
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    const dialog = await openWizard(user);
    expect(within(dialog).getByText(/do not have an exact account-bound bot/i)).toBeInTheDocument();
    const repair = within(dialog).getByRole("region", { name: "Link accounts from the Bot Manager" });
    await user.click(within(repair).getByRole("checkbox", { name: /claude - daniel/i }));
    await user.click(within(dialog).getByRole("button", { name: "Link or repair bot" }));

    const provision = calls.find((call) => call.url === "/api/bots/connect/provision");
    expect(provision?.body).toEqual({
      provider: "anthropic",
      credential: "subscription",
      aiAccountId: "acc-1",
      additional: false,
    });
    expect(provision?.body).not.toHaveProperty("botId");
    expect(await within(dialog).findByText("1 bot selected")).toBeInTheDocument();
  });

  it("surfaces a refusal from the server instead of claiming success", async () => {
    stub(roster(), (_url, init) =>
      init?.method === "POST"
        ? ({
          ok: false,
          status: 409,
          json: async () => ({
            error: { code: "bot_not_connected", message: "Code Master is not connected." },
          }),
        } as unknown as Response)
        : null,
    );
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    const dialog = await openWizard(user);
    await user.click(within(dialog).getByLabelText("Select Code Master"));
    await user.click(within(dialog).getByRole("button", { name: /next/i }));
    await user.click(within(dialog).getByRole("button", { name: /next/i }));
    await user.click(within(dialog).getByRole("checkbox", { name: /reviewed what each bot may do/i }));
    await user.click(within(dialog).getByRole("button", { name: /confirm/i }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/not connected/i);
  });
});

describe("managing an assigned bot", () => {
  it("pauses it, sending the configuration alongside the status", async () => {
    const calls = stub(roster(), (_url, init) =>
      init?.method === "PATCH"
        ? ({ ok: true, status: 200, json: async () => ({ updated: true }) } as unknown as Response)
        : null,
    );
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    await user.click(await screen.findByRole("button", { name: /pause auditor/i }));

    const patch = calls.find((call) => call.method === "PATCH");
    expect(patch?.url).toBe(`/api/projects/${projectId}/bots/as-1`);
    // Sending the status alone would let the server reset the configuration to
    // defaults, quietly widening or narrowing what the bot may do.
    expect(patch?.body).toMatchObject({
      status: "paused",
      expectedRevision: 7,
      config: expect.objectContaining({ maxConcurrentTasks: 2 }),
    });
  });

  it("resumes a paused bot", async () => {
    const paused = roster();
    paused.assigned[0].status = "paused";
    const calls = stub(paused, (_url, init) =>
      init?.method === "PATCH"
        ? ({ ok: true, status: 200, json: async () => ({ updated: true }) } as unknown as Response)
        : null,
    );
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    await user.click(await screen.findByRole("button", { name: /resume auditor/i }));

    expect(calls.find((call) => call.method === "PATCH")?.body).toMatchObject({
      status: "active",
      expectedRevision: 7,
    });
  });

  it("removes it with DELETE, so the posting stays as evidence", async () => {
    const calls = stub(roster(), (_url, init) =>
      init?.method === "DELETE"
        ? ({ ok: true, status: 200, json: async () => ({ released: true }) } as unknown as Response)
        : null,
    );
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    await user.click(await screen.findByRole("button", { name: /remove auditor/i }));

    expect(calls.find((call) => call.method === "DELETE")?.url).toBe(
      `/api/projects/${projectId}/bots/as-1`,
    );
    expect(calls.find((call) => call.method === "DELETE")?.body).toEqual({ expectedRevision: 7 });
  });

  it("reconfigures it through the configure dialog", async () => {
    const calls = stub(roster(), (_url, init) =>
      init?.method === "PATCH"
        ? ({ ok: true, status: 200, json: async () => ({ updated: true }) } as unknown as Response)
        : null,
    );
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    await user.click(await screen.findByRole("button", { name: /configure auditor/i }));
    const dialog = screen.getByRole("dialog", { name: /configure auditor/i });
    await user.selectOptions(within(dialog).getByLabelText("Priority for Auditor"), "0");
    await user.click(within(dialog).getByRole("button", { name: /save changes/i }));

    expect(calls.find((call) => call.method === "PATCH")?.body).toMatchObject({
      expectedRevision: 7,
      config: expect.objectContaining({ priority: 0 }),
    });
  });

  it("keeps spaces while instructions are typed and trims only the submitted value", async () => {
    const calls = stub(roster(), (_url, init) =>
      init?.method === "PATCH"
        ? ({ ok: true, status: 200, json: async () => ({ updated: true }) } as unknown as Response)
        : null,
    );
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    await user.click(await screen.findByRole("button", { name: /configure auditor/i }));
    const dialog = screen.getByRole("dialog", { name: /configure auditor/i });
    const instructions = within(dialog).getByLabelText("Instructions for Auditor");
    await user.clear(instructions);
    await user.type(instructions, "Always run tests before review   ");

    expect(instructions).toHaveValue("Always run tests before review   ");
    await user.selectOptions(within(dialog).getByLabelText("Priority for Auditor"), "0");
    expect(instructions).toHaveValue("Always run tests before review   ");
    await user.click(within(dialog).getByRole("button", { name: /save changes/i }));

    expect(calls.find((call) => call.method === "PATCH")?.body).toMatchObject({
      expectedRevision: 7,
      config: expect.objectContaining({ instructions: "Always run tests before review" }),
    });
  });

  it("reports a failed change rather than leaving the row looking updated", async () => {
    stub(roster(), (_url, init) =>
      init?.method === "PATCH"
        ? ({
          ok: false,
          status: 403,
          json: async () => ({ error: { message: "Owner access is required." } }),
        } as unknown as Response)
        : null,
    );
    const user = userEvent.setup();
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    await user.click(await screen.findByRole("button", { name: /pause auditor/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/Owner access is required/);
  });

  it("sets a posting's model and work effort through the execution operation", async () => {
    const user = userEvent.setup();
    const calls = stub(roster(), (url, init) => {
      if (url === "/api/bot-assignments/as-1" && init?.method === "PATCH") {
        return {
          ok: true, status: 200,
          json: async () => ({ assignment: { id: "as-1", model: "claude-fable-5", workEffort: "high" } }),
        } as unknown as Response;
      }
      return null;
    });

    render(<ProjectBots projectId={projectId} projectName="Storefront" />);

    // The Model select offers the bot's default plus its provider's
    // suggestions; choosing one saves the override for this posting only.
    const model = await screen.findByLabelText("Model");
    await user.selectOptions(model, "claude-fable-5");
    const effort = await screen.findByLabelText("Work effort");
    await user.selectOptions(effort, "high");

    const patches = calls.filter(
      (call) => call.url === "/api/bot-assignments/as-1" && call.method === "PATCH",
    );
    expect(patches.map((call) => call.body)).toEqual([
      {
        model: "claude-fable-5",
        expectedProjectId: projectId,
        expectedRevision: 7,
      },
      {
        workEffort: "high",
        expectedProjectId: projectId,
        expectedRevision: 7,
      },
    ]);
  });
  it("says which model can run a command, and which cannot", async () => {
    // The defect this guards: the picker offered every model the catalog
    // lists for a provider, and exactly one of them can be claimed by the
    // worker. Choosing any other one is refused at submission — the last step
    // of the journey, after a project, a pipeline and a bot are all chosen.
    stub(roster({
      assigned: [{
        id: "as-1",
        revision: 7,
        botId: "bot-9",
        projectId,
        roleId: "role-dev",
        status: "active",
        assignedAt: "2026-08-17T00:00:00.000Z",
        config: { ...LEAST_PRIVILEGE_CONFIG, maxConcurrentTasks: 2 },
        bot: bot("bot-9", "Codex", { provider: "openai", model: "gpt-5.1-codex" }),
        role: roles[0],
      }],
      execution: { provider: "openai", model: "gpt-5.3-codex" },
    }));

    render(<ProjectBots projectId={projectId} projectName="Storefront" />);

    const model = await screen.findByLabelText("Model") as HTMLSelectElement;
    const labels = [...model.options].map((option) => option.textContent ?? "");
    expect(labels.some((label) => label.includes("gpt-5.3-codex · runs"))).toBe(true);
    expect(labels.some((label) => label.includes("gpt-5.1 · cannot run"))).toBe(true);

    // And the posting's current, unrunnable setting is called out rather than
    // left to be discovered at the end.
    expect(
      await screen.findByText(/gpt-5\.1-codex cannot run a command/),
    ).toBeInTheDocument();
  });

  it("says nothing about runnability when the server did not say", async () => {
    // An older deployment does not send `execution`. A guessed "runs" label
    // would be worse than none, so the picker stays quiet.
    stub(roster({ execution: undefined }));

    render(<ProjectBots projectId={projectId} projectName="Storefront" />);

    const model = await screen.findByLabelText("Model") as HTMLSelectElement;
    const labels = [...model.options].map((option) => option.textContent ?? "");
    expect(labels.every((label) => !label.includes("· runs"))).toBe(true);
    expect(labels.every((label) => !label.includes("· cannot run"))).toBe(true);
    expect(screen.queryByText(/cannot run a command/)).not.toBeInTheDocument();
  });
});
