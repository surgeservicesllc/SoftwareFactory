"use client";

import { useState } from "react";

import { Notice, SectionTitle } from "@/components/ui";
import {
  SHOW_WHEN_OP_LABELS,
  opsForFieldType,
  readServiceTypeList,
  type ShowWhen,
  type ShowWhenOp,
} from "@/lib/services/form-conditions";

/**
 * A new form (ADR-238): its questions in order, each optionally asked only
 * when an earlier question was answered a certain way, and the service
 * types whose new visits get it assigned. The builder offers only the
 * conditions the database will accept — an earlier question, an op that
 * fits its type — and the database checks them again on the way in.
 */

const FIELD_TYPES = ["text", "long_text", "number", "boolean", "date", "select", "multi_select"] as const;
const FORM_KINDS = ["inspection", "service_report", "compliance_checklist", "wdo_report", "safety_check", "other"] as const;

type DraftField = {
  label: string;
  fieldType: (typeof FIELD_TYPES)[number];
  required: boolean;
  helpText: string;
  options: string;
  dependsOn: number | null;
  op: ShowWhenOp;
  value: string;
};

const EMPTY_FIELD: DraftField = { label: "", fieldType: "text", required: false, helpText: "", options: "", dependsOn: null, op: "answered", value: "" };

function showWhenOf(field: DraftField): ShowWhen | null {
  if (field.dependsOn === null) return null;
  switch (field.op) {
    case "answered":
    case "is_true":
    case "is_false":
      return { op: field.op };
    case "equals":
      return { op: "equals", value: field.value.trim() };
    case "any_of":
      return { op: "any_of", values: field.value.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0) };
  }
}

async function readFailure(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}

