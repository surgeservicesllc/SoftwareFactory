import { z } from "zod";

import { readShowWhen } from "@/lib/services/form-conditions";

import {
  CRM_CHOICE_FIELD_TYPES,
  CRM_FIELD_TYPES,
  CRM_FORM_FIELD_COLUMNS,
  CRM_FORM_INSTANCE_COLUMNS,
  CRM_FORM_KINDS,
  CRM_FORM_TEMPLATE_COLUMNS,
  toFormFieldView,
  toFormInstanceView,
  toFormTemplateView,
  type CrmFormFieldRow,
  type CrmFormInstanceRow,
  type CrmFormTemplateRow,
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
 * Form templates: the questions an inspection, service report or compliance
 * checklist asks.
 *
 * A template with forms assigned from it is versioned rather than edited —
 * the database refuses the edit, and this route offers the version instead.
 * A report whose questions changed underneath it is not a report, and that
 * is the whole reason the rule exists.
 */

const CHOICE = new Set<string>(CRM_CHOICE_FIELD_TYPES);

const fieldSchema = z
  .object({
    label: z.string().trim().min(1).max(300),
    fieldType: z.enum(CRM_FIELD_TYPES),
    required: z.boolean().default(false),
    helpText: z.string().trim().min(1).max(1000).nullish(),
    options: z.array(z.string().trim().min(1).max(120)).max(100).nullish(),
    /** The 1-based position of the earlier question this one depends on (ADR-238). */
    dependsOn: z.number().int().min(1).max(500).nullish(),
    showWhen: z.unknown().nullish(),
  })
  .strict()
  .refine((value) => CHOICE.has(value.fieldType) === Boolean(value.options?.length), {
    message: "A choice question carries its choices, and every other kind carries none.",
  })
  .refine((value) => (value.dependsOn == null) === (value.showWhen == null), {
    message: "A condition names the question it depends on and how it was answered — both, or neither.",
  })
  .refine((value) => value.showWhen == null || readShowWhen(value.showWhen) !== null, {
    message: "A condition is one of: answered, is yes, is no, is exactly a value, is any of some values.",
  });

const serviceTypeList = z.array(z.string().trim().min(1).max(120)).max(50);

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    kind: z.enum(CRM_FORM_KINDS).default("inspection"),
    description: z.string().trim().min(1).max(2000).nullish(),
    /** Publishing a new version of an existing form; defaults to the first. */
    version: z.number().int().min(1).max(1000).default(1),
    fields: z.array(fieldSchema).min(1).max(500),
    /** New visits of these service types get this form assigned (ADR-238). */
    triggerServiceTypes: serviceTypeList.default([]),
  })
  .strict()
  .refine((value) => value.fields.every((field, index) => field.dependsOn == null || field.dependsOn < index + 1), {
    message: "A question can only depend on an earlier question.",
  });

