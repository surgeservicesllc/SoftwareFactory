import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommandComposer } from "@/components/command-composer";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const realLocation = window.location;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", realLocation.pathname);
});

describe("CommandComposer", () => {
  it("opens on the project a person arrived from, and ignores one they cannot use", async () => {
    // "Give this project work" carries the project in the URL. Honouring it
    // is the difference between arriving ready and re-picking from a list.
    const connected = "11111111-1111-4111-8111-111111111111";
    const second = "33333333-3333-4333-8333-333333333333";
    const projects = {
      projects: [
        { connectionStatus: "connected", id: connected, name: "First application", status: "active" },
        { connectionStatus: "connected", id: second, name: "Second application", status: "active" },
        {
          connectionStatus: "not_connected",
          id: "22222222-2222-4222-8222-222222222222",
          name: "Historical application",
          status: "active",
        },
      ],
    };

    window.history.replaceState(null, "", `/solutions/bot-manager?project=${second}`);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(projects)));
    const { unmount } = render(<CommandComposer />);
    expect(await screen.findByRole("combobox", { name: /project/i })).toHaveValue(second);
    unmount();

    // A project that is not selectable (or absent) must not leave the
    // selection empty, which would silently disable the submit button.
    window.history.replaceState(null, "", "/solutions/bot-manager?project=22222222-2222-4222-8222-222222222222");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(projects)));
    render(<CommandComposer />);
    expect(await screen.findByRole("combobox", { name: /project/i })).toHaveValue(connected);
  });

  it("offers only projects with a currently connected GitHub binding", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      projects: [
        {
          connectionStatus: "connected",
          id: "11111111-1111-4111-8111-111111111111",
          name: "Connected application",
          status: "active",
        },
        {
          connectionStatus: "not_connected",
          id: "22222222-2222-4222-8222-222222222222",
          name: "Historical application",
          status: "active",
        },
      ],
    })));

    render(<CommandComposer />);

    expect(await screen.findByRole("option", { name: "Connected application" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Historical application" })).not.toBeInTheDocument();
  });

  it("locks an embedded command to the caller's project instead of the workspace's first", async () => {
    const project = { id: "22222222-2222-4222-8222-222222222222", name: "Second application" };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/tasks?limit=100") return jsonResponse({ tasks: [] });
      if (String(input) === "/api/commands" && init?.method === "POST") {
        return jsonResponse({
          command: { id: "44444444-4444-4444-8444-444444444444" },
          execution: { workerDispatch: "requested" },
          orchestration: { effectiveRisk: "green", repository: "example/second" },
          requiresOwnerApproval: false,
        }, 202);
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<CommandComposer projectContext={project} />);

    const picker = await screen.findByRole("combobox", { name: /project/i });
    expect(picker).toHaveValue(project.id);
    expect(picker).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/projects", expect.anything());

    await user.type(screen.getByLabelText("What do you want done?"), "Audit the selected factory");
    await user.click(screen.getByRole("button", { name: "Queue command" }));
    expect(await screen.findByText(/is queued for example\/second as GREEN/)).toBeInTheDocument();

    const commandCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === "/api/commands" && init?.method === "POST",
    );
    expect(JSON.parse(String(commandCall?.[1]?.body))).toMatchObject({ projectId: project.id });
  });

  it("does not fall back to another project while an embedded factory has none", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/tasks?limit=100") return jsonResponse({ tasks: [] });
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<CommandComposer projectContext={null} />);

    const picker = await screen.findByRole("combobox", { name: /project/i });
    expect(picker).toBeDisabled();
    expect(screen.getByRole("option", { name: "Create this factory's project first" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("What do you want done?"), "Do not escape this factory");
    expect(screen.getByRole("button", { name: "Queue command" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/projects", expect.anything());
  });

  it("reuses one command idempotency key after an ambiguous submission failure", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("33333333-3333-4333-8333-333333333333");
    let attempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/projects") {
        return jsonResponse({
          projects: [{
            connectionStatus: "connected",
            id: projectId,
            name: "Application",
            status: "active",
          }],
        });
      }
      if (String(input) === "/api/tasks?limit=100") {
        return jsonResponse({ tasks: [] });
      }
      if (String(input) === "/api/commands" && init?.method === "POST") {
        attempts += 1;
        if (attempts === 1) throw new TypeError("The response was lost");
        return jsonResponse({
          command: { id: "44444444-4444-4444-8444-444444444444" },
          execution: { workerDispatch: "requested" },
          orchestration: { effectiveRisk: "yellow", repository: "example/application" },
          requiresOwnerApproval: false,
        }, 202);
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<CommandComposer />);

    await screen.findByRole("option", { name: "Application" });
    await user.type(screen.getByLabelText("What do you want done?"), "Fix the mobile overflow");
    await user.click(screen.getByRole("button", { name: /Advanced options/ }));
    await user.selectOptions(screen.getByLabelText("Work type"), "mobile");
    await user.click(screen.getByRole("button", { name: /Medium/ }));
    await user.click(screen.getByRole("button", { name: "Queue command" }));
    expect(await screen.findByText("The response was lost")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Queue command" }));
    expect(await screen.findByText(/is queued for example\/application as YELLOW/)).toBeInTheDocument();

    const bodies = fetchMock.mock.calls
      .filter(([input, init]) => String(input) === "/api/commands" && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)) as { idempotencyKey: string });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.idempotencyKey).toBe("command:33333333-3333-4333-8333-333333333333");
    expect(bodies[1]?.idempotencyKey).toBe(bodies[0]?.idempotencyKey);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it("submits sorted project-scoped dependencies and leaves server derivation explicit", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const otherProjectId = "22222222-2222-4222-8222-222222222222";
    const dependencyTaskA = "88888888-8888-4888-8888-888888888888";
    const dependencyTaskB = "99999999-9999-4999-8999-999999999999";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/projects") {
        return jsonResponse({
          projects: [{
            connectionStatus: "connected",
            id: projectId,
            name: "Application",
            status: "active",
          }],
        });
      }
      if (String(input) === "/api/tasks?limit=100") {
        return jsonResponse({
          tasks: [
            { id: dependencyTaskB, project: { id: projectId, name: "Application" }, status: "queued", title: "Foundation B" },
            { id: dependencyTaskA, project: { id: projectId, name: "Application" }, status: "completed", title: "Foundation A" },
            { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", project: { id: projectId, name: "Application" }, status: "failed", title: "Failed work" },
            { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", project: { id: otherProjectId, name: "Other" }, status: "queued", title: "Other project work" },
          ],
        });
      }
      if (String(input) === "/api/commands" && init?.method === "POST") {
        return jsonResponse({
          command: { id: "44444444-4444-4444-8444-444444444444" },
          execution: { workerDispatch: "requested" },
          orchestration: { effectiveRisk: "green", repository: "example/application" },
          requiresOwnerApproval: false,
        }, 202);
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<CommandComposer />);

    await screen.findByRole("option", { name: "Application" });
    await user.click(screen.getByRole("button", { name: /Advanced options/ }));
    const dependencyB = await screen.findByRole("checkbox", { name: /Foundation B/ });
    const dependencyA = screen.getByRole("checkbox", { name: /Foundation A/ });
    expect(screen.queryByText("Failed work")).not.toBeInTheDocument();
    expect(screen.queryByText("Other project work")).not.toBeInTheDocument();

    await user.click(dependencyB);
    await user.click(dependencyA);
    await user.type(screen.getByLabelText("What do you want done?"), "Build the dependent outcome");
    await user.click(screen.getByRole("button", { name: "Queue command" }));
    expect(await screen.findByText(/is queued for example\/application as GREEN/)).toBeInTheDocument();

    const commandCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === "/api/commands" && init?.method === "POST",
    );
    expect(commandCall).toBeDefined();
    const body = JSON.parse(String(commandCall?.[1]?.body)) as {
      acceptanceCriteria: string[];
      dependencyTaskIds: string[];
    };
    expect(body.acceptanceCriteria).toEqual([]);
    expect(body.dependencyTaskIds).toEqual([dependencyTaskA, dependencyTaskB]);
  });

  it("opens simple: advanced fields stay behind the disclosure until asked for", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/projects") {
        return jsonResponse({
          projects: [{
            connectionStatus: "connected",
            id: "11111111-1111-4111-8111-111111111111",
            name: "Application",
            status: "active",
          }],
        });
      }
      return jsonResponse({ tasks: [] });
    }));
    const user = userEvent.setup();

    render(<CommandComposer />);
    await screen.findByRole("option", { name: "Application" });

    // The simple view is the goal, the project, and the queue button — the
    // technical controls do not confront a non-technical owner by default.
    expect(screen.queryByLabelText("Work type")).not.toBeInTheDocument();
    expect(screen.queryByText("Requested minimum risk tier")).not.toBeInTheDocument();
    expect(screen.queryByText(/Depends on existing work/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Acceptance criteria/)).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /Advanced options/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Work type")).toBeInTheDocument();
    expect(screen.getByText("Requested minimum risk tier")).toBeInTheDocument();
    expect(screen.getByText(/Depends on existing work/)).toBeInTheDocument();
  });

  it("queues a goal from the simple view alone with the safe defaults", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/projects") {
        return jsonResponse({
          projects: [{
            connectionStatus: "connected",
            id: "11111111-1111-4111-8111-111111111111",
            name: "Application",
            status: "active",
          }],
        });
      }
      if (String(input) === "/api/tasks?limit=100") return jsonResponse({ tasks: [] });
      if (String(input) === "/api/commands" && init?.method === "POST") {
        return jsonResponse({
          command: { id: "44444444-4444-4444-8444-444444444444" },
          execution: { workerDispatch: "requested" },
          orchestration: { effectiveRisk: "green", repository: "example/application" },
          requiresOwnerApproval: false,
        }, 202);
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<CommandComposer />);
    await screen.findByRole("option", { name: "Application" });
    await user.type(screen.getByLabelText("What do you want done?"), "Make onboarding effortless");
    await user.click(screen.getByRole("button", { name: "Queue command" }));

    expect(await screen.findByText(/is queued for example\/application as GREEN/)).toBeInTheDocument();
    const commandCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === "/api/commands" && init?.method === "POST",
    );
    const body = JSON.parse(String(commandCall?.[1]?.body)) as {
      acceptanceCriteria: string[];
      commandType: string;
      dependencyTaskIds: string[];
      risk: string;
    };
    expect(body.commandType).toBe("other");
    expect(body.risk).toBe("green");
    expect(body.acceptanceCriteria).toEqual([]);
    expect(body.dependencyTaskIds).toEqual([]);
  });

  it("keeps non-default advanced choices visible when the disclosure is closed", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/projects") {
        return jsonResponse({
          projects: [{
            connectionStatus: "connected",
            id: "11111111-1111-4111-8111-111111111111",
            name: "Application",
            status: "active",
          }],
        });
      }
      return jsonResponse({ tasks: [] });
    }));
    const user = userEvent.setup();

    render(<CommandComposer />);
    await screen.findByRole("option", { name: "Application" });

    const toggle = screen.getByRole("button", { name: /Advanced options/ });
    await user.click(toggle);
    await user.selectOptions(screen.getByLabelText("Work type"), "security");
    await user.click(screen.getByRole("button", { name: /Medium/ }));
    await user.click(toggle);

    // Hidden-but-active settings would be a surprise; the summary keeps them
    // in view, and the RED-style warnings still render from the status area.
    expect(screen.getByText(/Security work · YELLOW risk requested/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Work type")).not.toBeInTheDocument();
  });
});
