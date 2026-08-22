import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ResumeReviewPanel,
  type ExtractionView,
} from "@/components/job-seeker/resume-review-panel";

/**
 * The review step, which is where this feature's safety actually lives.
 *
 * Everything below is about what a person is told and what they control. The
 * extraction itself is tested elsewhere; what matters here is that the panel
 * cannot claim an AI read a resume when none did, and cannot write a field
 * nobody ticked.
 */

function extraction(overrides: Partial<ExtractionView> = {}): ExtractionView {
  return {
    id: "a0000000-0000-4000-8000-0000000000e1",
    status: "pattern_only",
    model: null,
    detail: "ANTHROPIC_API_KEY is not set on the server.",
    proposal: {
      fullName: "Dana Okafor",
      email: "dana.okafor@example.com",
      skills: ["Go", "TypeScript"],
      employmentHistory: [
        { organization: "Northwind Systems", title: "Staff Platform Engineer", started: "2021", ended: "Present" },
      ],
    },
    sources: { fullName: "pattern", email: "pattern", skills: "pattern", employmentHistory: "model" },
    proposedFieldCount: 4,
    characterCount: 1200,
    truncated: false,
    appliedAt: null,
    ...overrides,
  };
}

function renderPanel(view: ExtractionView, onApply = vi.fn()) {
  render(
    <ResumeReviewPanel extraction={view} busy={false} onApply={onApply} onDismiss={vi.fn()} />,
  );
  return onApply;
}

describe("what the panel shows", () => {
  it("lists each proposed field with its value", () => {
    renderPanel(extraction());

    expect(screen.getByText("Full name")).toBeInTheDocument();
    expect(screen.getByText("dana.okafor@example.com")).toBeInTheDocument();
    expect(screen.getByText("Go, TypeScript")).toBeInTheDocument();
    expect(screen.getByText(/Staff Platform Engineer — Northwind Systems/)).toBeInTheDocument();
  });

  it("marks which fields a model proposed and which patterns did", () => {
    // Not decoration: a field a model guessed deserves a closer look than one
    // lifted verbatim out of the text, and the person can only apply that
    // judgement if the panel tells them which is which.
    renderPanel(extraction());

    expect(screen.getAllByText("Pattern").length).toBe(3);
    expect(screen.getAllByText("AI").length).toBe(1);
  });

  it("says plainly when no model read the resume", () => {
    renderPanel(extraction());

    expect(screen.getByText(/Pattern extraction only — Not Connected/)).toBeInTheDocument();
    expect(screen.getByText(/ANTHROPIC_API_KEY is not set/)).toBeInTheDocument();
  });

  it("names the model when one did read it", () => {
    renderPanel(extraction({ status: "reviewed", model: "claude-opus-5", detail: "Reviewed by claude-opus-5." }));

    expect(screen.getByText("Reviewed by claude-opus-5")).toBeInTheDocument();
    expect(screen.queryByText(/Not Connected/)).not.toBeInTheDocument();
  });

  it("says when only part of a long document was read", () => {
    renderPanel(extraction({ truncated: true, characterCount: 250_000 }));
    expect(screen.getByText(/Only the first part of a long document/)).toBeInTheDocument();
  });

  it("explains what applying will and will not touch", () => {
    renderPanel(extraction());
    expect(screen.getByText(/a field left unticked is not touched/)).toBeInTheDocument();
  });
});

describe("what the person controls", () => {
  it("starts with everything ticked, because most proposals are right", () => {
    renderPanel(extraction());
    for (const box of screen.getAllByRole("checkbox")) {
      expect(box).toBeChecked();
    }
    expect(screen.getByRole("button", { name: /Apply 4 selected/ })).toBeInTheDocument();
  });

  it("applies exactly the fields still ticked", () => {
    const onApply = renderPanel(extraction());

    fireEvent.click(screen.getByLabelText(/Full name/));
    fireEvent.click(screen.getByRole("button", { name: /Apply 3 selected/ }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const [fields] = onApply.mock.calls[0] as [string[]];
    expect(fields).not.toContain("fullName");
    expect([...fields].sort()).toEqual(["email", "employmentHistory", "skills"]);
  });

  it("cannot apply nothing", () => {
    renderPanel(extraction());
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    expect(screen.getByRole("button", { name: /Apply 0 selected/ })).toBeDisabled();
  });

  it("does not offer to apply a file that could not be read", () => {
    renderPanel(
      extraction({
        status: "failed",
        proposal: {},
        sources: {},
        detail: "The PDF could not be read. If it is a scan, it holds images rather than text.",
      }),
    );

    expect(screen.getByText("That file could not be read")).toBeInTheDocument();
    expect(screen.getByText(/it holds images rather than text/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Apply/ })).not.toBeInTheDocument();
  });

  it("distinguishes a readable resume with nothing in it from a failure", () => {
    // "We read it and found nothing" and "we could not read it" send a person
    // in different directions, so they must not look the same.
    renderPanel(extraction({ proposal: {}, sources: {}, proposedFieldCount: 0 }));

    expect(screen.getByText("Nothing could be read from that resume")).toBeInTheDocument();
    expect(screen.queryByText("That file could not be read")).not.toBeInTheDocument();
  });

  it("stops offering to apply once it has been applied", () => {
    renderPanel(extraction({ appliedAt: "2026-08-22T00:01:00Z" }));

    expect(screen.getByText(/Applied to your profile/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Apply/ })).not.toBeInTheDocument();
  });

  it("hides a field the proposal carries as empty", () => {
    renderPanel(extraction({ proposal: { email: "a@example.com", skills: [], summary: "  " } }));

    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.queryByText("Skills")).not.toBeInTheDocument();
    expect(screen.queryByText("Professional summary")).not.toBeInTheDocument();
  });
});
