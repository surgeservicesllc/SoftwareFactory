import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServicesFormsPanel } from "@/components/services/forms-panel";

/**
 * The form asks the next question, as a person works it: opening a form
 * shows every question with the unasked ones struck through and their
 * rule beside them; answering the parent reveals the child at once; Save
 * sends only asked answers, parents first; Complete waits on the asked
 * required ones. The templates tab shows each condition in words and the
 * service types a template is assigned to, and the builder posts a
 * condition by the earlier question's position.
 */

const templateId = "70000000-0000-4000-8000-0000000e0001";
const instanceId = "71000000-0000-4000-8000-0000000e0001";
const pests = "72000000-0000-4000-8000-0000000e0001";
const which = "72000000-0000-4000-8000-0000000e0002";
const notes = "72000000-0000-4000-8000-0000000e0003";

const forms = {
  templates: [{
    id: templateId, name: "Service report", kind: "service_report", version: 1, description: null, active: true,
    triggerServiceTypes: ["Rodent control"], createdAt: "x", updatedAt: "x", inUse: true,
    fields: [
      { id: pests, templateId, position: 1, label: "Pests found?", fieldType: "boolean", required: true, helpText: null, options: [], dependsOnFieldId: null, showWhen: null, createdAt: "x" },
      { id: which, templateId, position: 2, label: "Which pests?", fieldType: "multi_select", required: true, helpText: null, options: ["ants", "rodents"], dependsOnFieldId: pests, showWhen: { op: "is_true" }, createdAt: "x" },
      { id: notes, templateId, position: 3, label: "Notes", fieldType: "long_text", required: true, helpText: null, options: [], dependsOnFieldId: null, showWhen: null, createdAt: "x" },
    ],
  }],
  instances: [{
    id: instanceId, templateId, accountId: null, propertyId: null, workOrderId: null, technicianId: null, status: "assigned",
    assignedAt: "2026-09-01T00:00:00Z", startedAt: null, completedAt: null, signedByName: null, signedAt: null, signaturePath: null, signed: false, notes: null, createdAt: "x", updatedAt: "x",
  }],
  counts: { templates: 1, assigned: 1, inProgress: 0, completed: 0, completedUnsigned: 0 },
};

