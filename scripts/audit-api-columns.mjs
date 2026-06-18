#!/usr/bin/env node
// ----------------------------------------------------------------------------
// audit-api-columns.mjs — phantom-column audit for the API layer.
//
// Scans every apps/api/src/routes/*.ts for the (table, column) pairs the code
// READS (.select) and WRITES (.insert/.update/.upsert), expands `*_COLS` string
// constants, then emits ONE SQL query that LEFT JOINs those pairs against the
// live prod information_schema and returns the ones that DON'T exist — i.e. the
// columns the code references but prod is missing (→ that API 500s).
//
// Usage:  node scripts/audit-api-columns.mjs            → prints the check SQL
//         node scripts/audit-api-columns.mjs --list     → prints table→columns
//
// Heuristic by design: over-extraction just becomes a review row (a non-table
// token is filtered out by the `tables` join; a real table + bogus column is
// surfaced for a human to dismiss). Under-extraction is bounded because the
// .select() string literals (the main 500 risk) parse cleanly.
// ----------------------------------------------------------------------------
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTES = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'api', 'src', 'routes');
const files = readdirSync(ROUTES).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

// table -> Set<column>, with a sample source location for triage.
const refs = new Map(); // `${table}` -> Set(col)
const where = new Map(); // `${table}|${col}` -> "file:approxLine"
const add = (table, col, file) => {
  if (!table || !col) return;
  col = col.trim();
  // drop obvious non-columns
  if (!/^[a-z_][a-z0-9_]*$/.test(col)) return;
  if (col === 'count') return;
  if (!refs.has(table)) refs.set(table, new Set());
  refs.get(table).add(col);
  const k = `${table}|${col}`;
  if (!where.has(k)) where.set(k, file);
};

// Parse a comma-separated select() column list. Skips embeds `rel:table(...)`,
// resolves `alias:realcol` to realcol, drops `*`.
function parseSelectCols(str) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur) out.push(cur);
  const cols = [];
  for (let tok of out) {
    tok = tok.trim();
    if (!tok || tok === '*') continue;
    if (tok.includes('(')) continue;            // embed: rel:table(...) — skip
    if (tok.includes(':')) tok = tok.split(':').pop().trim(); // alias:col -> col
    cols.push(tok);
  }
  return cols;
}

for (const file of files) {
  const src = readFileSync(join(ROUTES, file), 'utf8');

  // 1) Resolve *_COLS-style string constants (single or concatenated literals).
  const constStr = new Map();
  const constRe = /const\s+([A-Z][A-Z0-9_]*)\s*=\s*((?:'[^']*'|`[^`]*`)(?:\s*\+\s*(?:'[^']*'|`[^`]*`))*)/g;
  let cm;
  while ((cm = constRe.exec(src))) {
    const val = cm[2].split('+').map((p) => p.trim().replace(/^['`]|['`]$/g, '')).join('');
    constStr.set(cm[1], val);
  }

  // 2) STRICT chain: the select/insert/update/upsert must be DIRECTLY chained to
  //    .from('table') (only whitespace between) — this is how supabase-js reads,
  //    and it kills the cross-statement mis-attribution a loose window caused.
  const chainRe = /\.from\(\s*['"]([a-z_][a-z0-9_]*)['"]\s*\)\s*\.(select|insert|update|upsert)\(/g;
  let m;
  while ((m = chainRe.exec(src))) {
    const table = m[1], op = m[2];
    const argStart = m.index + m[0].length; // just after the '(' of the op
    const rest = src.slice(argStart, argStart + 6000);
    if (op === 'select') {
      const lit = rest.match(/^\s*([`'"])([\s\S]*?)\1/);          // string-literal select
      if (lit) {
        const arg = lit[2].replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_, n) => (constStr.get(n) ?? ''));
        for (const c of parseSelectCols(arg)) add(table, c, file);
      } else {
        const bare = rest.match(/^\s*([A-Z][A-Z0-9_]*)\s*[),]/);  // .select(COLS_CONST)
        if (bare && constStr.has(bare[1])) for (const c of parseSelectCols(constStr.get(bare[1]))) add(table, c, file);
      }
    } else {
      // insert/update/upsert — only when the arg is an inline object literal
      // (a variable arg like .update(updates) can't be parsed → skipped).
      if (!/^\s*\{/.test(rest)) continue;
      const open = argStart + rest.indexOf('{');
      let body = '', d = 0;
      for (let i = open; i < src.length && i < open + 6000; i++) {
        const ch = src[i]; body += ch;
        if (ch === '{') d++; else if (ch === '}') { d--; if (d === 0) break; }
      }
      // top-level (object-depth 1) snake_case keys = columns.
      let depth = 0;
      for (const ln of body.split('\n')) {
        const km = ln.match(/^\s*([a-z_][a-z0-9_]*)\s*:/);
        if (km && depth === 1) add(table, km[1], file);
        for (const ch of ln) { if (ch === '{') depth++; else if (ch === '}') depth--; }
      }
    }
  }
}

if (process.argv.includes('--list')) {
  for (const [t, cols] of [...refs].sort()) {
    console.log(`\n${t} (${cols.size}):`);
    console.log('  ' + [...cols].sort().join(', '));
  }
  console.error(`\n${refs.size} tables, ${[...refs.values()].reduce((s, c) => s + c.size, 0)} (table,column) refs`);
} else {
  const rows = [];
  let pairCount = 0;
  for (const [t, cols] of [...refs].sort()) {
    const cs = [...cols].sort();
    pairCount += cs.length;
    rows.push(`  ('${t}', ARRAY[${cs.map((c) => `'${c}'`).join(',')}])`);
  }
  console.log(`-- Phantom-column audit: code-referenced (table,column) pairs that do NOT exist in prod.
-- Generated by scripts/audit-api-columns.mjs from apps/api/src/routes. ${pairCount} pairs / ${rows.length} tables.
WITH code AS (
  SELECT v.t AS table_name, c AS column_name
  FROM (VALUES
${rows.join(',\n')}
  ) v(t, cols), unnest(v.cols) AS c
)
SELECT c.table_name, c.column_name
FROM code c
JOIN information_schema.tables t
  ON t.table_schema='public' AND t.table_name=c.table_name          -- only real tables
LEFT JOIN information_schema.columns i
  ON i.table_schema='public' AND i.table_name=c.table_name AND i.column_name=c.column_name
WHERE i.column_name IS NULL                                          -- column missing in prod
ORDER BY c.table_name, c.column_name;`);
}
