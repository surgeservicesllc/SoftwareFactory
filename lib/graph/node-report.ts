import { z } from "zod";

/**
 * The general report a model node records.
 *
 * Every full_lifecycle MODEL node answers its prompt contract with this
 * shape — a blocked flag, a summary in the node's own words, findings as
 * title/detail pairs, a stated confidence, and recommendations for the next
 * stage. It is the recorded substance behind most stage artifacts, and until
 * this module the console could only show it as raw JSON.
 *
 * This is a *reading* of stored payloads, not the write-side contract: the
 * worker's prompt owns what a node must produce. So the schema is lenient —
 * `passthrough`, defaults on the optional arrays — because a stored payload
 * that carries more than the reader knows must still render, and one that
 * carries less must fall back to verbatim JSON rather than blank the page.
 */

export const nodeReportSchema = z.object({
  blocked: z.boolean(),
  summary: z.string().min(1),
  findings: z.array(
    z.object({
      title: z.string().min(1),
      detail: z.string().default(""),
    }).passthrough(),
  ).default([]),
  confidence: z.string().nullish(),
  blocked_reason: z.string().nullish(),
  recommendations: z.array(z.string()).default([]),
}).passthrough();

export type NodeReport = z.infer<typeof nodeReportSchema>;

/** The report a payload holds, or null when it is not one. */
export function parseNodeReport(payload: unknown): NodeReport | null {
  const parsed = nodeReportSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
