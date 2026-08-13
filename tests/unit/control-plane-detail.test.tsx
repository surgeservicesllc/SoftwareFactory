import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ExternalEvidenceLink } from "@/components/control-plane-detail";

describe("control-plane evidence links", () => {
  it("links only credential-free GitHub HTTPS evidence", () => {
    const { rerender } = render(
      <ExternalEvidenceLink href="javascript:alert(1)">Unsafe evidence</ExternalEvidenceLink>,
    );
    expect(screen.queryByRole("link", { name: "Unsafe evidence" })).not.toBeInTheDocument();

    rerender(<ExternalEvidenceLink href="https://example.com/evidence">Other host</ExternalEvidenceLink>);
    expect(screen.queryByRole("link", { name: "Other host" })).not.toBeInTheDocument();

    rerender(<ExternalEvidenceLink href="https://github.com/example/repo/pull/1">Draft PR</ExternalEvidenceLink>);
    expect(screen.getByRole("link", { name: "Draft PR" })).toHaveAttribute(
      "href",
      "https://github.com/example/repo/pull/1",
    );
  });
});
