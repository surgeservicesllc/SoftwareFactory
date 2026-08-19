import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectRepository } from "@/components/project-repository";

const projectId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";

function repository(overrides: Record<string, unknown> = {}) {
  return {
    id: 900,
    fullName: "example-org/application",
    defaultBranch: "main",
    archived: false,
    disabled: false,
    selected: true,
    ...overrides,
  };
}

function connections(repositories = [repository()]) {
  return [{
    id: connectionId,
    status: "connected",
    account: { login: "example-org" },
    installation: { id: 456 },
    repositories,
  }];
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ProjectRepository", () => {
  it("offers only repositories the app can actually read", async () => {
    render(
      <ProjectRepository
        projectId={projectId}
        projectName="SoftwareFactory"
        currentRepository={null}
        currentRepositoryId={null}
        connections={connections([
          repository(),
          repository({ id: 901, fullName: "example-org/archived", archived: true }),
          repository({ id: 902, fullName: "example-org/unselected", selected: false }),
          repository({ id: 903, fullName: "example-org/disabled", disabled: true }),
        ])}
        onChanged={() => undefined}
      />,
    );

    const picker = screen.getByLabelText("GitHub repository");
    const options = within(picker).getAllByRole("option").map((option) => option.textContent);
    // An unreadable repository is not a choice; offering it would only fail later.
    expect(options).toEqual(["Choose a repository", "example-org/application"]);
    // With nothing linked, the project says what that costs.
    expect(screen.getByText(/nothing for a bot to modify or develop/i)).toBeInTheDocument();
  });

  it("links a repository to the project and refreshes", async () => {
    const bodies: unknown[] = [];
    const onChanged = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push({ url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) });
      return {
        ok: true,
        status: 200,
        json: async () => ({ project: { githubRepository: "example-org/application" } }),
      } as unknown as Response;
    }));
    const user = userEvent.setup();

    render(
      <ProjectRepository
        projectId={projectId}
        projectName="SoftwareFactory"
        currentRepository={null}
        currentRepositoryId={null}
        connections={connections()}
        onChanged={onChanged}
      />,
    );

    await user.selectOptions(screen.getByLabelText("GitHub repository"), `${connectionId}:900`);
    await user.click(screen.getByRole("button", { name: /link repository/i }));

    expect(bodies).toEqual([{
      url: `/api/projects/${projectId}/repository`,
      method: "PUT",
      body: { connectionId, repositoryId: 900 },
    }]);
    expect(await screen.findByText(/now develops example-org\/application/i)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it("shows the server's refusal verbatim instead of a generic failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        error: { message: "That repository is already linked to another active project." },
      }),
    } as unknown as Response)));
    const user = userEvent.setup();

    render(
      <ProjectRepository
        projectId={projectId}
        projectName="SoftwareFactory"
        currentRepository={null}
        currentRepositoryId={null}
        connections={connections()}
        onChanged={() => undefined}
      />,
    );

    await user.selectOptions(screen.getByLabelText("GitHub repository"), `${connectionId}:900`);
    await user.click(screen.getByRole("button", { name: /link repository/i }));

    expect(
      await screen.findByText("That repository is already linked to another active project."),
    ).toBeInTheDocument();
  });

  it("unlinks only after confirmation, and keeps the project", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method });
      return { ok: true, status: 200, json: async () => ({ unlinked: true }) } as unknown as Response;
    }));
    const confirmSpy = vi.spyOn(window, "confirm");
    const user = userEvent.setup();

    render(
      <ProjectRepository
        projectId={projectId}
        projectName="SoftwareFactory"
        currentRepository="example-org/application"
        currentRepositoryId={900}
        connections={connections()}
        onChanged={() => undefined}
      />,
    );

    // Refused confirmation changes nothing.
    confirmSpy.mockReturnValueOnce(false);
    await user.click(screen.getByRole("button", { name: /unlink/i }));
    expect(calls).toEqual([]);

    confirmSpy.mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: /unlink/i }));
    expect(calls).toEqual([{ url: `/api/projects/${projectId}/repository`, method: "DELETE" }]);
    // The prompt promises the project survives; the copy must keep saying so.
    expect(confirmSpy.mock.calls[1]?.[0]).toMatch(/project and its history are kept/i);
  });

  it("names the missing step when no readable repository exists", () => {
    render(
      <ProjectRepository
        projectId={projectId}
        projectName="SoftwareFactory"
        currentRepository={null}
        currentRepositoryId={null}
        connections={[]}
        onChanged={() => undefined}
      />,
    );

    expect(screen.getByText(/authorize one for softwarefactory on github/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("GitHub repository")).not.toBeInTheDocument();
  });
});
