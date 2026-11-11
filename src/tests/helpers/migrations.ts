/**
 * Reads the database definition (supabase/migrations/*.sql) for the structural guard tests:
 * which collections have a table, their per-table rules (lf_rules rows) and indexes.
 */
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');

export function migrationsSql(): string {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n');
}

function quotedNames(list: string): string[] {
  return Array.from(list.matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'/g), m => m[1]);
}

/** Every document table (one per collection), from the all_tables list in the init migration. */
export function documentTables(sql = migrationsSql()): string[] {
  const m = sql.match(/all_tables text\[\] := array\[([\s\S]*?)\];/);
  if (!m) throw new Error('all_tables list not found in supabase/migrations');
  // plus document tables created by later migrations (same shape: id + data jsonb)
  const later = Array.from(sql.matchAll(/create table public\."?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(\s*id text primary key[\s\S]*?data jsonb/g), x => x[1]);
  return [...quotedNames(m[1]), ...later];
}

/** Tables that have an lf_rules row (the guard trigger refuses browser writes on any other table). */
export function tablesWithRules(sql = migrationsSql()): string[] {
  const names = new Set<string>();
  for (const block of sql.matchAll(/insert into public\.lf_rules[^;]*;/g)) {
    for (const row of block[0].matchAll(/\(\s*'([A-Za-z_][A-Za-z0-9_]*)'/g)) names.add(row[1]);
    const unnest = block[0].match(/unnest\(array\[([\s\S]*?)\]\)/);
    if (unnest) quotedNames(unnest[1]).forEach(n => names.add(n));
  }
  return Array.from(names);
}

/**
 * A table's allowed keys and immutable keys: the first and second '{...}' arrays of its lf_rules
 * row, plus later migrations' `allowed_keys = allowed_keys || array[...]` (same for immutable_keys).
 */
export function ruleArrays(table: string, sql = migrationsSql()): { allowed: string[]; immutable: string[]; hasExplicitAllowlist: boolean } {
  const row = sql.match(new RegExp(`\\(\\s*'${table}'\\s*,\\s*'\\{([^}]*)\\}'(?:\\s*,\\s*'\\{([^}]*)\\}')?`));
  const split = (s?: string) => (s ? s.split(',').map(k => k.trim()).filter(Boolean) : []);
  const allowed = row ? split(row[1]) : [];
  const immutable = row ? split(row[2]) : [];
  let hasExplicitAllowlist = Boolean(row);
  for (const update of sql.matchAll(/update public\.lf_rules\s+set([\s\S]*?)where table_name\s*=\s*'([A-Za-z_][A-Za-z0-9_]*)'/g)) {
    if (update[2] !== table) continue;
    if (/allowed_keys\s*=\s*'\{\}'/.test(update[1])) {
      hasExplicitAllowlist = true;
    }
    const added = (column: string) => {
      const m = update[1].match(new RegExp(`${column}\\s*=\\s*(?:coalesce\\(\\s*${column}\\s*,\\s*'\\{\\}'\\s*\\)|${column})\\s*\\|\\|\\s*array\\[([\\s\\S]*?)\\]`));
      return m ? quotedNames(m[1]) : [];
    };
    const nextAllowed = added('allowed_keys');
    if (nextAllowed.length > 0) hasExplicitAllowlist = true;
    allowed.push(...nextAllowed);
    immutable.push(...added('immutable_keys'));
  }
  return { allowed, immutable, hasExplicitAllowlist };
}

/** True when an index covers (workspace_id, (data->>'field')) on the table. */
export function hasWorkspaceFieldIndex(table: string, field: string, sql = migrationsSql()): boolean {
  const quoted = table === table.toLowerCase() ? `(?:"${table}"|${table})` : `"${table}"`;
  // (workspace_id, (data->>'date')) or, since C-20, (workspace_id, (data->>'date') desc, id)
  const re = new RegExp(`create index[^;]*on public\\.${quoted}\\s*\\(\\s*workspace_id\\s*,\\s*\\(data->>'${field}'\\)(?:\\s+desc)?(?:\\s*,\\s*id)?\\s*\\)`, 'i');
  return re.test(sql);
}
