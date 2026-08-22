// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  isMissingDatabaseColumn,
  isMissingDatabaseFunction,
} from "@/lib/bots/schema-compat";

describe("bot schema compatibility feature detection", () => {
  it("recognizes only explicit missing-RPC failures", () => {
    expect(isMissingDatabaseFunction(
      { code: "PGRST202", message: "RPC absent from the schema cache" },
      "assign_bots_to_project_checked",
    )).toBe(true);
    expect(isMissingDatabaseFunction(
      { code: "42883", message: "function assign_bots_to_project_checked(uuid) does not exist" },
      "assign_bots_to_project_checked",
    )).toBe(true);
    expect(isMissingDatabaseFunction(
      { code: "42883", message: "function unrelated_dependency(uuid) does not exist" },
      "assign_bots_to_project_checked",
    )).toBe(false);
    expect(isMissingDatabaseFunction(
      { code: "42501", message: "permission denied" },
      "assign_bots_to_project_checked",
    )).toBe(false);
  });

  it("recognizes only the exact missing column", () => {
    expect(isMissingDatabaseColumn(
      { code: "PGRST204", message: "Could not find the 'revision' column" },
      "revision",
    )).toBe(true);
    expect(isMissingDatabaseColumn(
      { code: "42703", message: "column bots.ai_account_id does not exist" },
      "ai_account_id",
    )).toBe(true);
    expect(isMissingDatabaseColumn(
      { code: "42703", message: "column bots.provider does not exist" },
      "revision",
    )).toBe(false);
    expect(isMissingDatabaseColumn(
      { code: "42501", message: "permission denied for bots" },
      "revision",
    )).toBe(false);
  });
});
