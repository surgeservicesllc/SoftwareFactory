import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SafetyControls } from "@/components/safety-controls";

describe("Phase 1D safety controls", () => {
  it("renders the locked observation-only state without interactive authority", () => {
    const { container } = render(<SafetyControls />);

    expect(screen.getByText(/global kill switch on/i)).toBeInTheDocument();
    expect(screen.getByText("GREEN")).toBeInTheDocument();
    expect(screen.getByText("Auto merge")).toBeInTheDocument();
    expect(screen.getByText(/no merge endpoint/i)).toBeInTheDocument();
    expect(screen.getByText(/would_be_eligible or blocked/i)).toBeInTheDocument();
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });
});
