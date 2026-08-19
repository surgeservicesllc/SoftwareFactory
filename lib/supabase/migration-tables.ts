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
 * A `create table` inside a comment is not a table. Both comment forms appear
 * throughout these migrations, and several of them quote DDL while explaining
 * why it is *not* being run.
 */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** Pairs each migration with what it creates, preserving the given order. */
export function migrationTables(
  files: readonly { readonly name: string; readonly sql: string }[],
): readonly MigrationTables[] {
  return files.map((file) => ({
    migration: file.name.replace(/\.sql$/, ""),
    tables: tablesCreatedIn(file.sql),
  }));
}
