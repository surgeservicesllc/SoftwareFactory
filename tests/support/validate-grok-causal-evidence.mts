import { readFileSync } from "node:fs";

import {
  grokCausalFinishEvidenceSchema,
  grokCausalStartEvidenceSchema,
} from "./grok-causal-production";

const [phase, path] = process.argv.slice(2);
if ((phase !== "start" && phase !== "finish") || !path) {
  throw new Error("Usage: validate-grok-causal-evidence.mts <start|finish> <path>");
}

const value: unknown = JSON.parse(readFileSync(path, "utf8"));
if (phase === "start") grokCausalStartEvidenceSchema.parse(value);
else grokCausalFinishEvidenceSchema.parse(value);

process.stdout.write(`${phase}-evidence-valid\n`);
