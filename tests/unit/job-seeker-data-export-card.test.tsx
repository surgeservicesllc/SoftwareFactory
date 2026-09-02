import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { JobSeekerDataExportCard } from "@/components/job-seeker/data-export-card";
import { EXPORT_TABLES } from "@/lib/job-seeker/export";

/** The export card (ADR-247): one download link and the full roster, named. */
describe("JobSeekerDataExportCard", () => {
  it("links the export and lists every table it covers", () => {
    render(<JobSeekerDataExportCard />);
    const link = screen.getByRole("link", { name: "Download everything about you (JSON)" });
    expect(link).toHaveAttribute("href", "/api/job-seeker/export");
    expect(link).toHaveAttribute("download");
    const roster = screen.getByTestId("data-export-roster");
    expect(within(roster).getAllByRole("listitem")).toHaveLength(EXPORT_TABLES.length);
    expect(roster).toHaveTextContent("Application transitions");
    expect(screen.getByText(/job_seeker_posting_sightings: Public facts about postings/)).toBeInTheDocument();
  });
});
