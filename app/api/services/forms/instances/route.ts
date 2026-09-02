import { z } from "zod";

import { toFormQuestionView, type CrmFormQuestionRow } from "@/lib/services/form-conditions";

import {
  CRM_ANSWER_SHAPE,
  CRM_FORM_ANSWER_COLUMNS,
  CRM_FORM_FIELD_COLUMNS,
  CRM_FORM_INSTANCE_COLUMNS,
  CRM_FORM_STATUSES,
  isStoragePath,
  toFormAnswerView,
  toFormFieldView,
  toFormInstanceView,
  type CrmFormAnswerRow,
  type CrmFormFieldRow,
  type CrmFormInstanceRow,
} from "@/lib/services/crm";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Assign a form, answer it, sign it, complete it.
 *
 * Two of the schema's rules are restated here so a refusal names the
 * mistake rather than surfacing a trigger: an answer goes in the column its
 * question's type calls for, and a signature is a name, a moment and a
 * stored image together or none of the three. The database is still the
 * authority on both — this route only makes the message readable.
 *
 * "Completed" is not something this route asserts either. The database
 * counts the required questions against the answers present and refuses the
 * difference, which is why a completed form here really is complete.
 */

const answerSchema = z
  .object({
    fieldId: z.string().uuid(),
    text: z.string().trim().min(1).max(4000).optional(),
    number: z.number().finite().optional(),
    boolean: z.boolean().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date, as YYYY-MM-DD.").optional(),
    options: z.array(z.string().trim().min(1).max(120)).min(1).max(100).optional(),
  })
  .strict()
  .refine(
    (value) =>
      [value.text, value.number, value.boolean, value.date, value.options].filter(
        (given) => given !== undefined,
      ).length === 1,
    { message: "An answer carries exactly one value." },
  );

const createSchema = z
  .object({
    templateId: z.string().uuid(),
    accountId: z.string().uuid().nullish(),
    propertyId: z.string().uuid().nullish(),
    workOrderId: z.string().uuid().nullish(),
    technicianId: z.string().uuid().nullish(),
    notes: z.string().trim().min(1).max(4000).nullish(),
  })
  .strict();

