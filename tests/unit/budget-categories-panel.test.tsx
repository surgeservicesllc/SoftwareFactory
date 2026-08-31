import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BudgetCategoriesPanel } from "@/components/budget/categories-panel";

/**
 * The category editing surface.
 *
 * The rows were always written and read; what was missing was any way to
 * rename one, change its ceiling, or retire it. The cases that matter are
 * the honesty ones: kind is not offered for editing (history was
 * classified under it), archive replaces delete, and a failed save says
 * so instead of pretending.
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const categories = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Groceries",
    kind: "expense",
    tone: "essential",
    monthlyLimitCents: 60_000,
    isArchived: false,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Old hobby",
    kind: "expense",
    tone: "discretionary",
    monthlyLimitCents: null,
    isArchived: true,
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the budget categories panel", () => {
  it("lists active and archived categories separately, with ceilings spelled out", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ categories }));
    render(<BudgetCategoriesPanel />);

    expect(await screen.findByText("Groceries")).toBeInTheDocument();
    expect(screen.getByText("$600.00 / month")).toBeInTheDocument();
    // The archived one is under its own heading with a restore, not a delete.
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getByText("Old hobby")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("edits name and ceiling but never offers kind — history was classified under it", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ categories }));
    render(<BudgetCategoriesPanel />);
    await screen.findByText("Groceries");

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    // Name and ceiling are editable; the row's only select is Tone — kind
    // is not offered (the add form below has one, for NEW categories).
    expect(screen.getByLabelText("Category name")).toHaveValue("Groceries");
    expect(screen.getByLabelText("Edit monthly ceiling")).toHaveValue("600.00");
    const row = screen.getByRole("button", { name: "Save" }).closest("li");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getAllByRole("combobox")).toHaveLength(1);
    expect(within(row as HTMLElement).getByLabelText("Tone")).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(jsonResponse({ category: { ...categories[0], name: "Food" } }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ categories }));
    await userEvent.clear(screen.getByLabelText("Category name"));
    await userEvent.type(screen.getByLabelText("Category name"), "Food");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch?.[1]?.body));
      expect(body.name).toBe("Food");
      expect(body).not.toHaveProperty("kind");
    });
  });

  it("reports a failed save instead of pretending", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ categories }));
    render(<BudgetCategoriesPanel />);
    await screen.findByText("Groceries");

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: "That name is already in use." } }, 422),
    );
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That name is already in use.");
  });
});
