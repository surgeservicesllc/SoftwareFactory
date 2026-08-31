import type { PGlite } from "@electric-sql/pglite";

/**
 * A PGlite-backed stand-in for the slice of the supabase-js query builder
 * the CRM seeder and validator use.
 *
 * The point is fidelity of the code path under test: the production
 * seeder and the production report run unmodified against real PostgreSQL
 * with the real migration chain — real constraints, real triggers, real
 * RLS — instead of against a mock that would agree with whatever the
 * seeder did. If the seeder writes a row the schema refuses, this shim
 * surfaces the database's own error, exactly as Supabase would.
 *
 * It implements only what those two modules call, and throws loudly on
 * anything else rather than quietly returning empty — a silent shim would
 * turn a real gap into a false pass.
 */

type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };

function quoteIdentifier(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return `"${name}"`;
}

function selectList(columns: string): string {
  const trimmed = columns.trim();
  if (trimmed === "*") return "*";
  return trimmed
    .split(",")
    .map((column) => quoteIdentifier(column.trim()))
    .join(", ");
}

class Builder implements PromiseLike<Result> {
  private mode: "select" | "insert" | "update" = "select";
  private columns = "*";
  private rows: Record<string, unknown>[] = [];
  private patch: Record<string, unknown> = {};
  private filters: { column: string; op: "eq" | "in" | "gte" | "lte"; value: unknown }[] = [];
  private limitValue: number | null = null;
  private orderBy: { column: string; ascending: boolean }[] = [];
  private headOnly = false;
  private wantCount = false;
  private singleMode: "single" | "maybeSingle" | null = null;

  constructor(private readonly db: PGlite, private readonly table: string) {}

  select(columns = "*", options?: { count?: "exact"; head?: boolean }) {
    this.columns = columns;
    if (options?.count === "exact") this.wantCount = true;
    if (options?.head) this.headOnly = true;
    return this;
  }

  insert(rows: Record<string, unknown> | Record<string, unknown>[]) {
    this.mode = "insert";
    this.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(patch: Record<string, unknown>) {
    this.mode = "update";
    this.patch = patch;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, op: "eq", value });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push({ column, op: "in", value: values });
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push({ column, op: "gte", value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push({ column, op: "lte", value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  single() {
    this.singleMode = "single";
    return this;
  }

  maybeSingle() {
    this.singleMode = "maybeSingle";
    return this;
  }

  private whereClause(params: unknown[]): string {
    if (this.filters.length === 0) return "";
    const parts = this.filters.map((filter) => {
      if (filter.op === "in") {
        const values = filter.value as unknown[];
        if (values.length === 0) return "false";
        const placeholders = values.map((value) => {
          params.push(value);
          return `$${params.length}`;
        });
        return `${quoteIdentifier(filter.column)} in (${placeholders.join(", ")})`;
      }
      params.push(filter.value);
      const operator = filter.op === "eq" ? "=" : filter.op === "gte" ? ">=" : "<=";
      return `${quoteIdentifier(filter.column)} ${operator} $${params.length}`;
    });
    return ` where ${parts.join(" and ")}`;
  }

  private async run(): Promise<Result> {
    const table = quoteIdentifier(this.table);
    try {
      if (this.mode === "insert") {
        if (this.rows.length === 0) return { data: [], error: null };
        // One multi-row INSERT, columns unioned across the batch so a row
        // that omits an optional column still lands as NULL.
        const columns = [...new Set(this.rows.flatMap((row) => Object.keys(row)))];
        const params: unknown[] = [];
        const tuples = this.rows.map((row) => {
          const placeholders = columns.map((column) => {
            params.push(row[column] === undefined ? null : row[column]);
            return `$${params.length}`;
          });
          return `(${placeholders.join(", ")})`;
        });
        const returning = this.columns === "*" ? "*" : selectList(this.columns);
        const sql =
          `insert into public.${table} (${columns.map(quoteIdentifier).join(", ")}) `
          + `values ${tuples.join(", ")} returning ${returning}`;
        const result = await this.db.query(sql, params);
        const data = result.rows as Record<string, unknown>[];
        if (this.singleMode) {
          return { data: data[0] ?? null, error: null };
        }
        return { data, error: null };
      }

      if (this.mode === "update") {
        const params: unknown[] = [];
        const assignments = Object.entries(this.patch).map(([column, value]) => {
          params.push(value === undefined ? null : value);
          return `${quoteIdentifier(column)} = $${params.length}`;
        });
        const where = this.whereClause(params);
        const returning = this.columns === "*" ? "" : ` returning ${selectList(this.columns)}`;
        const sql = `update public.${table} set ${assignments.join(", ")}${where}${returning}`;
        const result = await this.db.query(sql, params);
        const data = (result.rows ?? []) as Record<string, unknown>[];
        if (this.singleMode) return { data: data[0] ?? null, error: null };
        return { data, error: null };
      }

      const params: unknown[] = [];
      const where = this.whereClause(params);
      if (this.headOnly && this.wantCount) {
        const sql = `select count(*)::integer as count from public.${table}${where}`;
        const result = await this.db.query<{ count: number }>(sql, params);
        return { data: null, error: null, count: result.rows[0]?.count ?? 0 };
      }
      const order =
        this.orderBy.length === 0
          ? ""
          : ` order by ${this.orderBy
              .map((entry) => `${quoteIdentifier(entry.column)} ${entry.ascending ? "asc" : "desc"}`)
              .join(", ")}`;
      const limit = this.limitValue === null ? "" : ` limit ${Math.floor(this.limitValue)}`;
      const sql = `select ${selectList(this.columns)} from public.${table}${where}${order}${limit}`;
      const result = await this.db.query(sql, params);
      const data = result.rows as Record<string, unknown>[];
      if (this.singleMode === "single") {
        if (data.length !== 1) {
          return { data: null, error: { message: "Expected exactly one row", code: "PGRST116" } };
        }
        return { data: data[0], error: null };
      }
      if (this.singleMode === "maybeSingle") return { data: data[0] ?? null, error: null };
      return { data, error: null, count: this.wantCount ? data.length : null };
    } catch (error) {
      // Postgres errors come back shaped as Supabase reports them, so the
      // code under test takes the same branches it would in production.
      const message = error instanceof Error ? error.message : String(error);
      const code =
        /duplicate key/i.test(message) ? "23505"
        : /violates foreign key/i.test(message) ? "23503"
        : /violates check constraint|check_violation/i.test(message) ? "23514"
        : /row-level security/i.test(message) ? "42501"
        : undefined;
      return { data: null, error: { message, code } };
    }
  }

  then<TResult1 = Result, TResult2 = never>(
    onFulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onFulfilled, onRejected);
  }
}

/** A client object shaped like the one the routes receive. */
export function pgliteSupabaseClient(db: PGlite) {
  return {
    from(table: string) {
      return new Builder(db, table);
    },
  };
}
