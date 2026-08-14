import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SafetyControls } from "@/components/safety-controls";
import { AUTOMATIC_ACTIONS } from "@/lib/autonomy/controls";

describe("SafetyControls", () => {
  it("lists every automatic action the model defines", () => {
    render(<SafetyControls />);

    const list = screen.getByRole("heading", { name: /what it may do without asking/i })
      .parentElement!;
    const items = within(list).getAllByRole("listitem");

    // A control added to the model must not be able to go missing from the
    // page a reader uses to check what this thing is allowed to do.
    expect(items).toHaveLength(AUTOMATIC_ACTIONS.length);
    for (const action of AUTOMATIC_ACTIONS) {
      expect(within(list).getByText(new RegExp(`Auto ${action}`, "i"))).toBeInTheDocument();
    }
  });

  it("shows every action as OFF", () => {
    render(<SafetyControls />);

    const list = screen.getByRole("heading", { name: /what it may do without asking/i })
      .parentElement!;

    expect(within(list).getAllByText("OFF")).toHaveLength(AUTOMATIC_ACTIONS.length);
    expect(within(list).queryByText("ON")).not.toBeInTheDocument();
  });

  it("explains why they are off rather than only asserting it", () => {
    render(<SafetyControls />);

    const reasons = screen.getByRole("heading", { name: /why every one of them is off/i })
      .parentElement!;

    expect(within(reasons).getByText(/global kill switch is on/i)).toBeInTheDocument();
    expect(within(reasons).getByText(/no execution worker is connected/i)).toBeInTheDocument();
    expect(within(reasons).getByText(/autonomous mode is off for the organization/i)).toBeInTheDocument();
    expect(within(reasons).getByText(/autonomous mode is off for this project/i)).toBeInTheDocument();
  });

  it("states the most-restrictive-wins rule", () => {
    render(<SafetyControls />);
    expect(screen.getByText(/strictest setting between/i)).toBeInTheDocument();
  });

  it("allows GREEN only", () => {
    render(<SafetyControls />);

    const tiers = screen.getByRole("heading", { name: /highest risk autonomous mode may consider/i })
      .parentElement!;
    expect(within(tiers).getAllByText("Allowed")).toHaveLength(1);
    expect(within(tiers).getAllByText("Blocked")).toHaveLength(2);
  });

  it("never claims an action ran", () => {
    render(<SafetyControls />);
    expect(screen.getByText(/cannot approve, merge, deploy, roll back/i)).toBeInTheDocument();
  });

  it("keeps autonomous authority off without blocking manually requested Phase 1C runs", () => {
    const { container } = render(<SafetyControls />);

    expect(screen.getByText(/autonomous mode off/i)).toBeInTheDocument();
    expect(screen.getByText(/manual green or yellow request may run/i)).toBeInTheDocument();
    expect(screen.getByText("GREEN")).toBeInTheDocument();
    expect(screen.getByText("Auto merge")).toBeInTheDocument();
    expect(screen.getByText(/no merge endpoint/i)).toBeInTheDocument();
    expect(screen.getByText(/would_be_eligible or blocked/i)).toBeInTheDocument();
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });
});
