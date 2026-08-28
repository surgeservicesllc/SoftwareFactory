import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommandComposer } from "@/components/command-composer";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function selectedPipeline(
  projectId: string,
  templateKey = "security_audit",
  name = "Security audit",
) {
  return {
    id: `${projectId}:${templateKey}`,
    projectId,
    templateId: null,
    templateKey,
    name,
  };
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
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /project/i })).toHaveValue(second);
    });
    unmount();

    // A project that is not selectable (or absent) must not leave the
    // selection empty, which would silently disable the submit button.
    window.history.replaceState(null, "", "/solutions/bot-manager?project=22222222-2222-4222-8222-222222222222");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(projects)));
    render(<CommandComposer />);
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /project/i })).toHaveValue(connected);
    });
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
      if (String(input) === "/api/project-pipelines") {
        return jsonResponse({
          available: true,
          pipelines: [
            selectedPipeline(
              "11111111-1111-4111-8111-111111111111",
              "other_project_pipeline",
              "Other project's pipeline",
            ),
            selectedPipeline(project.id, "security_audit", "Security audit"),
            selectedPipeline(project.id, "feature_build", "Feature build"),
          ],
        });
      }
      if (String(input) === "/api/commands" && init?.method === "POST") {
        return jsonResponse({
          command: { id: "44444444-4444-4444-8444-444444444444" },
          execution: {
            message: "Persisted only. This request did not dispatch a worker or change autonomy.",
            workerDispatch: "not_applicable",
          },
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

    const pipelinePicker = screen.getByRole("combobox", { name: "Pipeline" });
    await screen.findByRole("option", { name: "Security audit" });
    expect(pipelinePicker).toHaveValue("");
    expect(screen.getByRole("option", { name: "Security audit" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Feature build" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Other project's pipeline" })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("What do you want done?"), "Audit the selected factory");
    expect(screen.getByRole("button", { name: "Queue command" })).toBeDisabled();
    await user.selectOptions(pipelinePicker, "security_audit");
    expect(screen.queryByText(/every outcome lands as a draft pull request/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Recorded \(no worker dispatch\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Queue command" }));
    expect(await screen.findByText(
      /Persisted only\. This request did not dispatch a worker or change autonomy\./,
    )).toBeInTheDocument();

    const commandCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === "/api/commands" && init?.method === "POST",
    );
    expect(JSON.parse(String(commandCall?.[1]?.body))).toMatchObject({
      pipelineTemplateKey: "security_audit",
      projectId: project.id,
    });
  });

  it("does not fall back to another project while an embedded factory has none", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<CommandComposer projectContext={null} />);

    const picker = await screen.findByRole("combobox", { name: /project/i });
    expect(picker).toBeDisabled();
    expect(screen.getByRole("option", { name: "Create this factory's project first" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Choose a project first" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("What do you want done?"), "Do not escape this factory");
    expect(screen.getByRole("button", { name: "Queue command" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/projects", expect.anything());
    expect(fetchMock).not.toHaveBeenCalledWith("/api/project-pipelines", expect.anything());
    expect(fetchMock).not.toHaveBeenCalledWith("/api/tasks?limit=100", expect.anything());
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
      if (String(input) === "/api/project-pipelines") {
        return jsonResponse({ pipelines: [selectedPipeline(projectId)] });
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
    await screen.findByRole("option", { name: "Security audit" });
    expect(screen.getByRole("combobox", { name: "Pipeline" })).toHaveValue("security_audit");
    await user.type(screen.getByLabelText("What do you want done?"), "Fix the mobile overflow");
    await user.click(screen.getByRole("button", { name: /Advanced options/ }));
    await user.selectOptions(screen.getByLabelText("Work type"), "mobile");
    await user.click(screen.getByRole("button", { name: /Medium/ }));
    await user.click(screen.getByRole("button", { name: "Queue command" }));
    expect(await screen.findByText("The response was lost")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry command" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Retry command" }));
    expect(await screen.findByText(/is queued for example\/application as YELLOW/)).toBeInTheDocument();

    const bodies = fetchMock.mock.calls
      .filter(([input, init]) => String(input) === "/api/commands" && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)) as { idempotencyKey: string });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.idempotencyKey).toBe("command:33333333-3333-4333-8333-333333333333");
    expect(bodies[1]?.idempotencyKey).toBe(bodies[0]?.idempotencyKey);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it("keeps a current error visible but clears it when the project context changes or the composer remounts", async () => {
    const firstProject = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "First application",
    };
    const secondProject = {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Second application",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/tasks?limit=100") return jsonResponse({ tasks: [] });
      if (String(input) === "/api/project-pipelines") {
        return jsonResponse({
          pipelines: [
            selectedPipeline(firstProject.id, "first_pipeline", "First pipeline"),
            selectedPipeline(secondProject.id, "second_pipeline", "Second pipeline"),
          ],
        });
      }
      if (String(input) === "/api/commands" && init?.method === "POST") {
        return jsonResponse({
          error: { message: "invalid Phase 1C command plan" },
        }, 500);
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    const view = render(<CommandComposer projectContext={firstProject} />);
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Pipeline" })).toHaveValue("first_pipeline");
    });
    await user.type(screen.getByLabelText("What do you want done?"), "Fix the current factory");
    await user.click(screen.getByRole("button", { name: "Queue command" }));
    expect(await screen.findByText("invalid Phase 1C command plan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry command" })).toBeEnabled();

    view.rerender(<CommandComposer projectContext={firstProject} />);
    expect(screen.getByText("invalid Phase 1C command plan")).toBeInTheDocument();

    view.rerender(<CommandComposer projectContext={secondProject} />);
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Project" })).toHaveValue(secondProject.id);
      expect(screen.getByRole("combobox", { name: "Pipeline" })).toHaveValue("second_pipeline");
    });
    expect(screen.queryByText("invalid Phase 1C command plan")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Queue command" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Queue command" }));
    expect(await screen.findByText("invalid Phase 1C command plan")).toBeInTheDocument();
    view.unmount();

    render(<CommandComposer projectContext={secondProject} />);
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Pipeline" })).toHaveValue("second_pipeline");
    });
    expect(screen.queryByText("invalid Phase 1C command plan")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Queue command" })).toBeDisabled();
  });

  it("requires a project-selected pipeline and stays closed when none are selected", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
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
      if (String(input) === "/api/tasks?limit=100") return jsonResponse({ tasks: [] });
      if (String(input) === "/api/project-pipelines") {
        return jsonResponse({ available: true, pipelines: [] });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }));
    const user = userEvent.setup();

    render(<CommandComposer />);

    expect(await screen.findByRole("option", { name: "No pipelines selected for this project" })).toBeInTheDocument();
    const pipelinePicker = screen.getByRole("combobox", { name: "Pipeline" });
    expect(await screen.findByText(/Application has no selected pipelines\. Select one in/)).toBeInTheDocument();
    expect(pipelinePicker).toHaveAttribute("aria-describedby", "command-pipeline-guidance");
    expect(pipelinePicker).toBeDisabled();
    await user.type(screen.getByLabelText("What do you want done?"), "Build without implicit routing");
    expect(screen.getByRole("button", { name: "Queue command" })).toBeDisabled();
  });

  it("fails closed when selected pipelines are unavailable and retries the read", async () => {
    const project = { id: "11111111-1111-4111-8111-111111111111", name: "Application" };
    let pipelineReads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/tasks?limit=100") return jsonResponse({ tasks: [] });
      if (String(input) === "/api/project-pipelines") {
        pipelineReads += 1;
        return pipelineReads === 1
          ? jsonResponse({ available: false, pipelines: [] })
          : jsonResponse({ pipelines: [selectedPipeline(project.id, "bug_sweep", "Bug sweep")] });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<CommandComposer projectContext={project} />);

    await user.type(screen.getByLabelText("What do you want done?"), "Route only after verification");
    expect(await screen.findByText(/Selected pipelines could not be verified/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Queue command" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Pipeline" })).toHaveValue("bug_sweep");
    });
    expect(screen.getByRole("button", { name: "Queue command" })).toBeEnabled();
    expect(pipelineReads).toBe(2);
  });

  it("treats a changed pipeline as a new idempotent command intent", async () => {
    const project = { id: "11111111-1111-4111-8111-111111111111", name: "Application" };
    const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("33333333-3333-4333-8333-333333333333")
      .mockReturnValueOnce("55555555-5555-4555-8555-555555555555");
    let commandAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/tasks?limit=100") return jsonResponse({ tasks: [] });
      if (String(input) === "/api/project-pipelines") {
        return jsonResponse({
          pipelines: [
            selectedPipeline(project.id, "security_audit", "Security audit"),
            selectedPipeline(project.id, "feature_build", "Feature build"),
          ],
        });
      }
      if (String(input) === "/api/commands" && init?.method === "POST") {
        commandAttempts += 1;
        if (commandAttempts === 1) throw new TypeError("The response was lost");
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

    render(<CommandComposer projectContext={project} />);

    const pipelinePicker = screen.getByRole("combobox", { name: "Pipeline" });
    await screen.findByRole("option", { name: "Security audit" });
    await user.selectOptions(pipelinePicker, "security_audit");
    await user.type(screen.getByLabelText("What do you want done?"), "Audit then build");
    await user.click(screen.getByRole("button", { name: "Queue command" }));
    expect(await screen.findByText("The response was lost")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry command" })).toBeEnabled();

    await user.selectOptions(pipelinePicker, "feature_build");
    expect(screen.queryByText("The response was lost")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Queue command" }));
    expect(await screen.findByText(/is queued for example\/application as GREEN/)).toBeInTheDocument();

    const bodies = fetchMock.mock.calls
      .filter(([input, init]) => String(input) === "/api/commands" && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)) as {
        idempotencyKey: string;
        pipelineTemplateKey: string;
      });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({
      idempotencyKey: "command:33333333-3333-4333-8333-333333333333",
      pipelineTemplateKey: "security_audit",
    });
    expect(bodies[1]).toMatchObject({
      idempotencyKey: "command:55555555-5555-4555-8555-555555555555",
      pipelineTemplateKey: "feature_build",
    });
    expect(randomUUID).toHaveBeenCalledTimes(2);
  });

  it("clears project-scoped choices and ignores a late pipeline read after switching projects", async () => {
    const firstProjectId = "11111111-1111-4111-8111-111111111111";
    const secondProjectId = "22222222-2222-4222-8222-222222222222";
    let resolveFirstPipelineRead!: (response: Response) => void;
    const firstPipelineRead = new Promise<Response>((resolve) => {
      resolveFirstPipelineRead = resolve;
    });
    let pipelineReads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/projects") {
        return jsonResponse({
          projects: [
            { connectionStatus: "connected", id: firstProjectId, name: "First", status: "active" },
            { connectionStatus: "connected", id: secondProjectId, name: "Second", status: "active" },
          ],
        });
      }
      if (String(input) === "/api/tasks?limit=100") {
        return jsonResponse({
          tasks: [
            { id: "88888888-8888-4888-8888-888888888888", project: { id: firstProjectId, name: "First" }, status: "queued", title: "First dependency" },
            { id: "99999999-9999-4999-8999-999999999999", project: { id: secondProjectId, name: "Second" }, status: "queued", title: "Second dependency" },
          ],
        });
      }
      if (String(input) === "/api/project-pipelines") {
        pipelineReads += 1;
        if (pipelineReads === 1) return firstPipelineRead;
        return jsonResponse({
          pipelines: [
            selectedPipeline(firstProjectId, "first_pipeline", "First pipeline"),
            selectedPipeline(secondProjectId, "second_pipeline", "Second pipeline"),
          ],
        });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<CommandComposer />);

    const projectPicker = await screen.findByRole("combobox", { name: "Project" });
    await waitFor(() => expect(pipelineReads).toBe(1));
    await user.click(screen.getByRole("button", { name: /Advanced options/ }));
    const firstDependency = await screen.findByRole("checkbox", { name: /First dependency/ });
    await user.click(firstDependency);
    expect(screen.getByText("1 of 20 dependencies selected.")).toBeInTheDocument();

    await user.selectOptions(projectPicker, secondProjectId);
    const pipelinePicker = await screen.findByRole("combobox", { name: "Pipeline" });
    await waitFor(() => expect(pipelinePicker).toHaveValue("second_pipeline"));
    expect(screen.queryByRole("option", { name: "First pipeline" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Second dependency/ })).not.toBeChecked();
    expect(screen.queryByText("1 of 20 dependencies selected.")).not.toBeInTheDocument();

    await act(async () => {
      resolveFirstPipelineRead(jsonResponse({
        pipelines: [selectedPipeline(firstProjectId, "first_pipeline", "First pipeline")],
      }));
    });
    expect(pipelinePicker).toHaveValue("second_pipeline");
    expect(screen.queryByRole("option", { name: "First pipeline" })).not.toBeInTheDocument();
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
      if (String(input) === "/api/project-pipelines") {
        return jsonResponse({ pipelines: [selectedPipeline(projectId)] });
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
    await screen.findByRole("option", { name: "Security audit" });
    expect(screen.getByRole("combobox", { name: "Pipeline" })).toHaveValue("security_audit");
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

  it("submits every advanced command field with canonical criteria and dependencies", async () => {
    const project = { id: "11111111-1111-4111-8111-111111111111", name: "Application" };
    const dependencyId = "88888888-8888-4888-8888-888888888888";
    const commandBodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/tasks?limit=100") {
        return jsonResponse({
          tasks: [{
            id: dependencyId,
            project,
            status: "queued",
            title: "Prepare the release fixture",
          }],
        });
      }
      if (url === "/api/project-pipelines") {
        return jsonResponse({ pipelines: [selectedPipeline(project.id, "feature_build", "Feature build")] });
      }
      if (url === "/api/commands" && init?.method === "POST") {
        commandBodies.push(JSON.parse(String(init.body)));
        return jsonResponse({
          command: { id: "44444444-4444-4444-8444-444444444444" },
          execution: { workerDispatch: "not_applicable" },
          orchestration: { effectiveRisk: "red", repository: "example/application" },
          requiresOwnerApproval: true,
        }, 202);
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    const user = userEvent.setup();

    render(<CommandComposer projectContext={project} />);
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Pipeline" })).toHaveValue("feature_build");
    });
    await user.type(screen.getByLabelText("What do you want done?"), "  Ship the verified release  ");
    await user.click(screen.getByRole("button", { name: /advanced options/i }));
    await user.selectOptions(screen.getByLabelText("Work type"), "build_feature");
    await user.type(
      screen.getByLabelText(/Acceptance criteria/),
      "  Unit tests pass  \n\nProduction remains contained   ",
    );
    await user.click(screen.getByRole("checkbox", { name: /Prepare the release fixture/ }));
    await user.click(screen.getByRole("button", { name: /High · RED/ }));
    await user.click(screen.getByRole("button", { name: "Queue command" }));

    await waitFor(() => expect(commandBodies).toHaveLength(1));
    expect(commandBodies[0]).toMatchObject({
      acceptanceCriteria: ["Unit tests pass", "Production remains contained"],
      commandType: "build_feature",
      dependencyTaskIds: [dependencyId],
      parameters: {},
      pipelineTemplateKey: "feature_build",
      projectId: project.id,
      prompt: "Ship the verified release",
      risk: "red",
    });
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
      if (String(input) === "/api/project-pipelines") {
        return jsonResponse({
          pipelines: [selectedPipeline("11111111-1111-4111-8111-111111111111")],
        });
      }
      return jsonResponse({ tasks: [] });
    }));
    const user = userEvent.setup();

    render(<CommandComposer />);
    await screen.findByRole("option", { name: "Application" });
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Pipeline" })).toHaveValue("security_audit");
    });

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
      if (String(input) === "/api/project-pipelines") {
        return jsonResponse({ pipelines: [selectedPipeline("11111111-1111-4111-8111-111111111111")] });
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
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Pipeline" })).toHaveValue("security_audit");
    });
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
      pipelineTemplateKey: string;
      risk: string;
    };
    expect(body.commandType).toBe("other");
    expect(body.risk).toBe("green");
    expect(body.acceptanceCriteria).toEqual([]);
    expect(body.dependencyTaskIds).toEqual([]);
    expect(body.pipelineTemplateKey).toBe("security_audit");
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
