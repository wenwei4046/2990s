#!/usr/bin/env node
/**
 * check-migrations-applied.mjs
 *
 * WHY THIS EXISTS
 * ---------------
 * `packages/db/migrations/meta/_journal.json` records exactly ONE of the 231
 * migration files, so Drizzle cannot tell you what has been applied. On top of
 * that, 25 numbers are used by more than one file (0110 and 0111 three times),
 * because parallel branches each grabbed "the next number" and both merged. So
 * a filename tells you neither the order nor whether it ran.
 *
 * The only reliable check is to ask the database whether the objects a
 * migration creates actually exist. This script does not touch the database —
 * it reads the .sql files, extracts the objects each one creates, and prints a
 * single read-only SQL query you paste into the Supabase SQL Editor.
 *
 * USAGE
 *   node scripts/check-migrations-applied.mjs            # duplicates only (default)
 *   node scripts/check-migrations-applied.mjs --all      # every migration
 *   node scripts/check-migrations-applied.mjs 0185 0186  # specific numbers
 *
 * The generated SQL is SELECT-only and safe to run against production.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.join(HERE, '..', 'packages', 'db', 'migrations');

const files = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql'));
const numOf = (f) => f.split('_')[0];

// ── choose which files to inspect ────────────────────────────────────────────
const args = process.argv.slice(2);
const wantAll = args.includes('--all');
const explicit = args.filter((a) => /^\d{4}$/.test(a));

let targets;
if (wantAll) {
  targets = files;
} else if (explicit.length) {
  targets = files.filter((f) => explicit.includes(numOf(f)));
} else {
  const counts = new Map();
  for (const f of files) counts.set(numOf(f), (counts.get(numOf(f)) ?? 0) + 1);
  targets = files.filter((f) => counts.get(numOf(f)) > 1);
}
targets.sort();

// ── extract the objects each migration creates ───────────────────────────────
// Deliberately conservative: only patterns whose existence is unambiguous in
// information_schema / pg_catalog. A migration that only INSERTs seed rows or
// only alters a constraint will yield no probes — reported as "not checkable".
const RX = {
  createTable:  /create\s+table\s+(?:if\s+not\s+exists\s+)?"?(?:public\.)?"?([a-z0-9_]+)"?/gi,
  addColumn:    /alter\s+table\s+(?:only\s+)?"?(?:public\.)?"?([a-z0-9_]+)"?[\s\S]{0,80}?add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi,
  createView:   /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?"?(?:public\.)?"?([a-z0-9_]+)"?/gi,
  createFn:     /create\s+(?:or\s+replace\s+)?function\s+"?(?:public\.)?"?([a-z0-9_]+)"?/gi,
  createType:   /create\s+type\s+"?(?:public\.)?"?([a-z0-9_]+)"?/gi,
};

const probes = [];
const notCheckable = [];

for (const file of targets) {
  const sql = fs.readFileSync(path.join(MIG_DIR, file), 'utf8');
  // strip line comments so commented-out DDL isn't mistaken for real DDL
  const body = sql.replace(/^\s*--.*$/gm, '');
  const found = [];

  for (const [, m] of [...body.matchAll(RX.createTable)].entries()) found.push({ kind: 'table', a: m[1] });
  for (const m of body.matchAll(RX.addColumn))  found.push({ kind: 'column', a: m[1], b: m[2] });
  for (const m of body.matchAll(RX.createView)) found.push({ kind: 'view',   a: m[1] });
  for (const m of body.matchAll(RX.createFn))   found.push({ kind: 'function', a: m[1] });
  for (const m of body.matchAll(RX.createType)) found.push({ kind: 'type',   a: m[1] });

  const seen = new Set();
  const uniq = found.filter((f) => {
    const k = `${f.kind}:${f.a}:${f.b ?? ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (!uniq.length) { notCheckable.push(file); continue; }
  // one representative probe per migration keeps the output readable
  probes.push({ file, objects: uniq.slice(0, 4) });
}

// ── emit the SQL ─────────────────────────────────────────────────────────────
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const clauses = [];

for (const { file, objects } of probes) {
  for (const o of objects) {
    let exists;
    if (o.kind === 'table') {
      exists = `exists (select 1 from information_schema.tables where table_schema='public' and table_name=${q(o.a)})`;
    } else if (o.kind === 'column') {
      exists = `exists (select 1 from information_schema.columns where table_schema='public' and table_name=${q(o.a)} and column_name=${q(o.b)})`;
    } else if (o.kind === 'view') {
      exists = `exists (select 1 from information_schema.views where table_schema='public' and table_name=${q(o.a)})`;
    } else if (o.kind === 'function') {
      exists = `exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=${q(o.a)})`;
    } else {
      exists = `exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typname=${q(o.a)})`;
    }
    const label = o.kind === 'column' ? `${o.a}.${o.b}` : o.a;
    clauses.push(`  select ${q(file)} as migration, ${q(o.kind)} as kind, ${q(label)} as object, ${exists} as present`);
  }
}

console.log(`-- Migration reality check — generated ${new Date().toISOString().slice(0, 10)}`);
console.log(`-- ${probes.length} migration(s) probed, ${clauses.length} object(s).`);
console.log('-- READ-ONLY. Safe to run against production.');
console.log('-- Paste into the Supabase SQL Editor. "present = false" means that');
console.log('-- migration did NOT run (or ran differently than the file says).');
console.log('');
console.log('select migration, kind, object, present from (');
console.log(clauses.join('\n  union all\n'));
console.log(') t order by present asc, migration asc;');

if (notCheckable.length) {
  console.log('');
  console.log('-- NOT AUTO-CHECKABLE (no CREATE/ADD COLUMN found — data-only, constraint-only,');
  console.log('-- policy-only, or index-only migrations). Inspect these by hand:');
  for (const f of notCheckable) console.log(`--   ${f}`);
}
