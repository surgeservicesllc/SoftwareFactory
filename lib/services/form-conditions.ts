/**
 * The form asks the next question (ADR-238): the pure side of conditional
 * questions. The database decides what is asked — `crm_form_question_asked`
 * walks the chain — and this file mirrors the rule so a page can hide a
 * question the moment its parent is answered, names the rule in words a
 * person can read beside the question, and validates a condition before it
 * is sent.
 */

export const SHOW_WHEN_OPS = ["answered", "is_true", "is_false", "equals", "any_of"] as const;
export type ShowWhenOp = (typeof SHOW_WHEN_OPS)[number];

export type ShowWhen =
  | { op: "answered" }
  | { op: "is_true" }
  | { op: "is_false" }
  | { op: "equals"; value: string }
  | { op: "any_of"; values: string[] };

export const SHOW_WHEN_OP_LABELS: Readonly<Record<ShowWhenOp, string>> = {
  answered: "is answered",
  is_true: "is yes",
  is_false: "is no",
  equals: "is exactly",
  any_of: "is any of",
};

/** The condition as the schema will accept it, or null with nothing invented. */
export function readShowWhen(value: unknown): ShowWhen | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const op = record.op;
  if (op === "answered" || op === "is_true" || op === "is_false") {
    return "value" in record || "values" in record ? null : { op };
  }
  if (op === "equals") {
    return typeof record.value === "string" && record.value.length >= 1 && record.value.length <= 4000 && !("values" in record)
      ? { op, value: record.value }
      : null;
  }
  if (op === "any_of") {
    const values = record.values;
    return Array.isArray(values)
      && values.length >= 1 && values.length <= 100
      && values.every((entry) => typeof entry === "string" && entry.length >= 1 && entry.length <= 4000)
      && !("value" in record)
      ? { op, values: values as string[] }
      : null;
  }
  return null;
}

/** Which ops a parent of this type can carry. */
export function opsForFieldType(fieldType: string): readonly ShowWhenOp[] {
  if (fieldType === "boolean") return ["answered", "is_true", "is_false"];
  return ["answered", "equals", "any_of"];
}

/** "asked when “Pests found?” is yes" — the rule, beside the question. */
export function describeCondition(showWhen: ShowWhen, parentLabel: string): string {
  const subject = `“${parentLabel}”`;
  switch (showWhen.op) {
    case "answered":
      return `asked when ${subject} is answered`;
    case "is_true":
      return `asked when ${subject} is yes`;
    case "is_false":
      return `asked when ${subject} is no`;
    case "equals":
      return `asked when ${subject} is “${showWhen.value}”`;
    case "any_of":
      return `asked when ${subject} is ${showWhen.values.map((value) => `“${value}”`).join(" or ")}`;
  }
}

/** One answer as the page holds it before it is saved. */
export type DraftAnswer =
  | { kind: "text"; value: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "date"; value: string }
  | { kind: "options"; value: string[] }
  | null;

/**
 * The database's rule, in TypeScript: the same five ops over the same five
 * shapes, so a page can hide a question the moment its parent changes
 * without waiting for a round trip. The database remains the authority —
 * an answer to a question it considers unasked is refused there.
 */
export function conditionMet(showWhen: ShowWhen, parent: DraftAnswer): boolean {
  if (parent === null) return false;
  switch (showWhen.op) {
    case "answered":
      return true;
    case "is_true":
      return parent.kind === "boolean" && parent.value;
    case "is_false":
      return parent.kind === "boolean" && !parent.value;
    case "equals":
      return parent.kind === "options" ? parent.value.includes(showWhen.value) : String(parent.value) === showWhen.value;
    case "any_of":
      return parent.kind === "options"
        ? parent.value.some((entry) => showWhen.values.includes(entry))
        : showWhen.values.includes(String(parent.value));
  }
}

export type ConditionedQuestion = {
  fieldId: string;
  dependsOnFieldId: string | null;
  showWhen: ShowWhen | null;
};

/**
 * Whether a question is asked given the draft answers on the page — up the
 * whole chain, as the database does it. A question whose parent is unasked
 * is unasked, whatever the parent's stale answer says.
 */
export function askedNow(
  question: ConditionedQuestion,
  byId: ReadonlyMap<string, ConditionedQuestion>,
  answers: ReadonlyMap<string, DraftAnswer>,
): boolean {
  let current = question;
  let depth = 0;
  while (current.dependsOnFieldId !== null && current.showWhen !== null) {
    depth += 1;
    if (depth > 500) return false;
    const parent = byId.get(current.dependsOnFieldId);
    if (parent === undefined) return false;
    if (!conditionMet(current.showWhen, answers.get(parent.fieldId) ?? null)) return false;
    current = parent;
  }
  return true;
}

export type CrmFormQuestionRow = {
  field_id: string;
  field_position: number;
  label: string;
  field_type: string;
  required: boolean;
  help_text: string | null;
  options: string[] | null;
  depends_on_field_id: string | null;
  depends_on_label: string | null;
  show_when: Record<string, unknown> | null;
  asked: boolean;
  answered: boolean;
};

export type FormQuestionView = {
  fieldId: string;
  position: number;
  label: string;
  fieldType: string;
  required: boolean;
  helpText: string | null;
  options: string[];
  dependsOnFieldId: string | null;
  dependsOnLabel: string | null;
  showWhen: ShowWhen | null;
  /** The rule, in words, or null for an unconditional question. */
  condition: string | null;
  asked: boolean;
  answered: boolean;
};

export function toFormQuestionView(row: CrmFormQuestionRow): FormQuestionView {
  const showWhen = readShowWhen(row.show_when);
  return {
    fieldId: row.field_id,
    position: Number(row.field_position),
    label: row.label,
    fieldType: row.field_type,
    required: row.required,
    helpText: row.help_text,
    options: row.options ?? [],
    dependsOnFieldId: row.depends_on_field_id,
    dependsOnLabel: row.depends_on_label,
    showWhen,
    condition: showWhen !== null && row.depends_on_label !== null ? describeCondition(showWhen, row.depends_on_label) : null,
    asked: row.asked,
    answered: row.answered,
  };
}

/** A comma-separated list of service types, trimmed, de-duplicated case-insensitively, bounded as the schema bounds it. */
export function readServiceTypeList(value: string): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const raw of value.split(",")) {
    const entry = raw.trim();
    if (entry.length === 0 || entry.length > 120) continue;
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(entry);
    if (list.length === 50) break;
  }
  return list;
}
