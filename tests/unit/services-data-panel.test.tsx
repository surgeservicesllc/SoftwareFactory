import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServicesDataPanel } from "@/components/services/data-panel";

/**
 * The page maps every column before it asks for anything, sends a dry run
 * as a dry run, repeats the server's refusal verbatim, and lists every
 * table of the export with a download for each.
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" }, status });
}

const manifest = {
  tables: [
    { table: "crm_accounts", rows: 320, error: null },
    { table: "crm_contacts", rows: 410, error: null },
  ],
  totalRows: 730,
};

function mockFetch(importResponse?: () => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/data/export")) return jsonResponse(manifest);
    if (url.endsWith("/data/import")) {
      return importResponse
        ? importResponse()
        : jsonResponse({
            dryRun: true, rowCount: 3,
            wouldCreate: { accounts: 2, properties: 2, contacts: 1 },
            duplicates: [{ line: 4, name: "Harborview Foods", matches: "Harborview Foods", on: "name" }],
            duplicatesInFile: [], invalid: [],
          });
    }
    if (url.endsWith("/data/merge")) return jsonResponse({ merged: {}, counts: { contacts: 2, properties: 1, tasks: 0 } });
    if (url.includes("/accounts?q=")) {
      return jsonResponse({ accounts: [
        { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Harborview Foods", kind: "commercial", status: "customer" },
        { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Harborview Foods Inc", kind: "commercial", status: "lead" },
      ] });
    }
    return jsonResponse({});
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ServicesDataPanel", () => {
  it("lists every export table with its count and a download", async () => {
    mockFetch();
    render(<ServicesDataPanel />);
    const list = await screen.findByTestId("export-tables");
    expect(within(list).getByText("crm_accounts")).toBeInTheDocument();
    expect(within(list).getByText("410")).toBeInTheDocument();
    const links = within(list).getAllByRole("link", { name: "Download" });
    expect(links[0]).toHaveAttribute("href", "/api/services/data/export/crm_accounts");
  });

  it("guesses a mapping from the headers, lets it be changed, and sends a dry run as one", async () => {
    const calls = mockFetch();
    render(<ServicesDataPanel />);
    await screen.findByTestId("export-tables");

    await userEvent.type(
      screen.getByLabelText("CSV text"),
      "Company,Email,Service Address,Widgets\nRidgeway,r@x.example,1 Loaf Lane,7",
    );
    const mappingList = screen.getByTestId("import-mapping");
    expect(within(mappingList).getByLabelText("Field for Company")).toHaveValue("account.name");
    expect(within(mappingList).getByLabelText("Field for Email")).toHaveValue("account.email");
    expect(within(mappingList).getByLabelText("Field for Service Address")).toHaveValue("property.address");
    expect(within(mappingList).getByLabelText("Field for Widgets")).toHaveValue("ignore");
    await userEvent.selectOptions(within(mappingList).getByLabelText("Field for Widgets"), "account.notes");

    await userEvent.click(screen.getByRole("button", { name: "Dry run" }));
    await waitFor(() => {
      const call = calls.find((entry) => entry.url.endsWith("/data/import"));
      expect(call).toBeDefined();
      const body = JSON.parse(String(call!.init!.body)) as { dryRun: boolean; mapping: Record<string, string> };
      expect(body.dryRun).toBe(true);
      expect(body.mapping).toEqual({
        Company: "account.name", Email: "account.email", "Service Address": "property.address", Widgets: "account.notes",
      });
    });
    const report = await screen.findByTestId("import-report");
    expect(report).toHaveTextContent("2 accounts, 2 locations and 1 contact would be created from 3 rows. Nothing was written.");
    expect(report).toHaveTextContent("line 4: Harborview Foods — same name as Harborview Foods");
    // Import is offered only after a dry run has been seen.
    expect(screen.getByRole("button", { name: /Import/ })).toBeEnabled();
  });

  it("repeats a refused mapping in the server's own words", async () => {
    mockFetch(() => jsonResponse({ error: { code: "mapping_incomplete", message: "Every column must be mapped or ignored before anything is imported. Unmapped: Widgets." } }, 422));
    render(<ServicesDataPanel />);
    await screen.findByTestId("export-tables");
    await userEvent.type(screen.getByLabelText("CSV text"), "Company,Widgets\nRidgeway,7");
    await userEvent.click(screen.getByRole("button", { name: "Dry run" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unmapped: Widgets.");
  });

  it("merges two chosen accounts and repeats what moved", async () => {
    const calls = mockFetch();
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<ServicesDataPanel />);
    await screen.findByTestId("export-tables");

    await userEvent.type(screen.getByLabelText("Account that stays"), "Harbor");
    await userEvent.click(await screen.findByRole("button", { name: /^Harborview Foods commercial/ }));
    await userEvent.type(screen.getByLabelText("Account merged into it"), "Harbor");
    await userEvent.click(await screen.findByRole("button", { name: /Harborview Foods Inc/ }));
    await userEvent.click(screen.getByRole("button", { name: /Merge/ }));

    await waitFor(() => {
      const merge = calls.find((entry) => entry.url.endsWith("/data/merge"));
      expect(merge).toBeDefined();
      expect(JSON.parse(String(merge!.init!.body))).toEqual({
        survivorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        loserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      });
    });
    expect(await screen.findByTestId("merge-result")).toHaveTextContent("Moved: 2 contacts, 1 properties.");
  });
});