const instancePayload = {
  instance: { id: instanceId, status: "assigned", templateId, completedAt: null },
  fields: forms.templates[0].fields,
  answers: [],
  questions: [
    { fieldId: pests, position: 1, label: "Pests found?", fieldType: "boolean", required: true, helpText: null, options: [], dependsOnFieldId: null, dependsOnLabel: null, showWhen: null, condition: null, asked: true, answered: false },
    { fieldId: which, position: 2, label: "Which pests?", fieldType: "multi_select", required: true, helpText: null, options: ["ants", "rodents"], dependsOnFieldId: pests, dependsOnLabel: "Pests found?", showWhen: { op: "is_true" }, condition: "asked when “Pests found?” is yes", asked: false, answered: false },
    { fieldId: notes, position: 3, label: "Notes", fieldType: "long_text", required: true, helpText: null, options: [], dependsOnFieldId: null, dependsOnLabel: null, showWhen: null, condition: null, asked: true, answered: false },
  ],
  unansweredRequired: ["Pests found?", "Notes"],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function serve() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (init?.method === "PATCH") return Promise.resolve(json({ instance: instancePayload.instance }));
    if (init?.method === "POST") return Promise.resolve(json({ template: forms.templates[0] }, 201));
    if (url.startsWith("/api/services/forms/instances")) return Promise.resolve(json(instancePayload));
    if (url === "/api/services/forms") return Promise.resolve(json(forms));
    if (url === "/api/services/timesheets") return Promise.resolve(json({ shifts: [], counts: { running: 0, workedMinutes: 0 } }));
    if (url === "/api/services/licences") return Promise.resolve(json({ technicians: [], counts: { expired: 0, expiringSoon: 0 } }));
    return Promise.resolve(json({}));
  }));
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("answering a form with conditions", () => {
  it("hides an unasked question with its rule, reveals it when the parent is answered yes, and sends only asked answers parents-first", async () => {
    const calls = serve();
    const user = userEvent.setup();
    render(<ServicesFormsPanel />);

    await user.click(await screen.findByTestId(`services-form-open-${instanceId}`));
    const sheet = await screen.findByTestId("form-answer-sheet");
    expect(within(sheet).getByTestId("form-question-2")).toHaveAttribute("data-asked", "false");
    expect(within(sheet).getByTestId("form-question-condition-2")).toHaveTextContent("asked when “Pests found?” is yes");
    expect(within(sheet).queryByLabelText("Which pests?: rodents")).toBeNull();
    expect(within(sheet).getByTestId("form-complete")).toBeDisabled();
    expect(within(sheet).getByTestId("form-outstanding")).toHaveTextContent("Still required: Pests found?, Notes");

    await user.click(within(sheet).getByLabelText("Pests found?: yes"));
    expect(within(sheet).getByTestId("form-question-2")).toHaveAttribute("data-asked", "true");
    await user.click(within(sheet).getByLabelText("Which pests?: rodents"));
    await user.click(within(sheet).getByLabelText("Pests found?: no"));
    expect(within(sheet).getByTestId("form-question-2")).toHaveAttribute("data-asked", "false");
    await user.click(within(sheet).getByLabelText("Pests found?: yes"));
    await user.type(within(sheet).getByLabelText("Notes"), "Bait placed.");
    expect(within(sheet).getByTestId("form-complete")).toBeEnabled();

    await user.click(within(sheet).getByTestId("form-save"));
    await waitFor(() => expect(screen.getByTestId("form-message")).toHaveTextContent("Saved."));
    const patch = calls.find((call) => call.init?.method === "PATCH");
    expect(JSON.parse(String(patch?.init?.body))).toEqual({
      instanceId,
      answers: [{ fieldId: pests, boolean: true }, { fieldId: which, options: ["rodents"] }, { fieldId: notes, text: "Bait placed." }],
      status: "in_progress",
    });
  });
});

describe("templates with conditions", () => {
  it("shows each condition in words and the service types a template is assigned to, and the builder posts a condition by position", async () => {
    const calls = serve();
    const user = userEvent.setup();
    render(<ServicesFormsPanel />);

    await user.click(await screen.findByRole("tab", { name: /Templates/ }));
    expect(await screen.findByTestId(`services-form-conditions-${templateId}`)).toHaveTextContent("“Which pests?” asked when “Pests found?” is yes");
    expect(screen.getByText(/assigned to new Rodent control visits/)).toBeInTheDocument();

    await user.click(screen.getByTestId("services-forms-new-template"));
    const builder = await screen.findByTestId("form-template-builder");
    await user.type(within(builder).getByLabelText("Form name"), "Rodent report");
    await user.type(within(builder).getByLabelText("Trigger service types"), "Rodent control, rodent control");
    await user.type(within(builder).getByLabelText("Question 1"), "Bait placed?");
    await user.selectOptions(within(builder).getByLabelText("Question 1 type"), "boolean");
    await user.click(within(builder).getByTestId("builder-add-question"));
    await user.type(within(builder).getByLabelText("Question 2"), "Where?");
    await user.selectOptions(within(builder).getByLabelText("Question 2 depends on"), "1");
    await user.selectOptions(within(builder).getByLabelText("Question 2 condition"), "is_true");
    await user.click(within(builder).getByTestId("builder-save"));
    await waitFor(() => expect(calls.some((call) => call.init?.method === "POST")).toBe(true));
    const post = calls.find((call) => call.init?.method === "POST");
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      name: "Rodent report", kind: "inspection", triggerServiceTypes: ["Rodent control"],
      fields: [
        { label: "Bait placed?", fieldType: "boolean", required: false },
        { label: "Where?", fieldType: "text", required: false, dependsOn: 1, showWhen: { op: "is_true" } },
      ],
    });
  });
});
