// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { BREAKER_FAULTS, COOLDOWN_MS, FAULT_THRESHOLDS } from "@/lib/resources/breakers";

/**
 * The circuit-breaker cooldown is stated twice — once in TypeScript for
 * routing, once in SQL for scheduling — because neither language can call the
 * other and the scheduler runs entirely inside one atomic claim.
 *
 * Two copies of a rule is a defect waiting for someone to change one of them.
 * This test makes that impossible to do quietly: it reads the SQL back out of
 * the migration and compares it to the exported constants. If either side
 * moves, this fails and names the fault class that disagrees.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migration = resolve(
  repositoryRoot,
  "supabase/migrations/20260815000500_phase2e_breaker_aware_scheduling.sql",
);

async function sqlCooldownSeconds(): Promise<Record<string, number>> {
  const source = await readFile(migration, "utf8");
  const body = source.slice(
    source.indexOf("create or replace function public.breaker_cooldown_seconds"),
  );
  const caseBlock = body.slice(body.indexOf("select case p_fault"), body.indexOf("end;"));

  const cooldowns: Record<string, number> = {};
  for (const [, fault, seconds] of caseBlock.matchAll(/when '(\w+)' then (\d+)/g)) {
    cooldowns[fault] = Number(seconds);
  }
  return cooldowns;
}

describe("breaker cooldown parity between TypeScript and SQL", () => {
  it("states the same cooldown for every fault class", async () => {
    const sql = await sqlCooldownSeconds();

    // Not just "the ones SQL happens to mention": every fault the TypeScript
    // knows about must be spelled out in SQL, or a fault class could quietly
    // fall through to the default.
    expect(Object.keys(sql).sort()).toEqual([...BREAKER_FAULTS].sort());

    for (const fault of BREAKER_FAULTS) {
      expect(sql[fault] * 1000, `cooldown for ${fault}`).toBe(COOLDOWN_MS[fault]);
    }
  });

  it("keeps a rate limit the shortest cooldown and invalid output the longest", async () => {
    const sql = await sqlCooldownSeconds();

    // The ordering carries the reasoning: a provider asking for less traffic
    // recovers quickly, while output that will not parse suggests something
    // about the model that waiting a minute does not fix. A change that
    // preserved parity but inverted the ordering would pass the test above.
    expect(Math.min(...Object.values(sql))).toBe(sql.rate_limit);
    expect(sql.malformed_output).toBeGreaterThan(sql.outage);
    expect(sql.validation_failure).toBeGreaterThan(sql.outage);
  });

  it("opens a rate limit sooner than a symptom that was inferred", () => {
    // Same reasoning from the other side: the provider telling us plainly to
    // back off needs less corroboration than a symptom we deduced.
    expect(FAULT_THRESHOLDS.rate_limit).toBeLessThan(FAULT_THRESHOLDS.outage);
    expect(FAULT_THRESHOLDS.excessive_latency).toBeGreaterThan(FAULT_THRESHOLDS.outage);
  });
});
