import { z } from "zod";

export const RELEASE_POLICY_PATH = ".softwarefactory/release-policy.json";

const checkNameSchema = z.string()
  .min(1)
  .max(160)
  .refine((value) => value === value.trim(), "Check names must be trimmed.")
  .refine((value) => !value.includes("|"), "Check names cannot contain |.");

export const repositoryReleasePolicySchema = z.object({
  version: z.literal(1),
  requiredChecks: z.array(checkNameSchema).min(1).max(20),
}).strict().superRefine((value, context) => {
  if (new Set(value.requiredChecks).size !== value.requiredChecks.length) {
    context.addIssue({
      code: "custom",
      message: "Required check names must be unique.",
      path: ["requiredChecks"],
    });
  }
});

export function parseRepositoryReleasePolicy(input: string) {
  if (!input || Buffer.byteLength(input, "utf8") > 16 * 1024) return null;
  try {
    const parsed = repositoryReleasePolicySchema.safeParse(JSON.parse(input) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function parseRequiredCheckNames(input: string | null | undefined): readonly string[] | null {
  if (!input) return null;
  const parsed = repositoryReleasePolicySchema.safeParse({
    version: 1,
    requiredChecks: input.split("|").map((value) => value.trim()).filter(Boolean),
  });
  return parsed.success ? Object.freeze(parsed.data.requiredChecks) : null;
}
