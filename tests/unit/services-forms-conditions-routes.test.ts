// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization } = vi.hoisted(() => ({ requireActiveOrganization: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));
vi.mock("@/lib/supabase/request", () => ({ assertSameOriginRequest: () => undefined }));

import { PATCH as patchTemplate, POST as createTemplate } from "@/app/api/services/forms/route";
import { GET as readInstance, PATCH as patchInstance } from "@/app/api/services/forms/instances/route";

/**
 * The boundaries of the form that asks the next question: a condition is
 * resolved by position and written second, a later parent is refused before
 * the database, a template's trigger list is patchable, the instance read
 * carries every question with `asked` and counts only asked required ones,
 * and answers go in parents-first with the not-asked refusal named.
 */

const organizationId = "10000000-0000-4000-8000-000000300001";
const userId = "00000000-0000-4000-8000-000000300001";
const templateId = "70000000-0000-4000-8000-000000300001";
const instanceId = "71000000-0000-4000-8000-000000300001";
const pests = "72000000-0000-4000-8000-000000300001";
const which = "72000000-0000-4000-8000-000000300002";

let inserts: Array<{ table: string; rows: unknown }>;
let updates: Array<{ table: string; changes: Record<string, unknown>; id: string | null }>;
let upserted: Array<Record<string, unknown>>;
let upsertError: { code: string; message: string } | null;

const fieldRows = [
  { id: pests, template_id: templateId, position: 1, label: "Pests found?", field_type: "boolean", required: true, help_text: null, options: null, depends_on_field_id: null, show_when: null, created_at: "x" },
  { id: which, template_id: templateId, position: 2, label: "Which pests?", field_type: "multi_select", required: true, help_text: null, options: ["ants", "rodents"], depends_on_field_id: null, show_when: null, created_at: "x" },
];

function client(options: { questions?: unknown[] } = {}) {
  inserts = [];
  updates = [];
  upserted = [];
  const rpc = vi.fn((name: string) => {
    const response = { data: name === "crm_form_instance_questions" ? (options.questions ?? []) : [], error: null };
    return Object.assign(Promise.resolve(response), { limit: () => Promise.resolve(response) });
  });
  const from = vi.fn((table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      limit: () => Promise.resolve({ data: table === "crm_form_fields" ? fieldRows : [], error: null }),
      maybeSingle: () => Promise.resolve({
        data: table === "crm_form_instances"
          ? { id: instanceId, template_id: templateId, account_id: null, property_id: null, work_order_id: null, technician_id: null, status: "assigned", assigned_at: "x", started_at: null, completed_at: null, signed_by_name: null, signed_at: null, signature_path: null, notes: null, created_at: "x", updated_at: "x" }
          : table === "crm_form_templates"
            ? { id: templateId, name: "Service report", kind: "service_report", version: 1, description: null, active: true, trigger_service_types: updates.at(-1)?.changes.trigger_service_types ?? [], created_at: "x", updated_at: "x" }
            : null,
        error: null,
      }),
      single: () => Promise.resolve({ data: { id: templateId, name: "Service report", kind: "service_report", version: 1, description: null, active: true, trigger_service_types: (inserts.at(-1)?.rows as { trigger_service_types?: string[] })?.trigger_service_types ?? [], created_at: "x", updated_at: "x" }, error: null }),
      insert: (rows: unknown) => {
        inserts.push({ table, rows });
        if (table === "crm_form_fields") {
          const returned = (rows as Array<Record<string, unknown>>).map((row, index) => ({ ...row, id: index === 0 ? pests : which, created_at: "x", depends_on_field_id: null, show_when: null }));
          return { select: () => Promise.resolve({ data: returned, error: null }) };
        }
        return query;
      },
      update: (changes: Record<string, unknown>) => {
        updates.push({ table, changes, id: null });
        const chain = {
          eq: (column: string, value: string) => {
            if (column === "id") updates[updates.length - 1]!.id = value;
            return chain;
          },
          select: () => chain,
          maybeSingle: () => query.maybeSingle(),
          then: (resolve: (value: { data: null; error: null }) => void) => resolve({ data: null, error: null }),
        };
        return chain;
      },
      upsert: (rows: Array<Record<string, unknown>>) => {
        upserted = rows;
        return Promise.resolve({ data: null, error: upsertError });
      },
    };
    return query;
  });
  requireActiveOrganization.mockResolvedValue({ activeOrganization: { id: organizationId }, user: { id: userId }, client: { rpc, from } });
}

