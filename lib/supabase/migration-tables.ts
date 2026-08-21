/**
 * Which tables each migration creates, read from the migration itself.
 *
 * The hosted schema audit used to carry a hand-written list of four migrations.
 * It kept reporting "0 outstanding" while the repository grew past a hundred
 * migrations, so the reassuring line was true only of the four it still knew
 * about. A list maintained by hand next to a directory that grows on every
 * change is a claim that decays silently; deriving it removes the drift.
 */

export interface MigrationTables {
  readonly migration: string;
  readonly tables: readonly string[];
  /**
   * Functions the migration defines that a `service_role` caller could see,
   * in definition order. See {@link migrationTables} for what is left out.
   */
  readonly functions: readonly string[];
}

/**
 * Statements are matched on `create table`, optionally `if not exists`, and an
 * optional schema qualifier. Only `public` tables are returned: PostgREST can
 * probe nothing else, so reporting a `supabase_migrations` or `storage` table
 * here would produce a permanent false "not visible".
 */
const CREATE_TABLE = /create\s+table\s+(?:if\s+not\s+exists\s+)?("?)([a-z_][a-z0-9_]*)\1(?:\s*\.\s*("?)([a-z_][a-z0-9_]*)\3)?/gi;

export function tablesCreatedIn(sql: string): readonly string[] {
  const found: string[] = [];
  for (const match of stripComments(sql).matchAll(CREATE_TABLE)) {
    const [, , first, , second] = match;
    const schema = second ? first : "public";
    const table = second ?? first;
    if (schema.toLowerCase() !== "public") continue;
    if (!found.includes(table)) found.push(table);
  }
  return found;
}

/**
 * Functions a migration defines. Only `public`, for the same reason as tables:
 * PostgREST exposes that schema and nothing else, so a `pg_temp` or internal
 * helper would be reported permanently missing.
 *
 * Trigger functions are included even though no caller can reach them over
 * REST -- deciding here which ones "should" be callable would be a second
 * opinion about the schema, and the probe's own answer is the one that counts.
 */
const CREATE_FUNCTION = /create\s+(?:or\s+replace\s+)?function\s+("?)([a-z_][a-z0-9_]*)\1(?:\s*\.\s*("?)([a-z_][a-z0-9_]*)\3)?([\s\S]{0,4000}?)\blanguage\b/gi;

/**
 * A trigger function is never listed, because PostgREST cannot list it.
 *
 * The description only names routines a client could call, and a function
 * returning `trigger` is not one. Including them turned thirty fully-applied
 * migrations into `PARTLY VISIBLE` on the first run of this probe -- a report
 * whose alarms are mostly false is worse than one that stays quiet, because it
 * teaches its reader to skim past the real ones.
 */
const RETURNS_TRIGGER = /\breturns\s+trigger\b/i;

export function functionsDefinedIn(sql: string): readonly string[] {
  const found: string[] = [];
  for (const match of stripComments(sql).matchAll(CREATE_FUNCTION)) {
    const [, , first, , second, header] = match;
    const schema = second ? first : "public";
    const name = second ?? first;
    if (schema.toLowerCase() !== "public") continue;
    if (RETURNS_TRIGGER.test(header ?? "")) continue;
    if (!found.includes(name)) found.push(name);
  }
  return found;
}

/**
 * A `create table` inside a comment is not a table. Both comment forms appear
 * throughout these migrations, and several of them quote DDL while explaining
 * why it is *not* being run.
 */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/**
 * Functions this key could see, which is not the same as functions that exist.
 *
 * The audit reads PostgREST's description as `service_role`, and that document
 * is filtered by EXECUTE privilege. Most of these functions are granted to
 * `authenticated` only — deliberately, since they re-derive the caller from
 * `auth.uid()` — so their absence from a service-role view is the boundary
 * working, not a missing migration. Probing them reported
 * `find_open_ai_auth_session` and two others as outstanding when nothing was
 * wrong with them.
 *
 * Grants are collected across the whole directory because a later migration
 * routinely grants a function an earlier one defined.
 */
const EXECUTE_GRANT = /grant\s+execute\s+on\s+function\s+("?)([a-z_][a-z0-9_]*)\1(?:\s*\.\s*("?)([a-z_][a-z0-9_]*)\3)?\s*\([^)]*\)\s*to\s+([^;]+);/gi;

function serviceRoleExecutable(files: readonly { readonly sql: string }[]): ReadonlySet<string> {
  const granted = new Set<string>();
  for (const file of files) {
    for (const match of stripComments(file.sql).matchAll(EXECUTE_GRANT)) {
      const [, , first, , second, roles] = match;
      const name = second ?? first;
      if (/\bservice_role\b/i.test(roles)) granted.add(name);
    }
  }
  return granted;
}

/** Pairs each migration with what it creates, preserving the given order. */
export function migrationTables(
  files: readonly { readonly name: string; readonly sql: string }[],
): readonly MigrationTables[] {
  const visible = serviceRoleExecutable(files);
  return files.map((file) => ({
    migration: file.name.replace(/\.sql$/, ""),
    tables: tablesCreatedIn(file.sql),
    functions: functionsDefinedIn(file.sql).filter((name) => visible.has(name)),
  }));
}
