import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JobSeekerApplicationKitPanel } from "@/components/job-seeker/application-kit-panel";

/**
 * The application kit page (ADR-244): the blocks render verbatim with a
 * Copy button, the answers save through one PUT, and a workspace with no
 * profile is told what to record first.
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" }, status });
}

const QUESTIONS = [
  { key: "work_authorization", label: "Are you legally authorized to work in the country of this job?", hint: "Yes/No" },
  { key: "notice_period", label: "Notice period at your current employer", hint: "e.g. 30 days" },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JobSeekerApplicationKitPanel", () => {
  it("renders the blocks verbatim, copies one, and saves the answers through one PUT", async () => {
    const puts: unknown[] = [];
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        puts.push(JSON.parse(String(init.body)));
        return jsonResponse({ answers: { notice_period: "30 days" } });
      }
      return jsonResponse({
        profileRecorded: true,
        blocks: [{ key: "contact", label: "Contact", text: "Dana Reyes\ndana@example.com" }],
        answers: {},
        questions: QUESTIONS,
      });
    }));

    render(<JobSeekerApplicationKitPanel />);
    expect(await screen.findByTestId("kit-block-contact")).toHaveTextContent("dana@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Copy Contact" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Dana Reyes\ndana@example.com"));

    fireEvent.change(screen.getByLabelText("Notice period at your current employer"), { target: { value: "30 days" } });
    fireEvent.click(screen.getByRole("button", { name: "Save answers" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ answers: { notice_period: "30 days" } });
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("tells a workspace without a profile what to record first", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ profileRecorded: false, blocks: [], answers: {}, questions: QUESTIONS })));
    render(<JobSeekerApplicationKitPanel />);
    expect(await screen.findByText("Record your Career Profile first")).toBeInTheDocument();
    expect(screen.queryByTestId("kit-block-contact")).not.toBeInTheDocument();
  });
});
