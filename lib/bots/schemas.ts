import { z } from "zod";

import { BOT_PROVIDER_IDS, findBotProvider } from "@/lib/bots/catalog";
import { RISK_LEVELS, type RiskLevel } from "@/lib/risk";

/**
 * Request shapes for the bot fabric API.
 *
 * These schemas run on the server, but the module stays browser-safe so the
 * console can reuse the same field bounds instead of re-deriving them.
 */

const nameSchema = z.string().trim().min(1).max(80);
const modelSchema = z.string().trim().min(1).max(120);
const credentialRefSchema = z.string().trim().max(64).optional().nullable();
const baseUrlSchema = z
  .string()
  .trim()
  .max(300)
  .refine((value) => value === "" || value.startsWith("https://"), {
    message: "The endpoint must be an HTTPS URL.",
  })
  .optional()
  .nullable();
const notesSchema = z.string().trim().max(500).optional().nullable();

export const registerBotSchema = z
  .object({
    name: nameSchema,
    provider: z.enum(BOT_PROVIDER_IDS),
    model: modelSchema,
    credentialRef: credentialRefSchema,
    baseUrl: baseUrlSchema,
    notes: notesSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const provider = findBotProvider(value.provider);
    if (provider?.requiresBaseUrl && !value.baseUrl) {
      context.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message: `${provider.label} requires an HTTPS endpoint.`,
      });
    }
  });

export const updateBotSchema = z
  .object({
    name: nameSchema,
    model: modelSchema,
    credentialRef: credentialRefSchema,
    baseUrl: baseUrlSchema,
    notes: notesSchema,
  })
  .strict();

export const saveBotRoleSchema = z
  .object({
    roleId: z.string().uuid().optional().nullable(),
    name: nameSchema,
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9-]{1,62}$/, "Use lowercase letters, numbers, and hyphens."),
    summary: z.string().trim().min(1).max(240),
    instructions: z.string().trim().min(1).max(8000),
    riskCeiling: z.enum(RISK_LEVELS),
    capabilities: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  })
  .strict();

export const assignBotSchema = z
  .object({
    botId: z.string().uuid(),
    projectId: z.string().uuid(),
    roleId: z.string().uuid(),
  })
  .strict();

export const updateAssignmentSchema = z
  .object({
    status: z.enum(["active", "paused", "released"]),
  })
  .strict();

export type RegisterBotInput = z.infer<typeof registerBotSchema>;
export type UpdateBotInput = z.infer<typeof updateBotSchema>;
export type SaveBotRoleInput = z.infer<typeof saveBotRoleSchema>;
export type AssignBotInput = z.infer<typeof assignBotSchema>;

const DATABASE_RISK_LEVELS = { GREEN: "green", YELLOW: "yellow", RED: "red" } as const;

/** The UI speaks GREEN/YELLOW/RED; `public.risk_level` stores the lowercase form. */
export function toDatabaseRiskLevel(level: RiskLevel): "green" | "yellow" | "red" {
  return DATABASE_RISK_LEVELS[level];
}

export function fromDatabaseRiskLevel(value: string): RiskLevel {
  const upper = value.toUpperCase();
  return (RISK_LEVELS as readonly string[]).includes(upper) ? (upper as RiskLevel) : "YELLOW";
}
