// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  import.meta.dirname,
  "../../supabase/migrations/20260830000900_full_lifecycle_typed_input_identity.sql",
);
const sql = readFileSync(migrationPath, "utf8");

const launchSignature =
  "public.create_graph_from_plan_with_release_identity_as_server(uuid,uuid,uuid,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,integer,uuid,text,text,jsonb)";
const completionSignature =
  "public.complete_graph_run_with_validated_release_as_worker(text,uuid,public.graph_run_state,boolean,bigint,bigint,text,text)";

describe("Full Lifecycle typed-input identity migration", () => {
  it("moves launch admission from exactly the preceding digest to the typed-input digest", () => {
    expect(sql).toContain("02bb1e7b35782fad9f6024c080bd149f7ade4edb9d68326fd3b04ff94ba589ad");
    expect(sql).toContain("0ec1e97b80dc8696872d88162c5271f9ea822e7dea79556c5470730a025d3b49");
    expect(sql).toContain("ac9bde8fc1cdd21e735f02b1fa7d940ab680c2bde8c1ec24d704d42c59045a09");
    expect(sql).toMatch(/occurrence_count <> 1/i);
    expect(sql).toMatch(
      /updated_launch_definition := pg_catalog\.replace\(\s*launch_record\.definition, prior_postdeploy_digest, typed_input_digest/i,
    );
    expect(sql).toMatch(
      /expected_launch_source := pg_catalog\.replace\(\s*launch_record\.prosrc, prior_postdeploy_digest, typed_input_digest/i,
    );
  });

  it("keeps both strong post-deploy identities on validated completion", () => {
    expect(sql).toMatch(/completion_old_guard[\s\S]*?prior_postdeploy_digest/i);
    expect(sql).toMatch(
      /completion_new_guard[\s\S]*?prior_postdeploy_digest[\s\S]*?typed_input_digest/i,
    );
    expect(sql).toMatch(
      /updated_completion_definition := pg_catalog\.replace\(\s*completion_record\.definition, completion_old_guard, completion_new_guard/i,
    );
  });

  it("pins the exact predecessor catalogs before replacing either function", () => {
    expect(sql).toContain(launchSignature);
    expect(sql).toContain(completionSignature);
    expect(sql).toContain("878b6df53f450d723a4ef7da9dd677b2");
    expect(sql).toContain("8c127b52d5961d49cba980e276edf414");
    expect(sql).toMatch(/owner_name <> 'postgres'/i);
    expect(sql).toMatch(/not launch_record\.prosecdef/i);
    expect(sql).toMatch(/not completion_record\.prosecdef/i);
    expect(sql).toMatch(/array\['search_path=pg_catalog'\]::text\[\]/i);
    expect(sql).toMatch(
      /array\['postgres=X\/postgres', 'service_role=X\/postgres'\]::pg_catalog\.aclitem\[\]/i,
    );
  });

  it("proves OID, owner, SECURITY DEFINER, search_path, ACL, and source preservation", () => {
    for (const contract of [
      "after_record.oid is distinct from launch_record.oid",
      "after_record.owner_name is distinct from launch_record.owner_name",
      "after_record.prosecdef is distinct from launch_record.prosecdef",
      "after_record.proconfig is distinct from launch_record.proconfig",
      "after_record.proacl is distinct from launch_record.proacl",
      "after_record.prosrc is distinct from expected_launch_source",
      "after_record.oid is distinct from completion_record.oid",
      "after_record.owner_name is distinct from completion_record.owner_name",
      "after_record.prosecdef is distinct from completion_record.prosecdef",
      "after_record.proconfig is distinct from completion_record.proconfig",
      "after_record.proacl is distinct from completion_record.proacl",
      "after_record.prosrc is distinct from expected_completion_source",
    ]) {
      expect(sql).toContain(contract);
    }
    expect(sql).not.toMatch(/drop\s+function/i);
  });
});
