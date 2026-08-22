// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(
  import.meta.dirname,
  "../../.github/workflows/audit-bot-catalog.yml",
);
const source = readFileSync(workflowPath, "utf8");

interface WorkflowStep {
  readonly name: string;
  readonly run?: string;
}

interface AuditWorkflow {
  readonly on: {
    readonly workflow_dispatch: {
      readonly inputs: {
        readonly confirm: { readonly required: boolean };
        readonly project_ref: {
          readonly required: boolean;
          readonly default: string;
        };
      };
    };
  };
  readonly permissions: Readonly<Record<string, string>>;
  readonly jobs: {
    readonly audit: {
      readonly if: string;
      readonly env: Readonly<Record<string, string>>;
      readonly steps: readonly WorkflowStep[];
    };
  };
}

const workflow = parse(source) as AuditWorkflow;
const auditJob = workflow.jobs.audit;
const commands = auditJob.steps.map((step) => step.run ?? "").join("\n");

describe("the production bot catalog audit workflow", () => {
  it("is manually and exactly bound to the approved production project", () => {
    expect(workflow.on.workflow_dispatch.inputs.confirm.required).toBe(true);
    expect(workflow.on.workflow_dispatch.inputs.project_ref).toEqual({
      description: "Exact Supabase project reference being audited",
      required: true,
      default: "qpuofpmagrmyamahqwxw",
    });
    expect(auditJob.if).toContain("inputs.confirm == 'audit'");
    expect(auditJob.if).toContain("github.ref == 'refs/heads/main'");
    expect(auditJob.if).toContain(
      "inputs.project_ref == 'qpuofpmagrmyamahqwxw'",
    );
    expect(auditJob.env.PROJECT_REF).toBe("qpuofpmagrmyamahqwxw");
  });

  it("has read-only repository permission and database sessions", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(auditJob.env.PGOPTIONS).toContain(
      "default_transaction_read_only=on",
    );
    expect(Object.keys(auditJob.env).sort()).toEqual([
      "PGOPTIONS",
      "PROJECT_REF",
      "SUPABASE_DB_PASSWORD",
    ]);
  });

  it("contains no database, ledger, schema-cache, or migration mutation", () => {
    expect(commands).not.toMatch(
      /\b(?:insert|update|delete|truncate|create|alter|drop|grant|revoke|comment|notify|vacuum|reindex|cluster|refresh)\s+/i,
    );
    expect(commands).not.toMatch(/\bmerge\s+into\b/i);
    expect(commands).not.toMatch(/(?:\\copy|\bcopy)\s+/i);
    expect(commands).not.toMatch(/\bcall\s+/i);
    expect(commands).not.toMatch(/\bdo\s+\$(?:\$|[A-Za-z_])/i);
    expect(commands).not.toMatch(/\bread\s+write\b/i);
    expect(commands).not.toMatch(
      /\b(?:set|reset)\s+(?:session\s+|local\s+)?default_transaction_read_only\b/i,
    );
    expect(commands).not.toMatch(
      /\b(?:migration\s+repair|db\s+push|migration\s+up)\b/i,
    );
    expect(commands).not.toContain("-f \"");
    expect(commands).not.toContain("supabase_migrations.schema_migrations (version)");
  });

  it("proves the live session is read-only and emits no raw routine settings", () => {
    expect(commands).toContain(
      "current_setting('transaction_read_only') = 'on'",
    );
    expect(commands).toContain("current_user = 'postgres'");
    expect(commands).toContain("-X -Atqc");
    expect(commands).toContain(
      "proconfig = array['search_path=pg_catalog']::text[] as search_path_exact",
    );
    expect(commands).toContain("cardinality(proconfig)");
    expect(commands).not.toMatch(/\bproconfig\s+as\b/i);
  });

  it("reports the PostgreSQL server and all four release-ledger versions", () => {
    expect(commands).toContain(
      "current_setting('server_version') as server_version",
    );
    expect(commands).toContain(
      "current_setting('server_version_num') as server_version_num",
    );
    for (const version of [
      "20260822000100",
      "20260822000150",
      "20260822000200",
      "20260822000300",
    ]) {
      expect(commands).toContain(version);
    }
  });

  it("reports every frozen legacy source fingerprint and the overload set safely", () => {
    for (const [signature, sourceHash] of [
      [
        "public.register_bot(uuid,text,public.bot_provider,text,text,text,text)",
        "797dcd842e22e5f0ae6b8299f744b0b4",
      ],
      [
        "public.assign_bot(uuid,uuid,uuid,uuid)",
        "80b547b7b722c57a9d2a262b67698be8",
      ],
      [
        "public.assign_bots_to_project(uuid,uuid,jsonb)",
        "23b260247a4be4f4a8d8aa2497e1b6a2",
      ],
      [
        "public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)",
        "daecfeb964d863373a2072cc62e1033e",
      ],
      [
        "public.set_bot_assignment_execution(uuid,uuid,text,text)",
        "55ec15132d903ace0300f2cbe32db6bd",
      ],
      [
        "public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)",
        "0aaec47295f86adbeec784d288f24400",
      ],
      [
        "public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)",
        "7f51999309b645832d471ccebea94a9c",
      ],
    ]) {
      expect(commands).toContain(signature);
      expect(commands).toContain(sourceHash);
    }
    expect(commands).toContain(
      "md5(replace(replace(routine.prosrc, E'\\r\\n', E'\\n'), E'\\r', E'\\n')) as actual_source_md5",
    );
    expect(commands).not.toMatch(/md5\(routine\.prosrc\)/);
    expect(commands).toContain("actual_source_md5 = expected_source_md5");
    expect(commands).not.toContain("pg_get_functiondef");
    expect(commands).toContain("acl_posture");
    expect(commands).toContain("proacl is null as acl_is_null");
    expect(commands).toContain("when acl.grantee = 0 then 'PUBLIC'");
    expect(commands).toContain("service_role_execute");
    expect(commands).toContain("routine.oid::regprocedure::text as live_signature");
  });
});
