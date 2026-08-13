import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { pushMock, refreshMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { AuthForm } from "@/app/auth/auth-form";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

async function submitSignIn(email = "person@example.org", password = "CorrectHorse123456") {
  await userEvent.type(screen.getByLabelText("Email"), email);
  await userEvent.type(screen.getByLabelText("Password"), password);
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  pushMock.mockReset();
  refreshMock.mockReset();
});

describe("AuthForm", () => {
  it("offers a resend when sign-in fails only because the email is unconfirmed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "email_not_confirmed",
            message: "This account still needs its email address confirmed.",
            canResend: true,
            ownerActionRequired: false,
          },
        },
        403,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthForm mode="sign-in" />);
    await submitSignIn();

    expect(
      await screen.findByText(/still needs its email address confirmed/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send a new confirmation email" }),
    ).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("does not offer a resend when the password was simply wrong", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: "invalid_credentials",
              message: "The email address or password was not accepted.",
              canResend: false,
              ownerActionRequired: false,
            },
          },
          401,
        ),
      ),
    );

    render(<AuthForm mode="sign-in" />);
    await submitSignIn();

    expect(await screen.findByText(/was not accepted/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send a new confirmation email" }),
    ).not.toBeInTheDocument();
  });

  it("sends the resend request for the address that was refused", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: { code: "email_not_confirmed", message: "Confirm first.", canResend: true },
          },
          403,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ accepted: true, message: "On its way." }, 202));
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthForm mode="sign-in" />);
    await submitSignIn("waiting@example.org");
    await userEvent.click(screen.getByRole("button", { name: "Send a new confirmation email" }));

    expect(await screen.findByText("On its way.")).toBeInTheDocument();

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/auth/resend-confirmation");
    expect(JSON.parse(String(init.body))).toEqual({ email: "waiting@example.org" });

    // Once sent, the offer is withdrawn so it cannot be clicked repeatedly.
    expect(
      screen.queryByRole("button", { name: "Send a new confirmation email" }),
    ).not.toBeInTheDocument();
  });

  it("tells the person when only an owner can clear the failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: "email_rate_limited",
              message: "This workspace has hit its limit for outgoing email.",
              canResend: false,
              ownerActionRequired: true,
            },
          },
          429,
        ),
      ),
    );

    render(<AuthForm mode="sign-up" />);
    await userEvent.type(screen.getByLabelText("Your name"), "New Person");
    await userEvent.type(screen.getByLabelText("Email"), "new@example.org");
    await userEvent.type(screen.getByLabelText("Password"), "CorrectHorse123456");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText(/limit for outgoing email/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing you enter here will change this/)).toBeInTheDocument();
  });

  it("keeps a created-but-unconfirmed account recoverable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { confirmationRequired: true, email: "fresh@example.org", next: "/auth/sign-in" },
          202,
        ),
      ),
    );

    render(<AuthForm mode="sign-up" />);
    await userEvent.type(screen.getByLabelText("Your name"), "Fresh Person");
    await userEvent.type(screen.getByLabelText("Email"), "fresh@example.org");
    await userEvent.type(screen.getByLabelText("Password"), "CorrectHorse123456");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText(/Your account was created/)).toBeInTheDocument();
    // Without this button an undelivered confirmation email is unrecoverable.
    expect(
      screen.getByRole("button", { name: "Send a new confirmation email" }),
    ).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("navigates on a successful sign-in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ authenticated: true, next: "/projects" })),
    );

    render(<AuthForm mode="sign-in" />);
    await submitSignIn();

    expect(pushMock).toHaveBeenCalledWith("/projects");
    expect(refreshMock).toHaveBeenCalled();
  });
});
