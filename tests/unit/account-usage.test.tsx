import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AccountUsage, type AccountUsageView } from "@/components/bot-manager/account-usage";

/**
 * The usage line's whole job is to say what is known without implying more.
 * The state that prompted this file: a rate-limited probe (HTTP 429,
 * 2026-08-19) recorded `unavailable`, the console dropped the numbers it had
 * shown minutes earlier, and an amber failure line sat beside a green
 * Connected badge — a healthy, ready account that looked broken.
 */

const WINDOWS = [
  { key: "session_5h", label: "Session (5h)", usedPercent: 37.3, resetsAt: null },
  { key: "week_all_models", label: "Week (all models)", usedPercent: 82, resetsAt: null },
];

function view(overrides: Partial<AccountUsageView> = {}): AccountUsageView {
  return {
    accountId: "a1",
    observedAt: "2026-08-19T16:44:10.000Z",
    status: "measured",
    windows: WINDOWS,
    detail: null,
    ...overrides,
  };
}

describe("AccountUsage", () => {
  it("renders measured windows as bars with the observation time", () => {
    render(<AccountUsage usage={view()} />);

    expect(screen.getByText("Session (5h)")).toBeInTheDocument();
    expect(screen.getByText("37.3% used")).toBeInTheDocument();
    expect(screen.getByText("82% used")).toBeInTheDocument();
    expect(screen.getByText(/Provider-reported usage/)).toBeInTheDocument();
  });

  it("keeps the last real numbers on screen when a newer probe was rate-limited", () => {
    render(
      <AccountUsage
        usage={view({
          status: "unavailable",
          windows: [],
          detail:
            "The provider rate-limited the usage probe (HTTP 429); the account itself is unaffected, and the next sweep retries.",
          lastMeasured: { observedAt: "2026-08-19T16:39:13.000Z", windows: WINDOWS },
        })}
      />,
    );

    // The measurement survives, under its own timestamp.
    expect(screen.getByText("37.3% used")).toBeInTheDocument();
    expect(screen.getByText(/Provider-reported usage, as of/)).toBeInTheDocument();
    // The failed probe is named, not hidden — and not dressed as an alarm.
    expect(screen.getByText(/The newer probe .* could not refresh this/)).toBeInTheDocument();
    expect(screen.getByText(/rate-limited the usage probe/)).toBeInTheDocument();
    expect(document.querySelector(".text-amber-600")).toBeNull();
  });

  it("says a first probe failed without inventing a prior measurement", () => {
    render(
      <AccountUsage
        usage={view({
          status: "unavailable",
          windows: [],
          detail: "The usage endpoint could not be reached.",
          lastMeasured: null,
        })}
      />,
    );

    expect(screen.getByText(/Usage not measured yet/)).toBeInTheDocument();
    expect(screen.getByText(/could not be reached/)).toBeInTheDocument();
    // A failed usage reading demotes nothing; the account badge owns health.
    expect(document.querySelector(".text-amber-600")).toBeNull();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("renders the pre-widening payload shape, where lastMeasured does not exist", () => {
    // A response from a deployment that predates migration 20260819001100
    // simply lacks the key. The line must render, not crash or invent.
    render(
      <AccountUsage
        usage={view({ status: "unavailable", windows: [], detail: "The usage endpoint answered HTTP 500." })}
      />,
    );

    expect(screen.getByText(/Usage not measured yet/)).toBeInTheDocument();
  });

  it("names the other truthful absences distinctly", () => {
    const { rerender } = render(<AccountUsage usage={undefined} />);
    expect(screen.getByText(/No usage recorded yet/)).toBeInTheDocument();

    rerender(<AccountUsage usage={view({ status: "unsupported", windows: [] })} />);
    expect(screen.getByText(/not measurable for this provider yet/)).toBeInTheDocument();
  });
});