const patchSchema = z
  .object({
    templateId: z.string().uuid(),
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().min(1).max(2000).nullable().optional(),
    active: z.boolean().optional(),
    triggerServiceTypes: serviceTypeList.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, { message: "Nothing to change." });

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const [templateRows, fieldRows, instanceRows] = await Promise.all([
      client
        .from("crm_form_templates")
        .select(CRM_FORM_TEMPLATE_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .order("name", { ascending: true })
        .order("version", { ascending: false })
        .limit(400),
      client
        .from("crm_form_fields")
        .select(CRM_FORM_FIELD_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .order("position", { ascending: true })
        .limit(5000),
      client
        .from("crm_form_instances")
        .select(CRM_FORM_INSTANCE_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .order("assigned_at", { ascending: false })
        .limit(500),
    ]);
    if (templateRows.error) return databaseErrorResponse(templateRows.error);
    if (fieldRows.error) return databaseErrorResponse(fieldRows.error);
    if (instanceRows.error) return databaseErrorResponse(instanceRows.error);

    const templates = ((templateRows.data ?? []) as unknown as CrmFormTemplateRow[]).map(
      toFormTemplateView,
    );
    const fields = ((fieldRows.data ?? []) as unknown as CrmFormFieldRow[]).map(toFormFieldView);
    const instances = ((instanceRows.data ?? []) as unknown as CrmFormInstanceRow[]).map(
      toFormInstanceView,
    );

    const fieldsByTemplate = new Map<string, ReturnType<typeof toFormFieldView>[]>();
    for (const field of fields) {
      const bucket = fieldsByTemplate.get(field.templateId) ?? [];
      bucket.push(field);
      fieldsByTemplate.set(field.templateId, bucket);
    }
    const usedTemplates = new Set(instances.map((instance) => instance.templateId));

    return jsonNoStore({
      templates: templates.map((template) => ({
        ...template,
        fields: fieldsByTemplate.get(template.id) ?? [],
        // Reported so the page can say why editing is closed, rather than
        // surfacing the refusal only when someone tries.
        inUse: usedTemplates.has(template.id),
      })),
      instances,
      counts: {
        templates: templates.length,
        assigned: instances.filter((instance) => instance.status === "assigned").length,
        inProgress: instances.filter((instance) => instance.status === "in_progress").length,
        completed: instances.filter((instance) => instance.status === "completed").length,
        // Completed forms nobody signed: the number an auditor asks for.
        completedUnsigned: instances.filter(
          (instance) => instance.status === "completed" && !instance.signed,
        ).length,
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_forms_unavailable", message: "Forms could not be listed." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 200_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const created = await client
      .from("crm_form_templates")
      .insert({
        organization_id: activeOrganization.id,
        name: payload.name,
        kind: payload.kind,
        version: payload.version,
        description: payload.description ?? null,
        trigger_service_types: payload.triggerServiceTypes,
        created_by: user.id,
      })
      .select(CRM_FORM_TEMPLATE_COLUMNS)
      .single();
    if (created.error) {
      if (created.error.code === "23505") {
        return jsonNoStore(
          {
            error: {
              code: "template_version_taken",
              message: "That form already has a version with this number — publish the next one.",
            },
          },
          { status: 409 },
        );
      }
      return databaseErrorResponse(created.error);
    }

    const template = toFormTemplateView(created.data as unknown as CrmFormTemplateRow);
    const fields = await client
      .from("crm_form_fields")
      .insert(
        payload.fields.map((field, index) => ({
          organization_id: activeOrganization.id,
          template_id: template.id,
          position: index + 1,
          label: field.label,
          field_type: field.fieldType,
          required: field.required,
          help_text: field.helpText ?? null,
          options: field.options ?? null,
        })) as never,
      )
      .select(CRM_FORM_FIELD_COLUMNS);
    if (fields.error) return databaseErrorResponse(fields.error);

    // Conditions point at questions that now have ids: resolved by position,
    // written second, and checked by the database against the parent's type.
    const byPosition = new Map(
      ((fields.data ?? []) as unknown as CrmFormFieldRow[]).map((row) => [row.position, row]),
    );
    let rows = (fields.data ?? []) as unknown as CrmFormFieldRow[];
    for (const [index, field] of payload.fields.entries()) {
      if (field.dependsOn == null || field.showWhen == null) continue;
      const child = byPosition.get(index + 1);
      const parent = byPosition.get(field.dependsOn);
      if (child === undefined || parent === undefined) continue;
      const conditioned = await client
        .from("crm_form_fields")
        .update({ depends_on_field_id: parent.id, show_when: readShowWhen(field.showWhen) })
        .eq("organization_id", activeOrganization.id)
        .eq("id", child.id);
      if (conditioned.error) {
        if (conditioned.error.code === "23514" || conditioned.error.code === "P0001") {
          return jsonNoStore(
            { error: { code: "condition_refused", message: `"${field.label}": ${conditioned.error.message}` } },
            { status: 422 },
          );
        }
        return databaseErrorResponse(conditioned.error);
      }
    }
    if (payload.fields.some((field) => field.dependsOn != null)) {
      const reread = await client
        .from("crm_form_fields")
        .select(CRM_FORM_FIELD_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .eq("template_id", template.id)
        .order("position", { ascending: true })
        .limit(500);
      if (reread.error) return databaseErrorResponse(reread.error);
      rows = (reread.data ?? []) as unknown as CrmFormFieldRow[];
    }

    return jsonNoStore(
      {
        template: {
          ...template,
          inUse: false,
          fields: rows.map(toFormFieldView),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return failure(error, "invalid_form_template", "crm_form_template_not_recorded", "The form could not be created.");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = patchSchema.parse(await readBoundedJson(request, 32_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    // The questions are deliberately not patchable here. Changing them on a
    // template with forms assigned is what the database refuses; changing
    // them on one without is still a new version, so the page offers that.
    const changes: Record<string, unknown> = {};
    if (payload.name !== undefined) changes.name = payload.name;
    if (payload.description !== undefined) changes.description = payload.description;
    if (payload.active !== undefined) changes.active = payload.active;
    if (payload.triggerServiceTypes !== undefined) changes.trigger_service_types = payload.triggerServiceTypes;

    const { data, error } = await client
      .from("crm_form_templates")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.templateId)
      .select(CRM_FORM_TEMPLATE_COLUMNS)
      .maybeSingle();
    if (error) return databaseErrorResponse(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "template_not_found", message: "No such form in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ template: toFormTemplateView(data as unknown as CrmFormTemplateRow) });
  } catch (error) {
    return failure(error, "invalid_template_change", "crm_form_template_not_updated", "The form could not be updated.");
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
