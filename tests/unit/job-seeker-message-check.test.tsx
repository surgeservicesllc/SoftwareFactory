import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { RecruiterMessageCheck } from "@/components/job-seeker/message-check";

/**
 * The message check as a person meets it: paste, read the verdict. The
 * absence case must not read as reassurance, and every flag must carry the
 * phrase that raised it.
 */
describe("RecruiterMessageCheck", () => {
  it("names each red flag with the exact phrase, and stays silent until something is pasted", async () => {
    const user = userEvent.setup();
    render(<RecruiterMessageCheck />);
    expect(screen.queryByTestId("message-check-result")).not.toBeInTheDocument();

    await user.type(
      screen.getByTestId("message-check-input"),
      "We would love to hire you. Please continue on WhatsApp and send a $50 registration fee is required today.",
    );
    const result = screen.getByTestId("message-check-result");
    expect(result).toHaveTextContent("2 red flags in this text");
    expect(result).toHaveTextContent("Matched: “WhatsApp”");
    expect(result).toHaveTextContent("Matched: “registration fee is required”");
  });

  it("says that no flag was found without calling the message genuine", async () => {
    const user = userEvent.setup();
    render(<RecruiterMessageCheck />);
    await user.type(screen.getByTestId("message-check-input"), "Thanks for applying; the hiring manager will call you Tuesday.");
    expect(screen.getByTestId("message-check-result")).toHaveTextContent("No red flags found in this text. That is not proof it is genuine");
  });
});
