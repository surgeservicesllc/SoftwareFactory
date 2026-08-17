import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectBots } from "@/components/project-bots";
import { LEAST_PRIVILEGE_CONFIG } from "@/lib/bots/assignment-config";

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
    currentRoleId: null,
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
        botId: "bot-1",
        roleId: "role-dev",
        status: "active",
        assignedAt: "2026-08-17T00:00:00.000Z",
        config: { ...LEAST_PRIVILEGE_CONFIG, maxConcurrentTasks: 2 },
        bot: bot("bot-1", "Auditor"),
        role: roles[0],
      },
    ],
    available: [
      bot("bot-1", "Auditor", { alreadyOnThisProject: true, currentRoleId: "role-dev" }),
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

    // Three connected bots; the offline one is not among them.
    expect(within(dialog).getByText(/3 bots selected/)).toBeInTheDocument();
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
        return {
          ok: true, status: 200,
          json: async () => ({ provisioned: true, outcome: "created" }),
        } as unknown as Response;
      }
      if (url === "/api/ai-accounts") {
        return {
          ok: true, status: 200,
          json: async () => ({
            accounts: [
              { id: "acc-1", provider: "anthropic", providerLabel: "Claude", displayName: "Claude Blackstone", status: "connected", credentialPurpose: "subscription" },
              { id: "acc-2", provider: "anthropic", providerLabel: "Claude", displayName: "Claude NWV", status: "connected", credentialPurpose: "subscription_2" },
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
                bot("bot-new-1", "Claude", { credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN" }),
                bot("bot-new-2", "Claude 2", { credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_2" }),
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
    await user.click(within(dialog).getByRole("button", { name: /link 2 bots from bot manager/i }));

    // Both provisions aim at the account's own slot, as additional bots.
    const provisions = calls.filter((call) => call.url === "/api/bots/connect/provision");
    expect(provisions.map((call) => call.body)).toEqual([
      { provider: "anthropic", credential: "subscription", additional: true },
      { provider: "anthropic", credential: "subscription_2", additional: true },
    ]);

    // The refreshed roster's new bots arrive selected, ready for Configure.
    expect(await within(dialog).findByText(/2 bots selected/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /next/i })).toBeEnabled();
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

    expect(calls.find((call) => call.method === "PATCH")?.body).toMatchObject({ status: "active" });
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
      config: expect.objectContaining({ priority: 0 }),
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
      { model: "claude-fable-5" },
      { workEffort: "high" },
    ]);
  });
});
