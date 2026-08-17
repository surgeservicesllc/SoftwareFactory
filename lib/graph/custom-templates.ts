import { z } from "zod";

import { NODE_CAPABILITIES } from "@/lib/graph/contracts";
import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { previewTemplate, type GraphPreview } from "@/lib/graph/preview";
import {
  auditTemplate,
  GRAPH_TEMPLATES,
  TEMPLATE_CATEGORIES,
  type GraphTemplate,
} from "@/lib/graph/templates";

/**
 * Custom pipeline templates: the database-stored counterpart of the built-in
 * library. A custom template is expressed in the audit-areas shape — the same
 * builder eleven of the fourteen built-ins use — and compiled by the same
 * engine, so a card's topology facts are equally real for both kinds. The
 * definition never carries provider accounts or credentials; the database
 * enforces the same bounds this schema does.
 */

export const customTemplateAreaSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,40}$/),
  job: z.string().trim().min(1).max(500),
}).strict();

export const customTemplateSchema = z.object({
  slug: z.string().regex(/^[a-z0-9_]{1,60}$/),
  name: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(2_000),
  category: z.enum(TEMPLATE_CATEGORIES),
  capability: z.enum(NODE_CAPABILITIES),
  areas: z.array(customTemplateAreaSchema).min(1).max(12)
    .refine(
      (areas) => new Set(areas.map((area) => area.id)).size === areas.length,
      { message: "Area ids must be unique." },
    ),
}).strict();

export type CustomTemplateInput = z.infer<typeof customTemplateSchema>;

/** The stored definition shape (graph_templates.definition). */
export type StoredCustomDefinition = {
  kind: "audit_areas";
  category: string;
  capability: string;
  areas: Array<{ id: string; job: string }>;
};

const BUILT_IN_KEYS = new Set(GRAPH_TEMPLATES.map((template) => template.key));

export function isBuiltInTemplateKey(key: string): boolean {
  return BUILT_IN_KEYS.has(key);
}

/** Build the GraphTemplate for a custom definition — same builder as the built-ins. */
export function buildCustomTemplate(input: CustomTemplateInput): GraphTemplate {
  return {
    ...auditTemplate({
      key: input.slug,
      name: input.name,
      summary: input.summary,
      areas: input.areas,
      capability: input.capability,
      category: input.category,
    }),
  };
}

/** Parse a stored definition row back into the input shape, refusing drift. */
export function parseStoredDefinition(
  slug: string,
  name: string,
  summary: string,
  definition: unknown,
): CustomTemplateInput | null {
  if (typeof definition !== "object" || definition === null) return null;
  const record = definition as Partial<StoredCustomDefinition>;
  if (record.kind !== "audit_areas") return null;
  const candidate = {
    slug,
    name,
    summary,
    category: record.category,
    capability: record.capability,
    areas: record.areas,
  };
  const parsed = customTemplateSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Compile a custom template exactly as the built-ins compile. Returns the
 * preview (real topology, node count, parallel width) or the compiler's own
 * errors — never a guess.
 */
export function compileCustomTemplate(input: CustomTemplateInput):
  | { ok: true; template: GraphTemplate; preview: GraphPreview }
  | { ok: false; errors: string[] } {
  const template = buildCustomTemplate(input);
  const preview = previewTemplate(template, DEFAULT_GRAPH_BUDGET);
  if (!preview.ok) {
    return { ok: false, errors: preview.errors.map((error) => error.detail) };
  }
  return { ok: true, template, preview };
}