const patchSchema = z
  .object({
    instanceId: z.string().uuid(),
    status: z.enum(CRM_FORM_STATUSES).optional(),
    answers: z.array(answerSchema).max(500).optional(),
    notes: z.string().trim().min(1).max(4000).nullable().optional(),
    signedByName: z.string().trim().min(1).max(120).optional(),
    signaturePath: z.string().trim().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, { message: "Nothing to change." })
  .refine(
    (value) => (value.signedByName === undefined) === (value.signaturePath === undefined),
    { message: "A signature is a name and a stored image together." },
  )
  .refine((value) => value.signaturePath === undefined || isStoragePath(value.signaturePath), {
    message: "The signature is a private storage path — not a URL.",
  });

export async function GET(request: Request) {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const url = new URL(request.url);
    const instanceId = url.searchParams.get("instanceId");
    if (instanceId === null || instanceId === "") {
      return jsonNoStore(
        { error: { code: "instance_required", message: "Name the form to read." } },
        { status: 400 },
      );
    }

    const instance = await client
      .from("crm_form_instances")
      .select(CRM_FORM_INSTANCE_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .eq("id", instanceId)
      .maybeSingle();
    if (instance.error) return databaseErrorResponse(instance.error);
    if (!instance.data) {
      return jsonNoStore(
        { error: { code: "instance_not_found", message: "No such form in this workspace." } },
        { status: 404 },
      );
    }
    const view = toFormInstanceView(instance.data as unknown as CrmFormInstanceRow);

    const [fields, answers, asked] = await Promise.all([
      client
        .from("crm_form_fields")
        .select(CRM_FORM_FIELD_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .eq("template_id", view.templateId)
        .order("position", { ascending: true })
        .limit(500),
      client
        .from("crm_form_answers")
        .select(CRM_FORM_ANSWER_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .eq("instance_id", view.id)
        .limit(500),
      client.rpc("crm_form_instance_questions", { p_instance: view.id }).limit(500),
    ]);
    if (fields.error) return databaseErrorResponse(fields.error);
    if (answers.error) return databaseErrorResponse(answers.error);
    if (asked.error) return databaseErrorResponse(asked.error);

    const questions = ((asked.data ?? []) as unknown as CrmFormQuestionRow[]).map(toFormQuestionView);

    return jsonNoStore({
      instance: view,
      fields: ((fields.data ?? []) as unknown as CrmFormFieldRow[]).map(toFormFieldView),
      answers: ((answers.data ?? []) as unknown as CrmFormAnswerRow[]).map(toFormAnswerView),
      // Every question with whether it is asked, given the answers so far,
      // and whether it is answered — the database's own reading (ADR-238).
      questions,
      // What still stands between this form and being completable, named
      // rather than discovered on the refusal: required, asked, unanswered.
      unansweredRequired: questions
        .filter((question) => question.required && question.asked && !question.answered)
        .map((question) => question.label),
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_form_unavailable", message: "The form could not be read." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 32_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("crm_form_instances")
      .insert({
        organization_id: activeOrganization.id,
        template_id: payload.templateId,
        account_id: payload.accountId ?? null,
        property_id: payload.propertyId ?? null,
        work_order_id: payload.workOrderId ?? null,
        technician_id: payload.technicianId ?? null,
        status: "assigned",
        notes: payload.notes ?? null,
        created_by: user.id,
      })
      .select(CRM_FORM_INSTANCE_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23503") {
        return jsonNoStore(
          {
            error: {
              code: "reference_not_found",
              message:
                "The form, customer, site, visit or technician is not in this workspace — and the site must belong to the customer.",
            },
          },
          { status: 404 },
        );
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore(
      { instance: toFormInstanceView(data as unknown as CrmFormInstanceRow) },
      { status: 201 },
    );
  } catch (error) {
    return failure(error, "invalid_form_assignment", "crm_form_not_assigned", "The form could not be assigned.");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = patchSchema.parse(await readBoundedJson(request, 200_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const existing = await client
      .from("crm_form_instances")
      .select(CRM_FORM_INSTANCE_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.instanceId)
      .maybeSingle();
    if (existing.error) return databaseErrorResponse(existing.error);
    if (!existing.data) {
      return jsonNoStore(
        { error: { code: "instance_not_found", message: "No such form in this workspace." } },
        { status: 404 },
      );
    }
    const before = toFormInstanceView(existing.data as unknown as CrmFormInstanceRow);

    if (payload.answers !== undefined && payload.answers.length > 0) {
      // Each answer goes in the column its question's type calls for. The
      // database checks this too; doing it here names the question.
      const fields = await client
        .from("crm_form_fields")
        .select(CRM_FORM_FIELD_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .eq("template_id", before.templateId)
        .limit(500);
      if (fields.error) return databaseErrorResponse(fields.error);
      const byId = new Map(
        ((fields.data ?? []) as unknown as CrmFormFieldRow[]).map((row) => [row.id, toFormFieldView(row)]),
      );

      const rows: Array<{ position: number; row: Record<string, unknown> }> = [];
      for (const answer of payload.answers) {
        const field = byId.get(answer.fieldId);
        if (field === undefined) {
          return jsonNoStore(
            {
              error: {
                code: "question_not_on_form",
                message: "One of those answers is for a question this form does not ask.",
              },
            },
            { status: 422 },
          );
        }
        const shape = CRM_ANSWER_SHAPE[field.fieldType];
        const given =
          answer.text !== undefined ? "text"
          : answer.number !== undefined ? "number"
          : answer.boolean !== undefined ? "boolean"
          : answer.date !== undefined ? "date"
          : "options";
        if (given !== shape) {
          return jsonNoStore(
            {
              error: {
                code: "answer_shape_mismatch",
                message: `"${field.label}" is a ${field.fieldType.replace(/_/g, " ")} question and cannot be answered with a ${given} value.`,
              },
            },
            { status: 422 },
          );
        }
        rows.push({
          position: field.position,
          row: {
            organization_id: activeOrganization.id,
            instance_id: before.id,
            field_id: field.id,
            value_text: answer.text ?? null,
            value_number: answer.number ?? null,
            value_boolean: answer.boolean ?? null,
            value_date: answer.date ?? null,
            value_options: answer.options ?? null,
            created_by: user.id,
          },
        });
      }

      // Parents before children: a question is asked by the answer before it,
      // and the database checks each answer against the answers already in.
      rows.sort((a, b) => a.position - b.position);
      const saved = await client
        .from("crm_form_answers")
        .upsert(rows.map((entry) => entry.row) as never, { onConflict: "organization_id,instance_id,field_id" });
      if (saved.error) {
        if (saved.error.code === "23514" && /not asked/i.test(saved.error.message ?? "")) {
          return jsonNoStore(
            {
              error: {
                code: "question_not_asked",
                message: "One of those answers is for a question this form is not asking yet — answer the question it depends on first.",
              },
            },
            { status: 422 },
          );
        }
        if (saved.error.code === "23514") {
          return jsonNoStore(
            {
              error: {
                code: "answer_refused",
                message: "The database refused an answer — check its shape against the question's type and choices.",
              },
            },
            { status: 409 },
          );
        }
        return databaseErrorResponse(saved.error);
      }
    }

    const now = new Date().toISOString();
    const changes: Record<string, unknown> = {};
    if (payload.notes !== undefined) changes.notes = payload.notes;
    if (payload.signedByName !== undefined && payload.signaturePath !== undefined) {
      changes.signed_by_name = payload.signedByName;
      changes.signature_path = payload.signaturePath;
      changes.signed_at = before.signedAt ?? now;
    }
    if (payload.status !== undefined) {
      changes.status = payload.status;
      if (payload.status === "in_progress") changes.started_at = before.startedAt ?? now;
      if (payload.status === "completed") {
        changes.started_at = before.startedAt ?? now;
        changes.completed_at = before.completedAt ?? now;
      } else {
        changes.completed_at = null;
      }
    }

    if (Object.keys(changes).length === 0) {
      return jsonNoStore({ instance: before });
    }

    const { data, error } = await client
      .from("crm_form_instances")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.instanceId)
      .select(CRM_FORM_INSTANCE_COLUMNS)
      .maybeSingle();
    if (error) {
      if (error.code === "23514" || error.code === "P0001") {
        return jsonNoStore(
          {
            error: {
              code: "form_not_complete",
              message:
                "The database refused it — a completed form has answered every required question, and a signature is a name, a moment and an image together.",
            },
          },
          { status: 409 },
        );
      }
      return databaseErrorResponse(error);
    }
    if (!data) {
      return jsonNoStore(
        { error: { code: "instance_not_found", message: "No such form in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ instance: toFormInstanceView(data as unknown as CrmFormInstanceRow) });
  } catch (error) {
    return failure(error, "invalid_form_change", "crm_form_not_updated", "The form could not be updated.");
  }
}

function failure(error: unknown, invalidCode: string, failureCode: string, message: string) {
  if (error instanceof ApiRequestError) return requestErrorResponse(error);
  if (error instanceof z.ZodError) {
    return jsonNoStore(
      { error: { code: invalidCode, message: error.issues[0]?.message ?? message } },
      { status: 422 },
    );
  }
  const boundary = supabaseBoundaryErrorResponse(error);
  if (boundary) return boundary;
  return jsonNoStore({ error: { code: failureCode, message } }, { status: 500 });
}