beforeEach(() => {
  vi.clearAllMocks();
  upsertError = null;
});

describe("creating a form with conditions", () => {
  it("writes the questions first, then each condition against the id its position resolved to", async () => {
    client();
    const response = await createTemplate(new Request("https://factory.example/api/services/forms", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Service report", kind: "service_report", triggerServiceTypes: ["Rodent control"],
        fields: [
          { label: "Pests found?", fieldType: "boolean", required: true },
          { label: "Which pests?", fieldType: "multi_select", required: true, options: ["ants", "rodents"], dependsOn: 1, showWhen: { op: "is_true" } },
        ],
      }),
    }));
    expect(response.status).toBe(201);
    expect((inserts[0]!.rows as { trigger_service_types: string[] }).trigger_service_types).toEqual(["Rodent control"]);
    const fields = inserts[1]!.rows as Array<Record<string, unknown>>;
    expect(fields.map((row) => row.position)).toEqual([1, 2]);
    expect(fields.every((row) => !("depends_on_field_id" in row))).toBe(true);
    expect(updates).toEqual([{ table: "crm_form_fields", changes: { depends_on_field_id: pests, show_when: { op: "is_true" } }, id: which }]);
  });

  it("refuses a condition on a later question, a half condition, and a malformed one before the database", async () => {
    client();
    for (const fields of [
      [{ label: "A", fieldType: "boolean" }, { label: "B", fieldType: "text", dependsOn: 2, showWhen: { op: "answered" } }],
      [{ label: "A", fieldType: "boolean" }, { label: "B", fieldType: "text", dependsOn: 1 }],
      [{ label: "A", fieldType: "boolean" }, { label: "B", fieldType: "text", dependsOn: 1, showWhen: { op: "equals" } }],
    ]) {
      const response = await createTemplate(new Request("https://factory.example/api/services/forms", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "X", fields }),
      }));
      expect(response.status).toBe(422);
    }
    expect(inserts).toEqual([]);
  });

  it("patches the trigger list on a template", async () => {
    client();
    const response = await patchTemplate(new Request("https://factory.example/api/services/forms", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ templateId, triggerServiceTypes: ["General pest"] }),
    }));
    expect(response.status).toBe(200);
    expect(updates[0]).toMatchObject({ table: "crm_form_templates", changes: { trigger_service_types: ["General pest"] } });
    expect(((await response.json()) as { template: { triggerServiceTypes: string[] } }).template.triggerServiceTypes).toEqual(["General pest"]);
  });
});

describe("reading and answering a form", () => {
  it("carries every question with whether it is asked, and counts only asked required questions as outstanding", async () => {
    client({ questions: [
      { field_id: pests, field_position: 1, label: "Pests found?", field_type: "boolean", required: true, help_text: null, options: null, depends_on_field_id: null, depends_on_label: null, show_when: null, asked: true, answered: false },
      { field_id: which, field_position: 2, label: "Which pests?", field_type: "multi_select", required: true, help_text: null, options: ["ants"], depends_on_field_id: pests, depends_on_label: "Pests found?", show_when: { op: "is_true" }, asked: false, answered: false },
    ] });
    const body = await (await readInstance(new Request(`https://factory.example/api/services/forms/instances?instanceId=${instanceId}`))).json();
    expect(body.questions.map((question: { label: string; asked: boolean; condition: string | null }) => [question.label, question.asked, question.condition])).toEqual([
      ["Pests found?", true, null],
      ["Which pests?", false, "asked when “Pests found?” is yes"],
    ]);
    expect(body.unansweredRequired).toEqual(["Pests found?"]);
    expect(body.fields[1]).toMatchObject({ dependsOnFieldId: null });
  });

  it("sends answers parents-first and names the not-asked refusal", async () => {
    client();
    const response = await patchInstance(new Request("https://factory.example/api/services/forms/instances", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ instanceId, answers: [{ fieldId: which, options: ["rodents"] }, { fieldId: pests, boolean: true }] }),
    }));
    expect(response.status).toBe(200);
    expect(upserted.map((row) => row.field_id)).toEqual([pests, which]);

    client();
    upsertError = { code: "23514", message: "that question is not asked on this form, given the answers so far" };
    const refused = await patchInstance(new Request("https://factory.example/api/services/forms/instances", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ instanceId, answers: [{ fieldId: which, options: ["rodents"] }] }),
    }));
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("question_not_asked");
  });
});