export function FormTemplateBuilder({ onCreated, onClose }: { onCreated: () => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<(typeof FORM_KINDS)[number]>("inspection");
  const [description, setDescription] = useState("");
  const [triggers, setTriggers] = useState("");
  const [fields, setFields] = useState<DraftField[]>([{ ...EMPTY_FIELD }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const update = (index: number, patch: Partial<DraftField>) => {
    setFields((current) => current.map((field, at) => (at === index ? { ...field, ...patch } : field)));
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const body = {
        name: name.trim(),
        kind,
        ...(description.trim().length > 0 ? { description: description.trim() } : {}),
        triggerServiceTypes: readServiceTypeList(triggers),
        fields: fields.map((field) => {
          const showWhen = showWhenOf(field);
          const choices = field.options.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
          return {
            label: field.label.trim(),
            fieldType: field.fieldType,
            required: field.required,
            ...(field.helpText.trim().length > 0 ? { helpText: field.helpText.trim() } : {}),
            ...(field.fieldType === "select" || field.fieldType === "multi_select" ? { options: choices } : {}),
            ...(showWhen !== null && field.dependsOn !== null ? { dependsOn: field.dependsOn, showWhen } : {}),
          };
        }),
      };
      const response = await fetch("/api/services/forms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setError(await readFailure(response, "The form could not be created."));
        return;
      }
      onCreated();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mt-4 rounded-lg border border-line bg-surface-inset p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      data-testid="form-template-builder"
    >
      <SectionTitle
        title="New form"
        description="Questions in the order they are asked. A question can be asked only when an earlier one was answered a certain way; a service type named here gets this form on every new visit of that type."
      />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col text-xs text-muted">
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} className="mt-1 rounded-lg border border-line px-2 py-1 text-sm text-foreground" aria-label="Form name" />
        </label>
        <label className="flex flex-col text-xs text-muted">
          Kind
          <select value={kind} onChange={(event) => setKind(event.target.value as (typeof FORM_KINDS)[number])} className="mt-1 rounded-lg border border-line px-2 py-1 text-sm text-foreground" aria-label="Form kind">
            {FORM_KINDS.map((entry) => <option key={entry} value={entry}>{entry.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-xs text-muted sm:col-span-2">
          Description
          <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} className="mt-1 rounded-lg border border-line px-2 py-1 text-sm text-foreground" aria-label="Form description" />
        </label>
        <label className="flex flex-col text-xs text-muted sm:col-span-2">
          Assigned to new visits of these service types (comma-separated)
          <input value={triggers} onChange={(event) => setTriggers(event.target.value)} placeholder="Rodent control, General pest" className="mt-1 rounded-lg border border-line px-2 py-1 text-sm text-foreground" aria-label="Trigger service types" />
        </label>
      </div>

      <ol className="mt-4 space-y-3">
        {fields.map((field, index) => {
          const earlier = fields.slice(0, index);
          const parent = field.dependsOn === null ? undefined : fields[field.dependsOn - 1];
          const ops = parent === undefined ? [] : opsForFieldType(parent.fieldType);
          return (
            <li key={index} className="rounded-md border border-line bg-surface p-3" data-testid={`builder-field-${index + 1}`}>
              <div className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
                <label className="flex flex-col text-xs text-muted">
                  Question {index + 1}
                  <input value={field.label} onChange={(event) => update(index, { label: event.target.value })} required maxLength={300} className="mt-1 rounded-lg border border-line px-2 py-1 text-sm text-foreground" aria-label={`Question ${index + 1}`} />
                </label>
                <label className="flex flex-col text-xs text-muted">
                  Type
                  <select value={field.fieldType} onChange={(event) => update(index, { fieldType: event.target.value as DraftField["fieldType"] })} className="mt-1 rounded-lg border border-line px-2 py-1 text-sm text-foreground" aria-label={`Question ${index + 1} type`}>
                    {FIELD_TYPES.map((entry) => <option key={entry} value={entry}>{entry.replace(/_/g, " ")}</option>)}
                  </select>
                </label>
                <label className="flex items-end gap-1.5 pb-1.5 text-xs text-muted">
                  <input type="checkbox" checked={field.required} onChange={(event) => update(index, { required: event.target.checked })} aria-label={`Question ${index + 1} required`} />
                  Required
                </label>
              </div>
              {field.fieldType === "select" || field.fieldType === "multi_select" ? (
                <label className="mt-2 flex flex-col text-xs text-muted">
                  Choices (comma-separated)
                  <input value={field.options} onChange={(event) => update(index, { options: event.target.value })} className="mt-1 rounded-lg border border-line px-2 py-1 text-sm text-foreground" aria-label={`Question ${index + 1} choices`} />
                </label>
              ) : null}
              {earlier.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="flex flex-col text-xs text-muted">
                    Asked only when
                    <select
                      value={field.dependsOn ?? ""}
                      onChange={(event) => {
                        const dependsOn = event.target.value === "" ? null : Number(event.target.value);
                        const nextParent = dependsOn === null ? undefined : fields[dependsOn - 1];
                        update(index, { dependsOn, op: nextParent === undefined ? "answered" : opsForFieldType(nextParent.fieldType)[0], value: "" });
                      }}
                      className="mt-1 rounded-lg border border-line px-2 py-1 text-sm text-foreground"
                      aria-label={`Question ${index + 1} depends on`}
                    >
                      <option value="">always</option>
                      {earlier.map((entry, at) => (
                        <option key={at} value={at + 1}>{at + 1}. {entry.label || "(untitled)"}</option>
                      ))}
                    </select>
                  </label>
                  {parent !== undefined ? (
                    <label className="flex flex-col text-xs text-muted">
                      condition
                      <select value={field.op} onChange={(event) => update(index, { op: event.target.value as ShowWhenOp })} className="mt-1 rounded-lg border border-line px-2 py-1 text-sm text-foreground" aria-label={`Question ${index + 1} condition`}>
                        {ops.map((op) => <option key={op} value={op}>{SHOW_WHEN_OP_LABELS[op]}</option>)}
                      </select>
                    </label>
                  ) : null}
                  {parent !== undefined && (field.op === "equals" || field.op === "any_of") ? (
                    <label className="flex flex-col text-xs text-muted">
                      {field.op === "any_of" ? "values (comma-separated)" : "value"}
                      <input value={field.value} onChange={(event) => update(index, { value: event.target.value })} className="mt-1 rounded-lg border border-line px-2 py-1 text-sm text-foreground" aria-label={`Question ${index + 1} condition value`} />
                    </label>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary px-3 py-1.5 text-xs" onClick={() => setFields((current) => [...current, { ...EMPTY_FIELD }])} data-testid="builder-add-question">
          Add question
        </button>
        <button type="submit" disabled={busy} className="btn btn-primary px-3 py-1.5 text-xs" data-testid="builder-save">
          Create form
        </button>
        <button type="button" className="btn btn-secondary px-3 py-1.5 text-xs" onClick={onClose}>
          Cancel
        </button>
      </div>
      {error ? <div className="mt-3"><Notice tone="warning">{error}</Notice></div> : null}
    </form>
  );
}
