#!/usr/bin/env node
/**
 * check-audit-labels.mjs
 *
 * WHY THIS EXISTS
 * ---------------
 * The Backend's History drawer renders `FIELD_LABEL[field] ?? field`. That
 * fallback never throws, so when the API starts emitting a new audit field and
 * nobody adds a label, the drawer silently prints the raw camelCase identifier
 * at office staff. It has happened twice — payment fields (fixed 2026-05-28)
 * and 15 more found on 2026-08-06 — because nothing links the writer
 * (@2990s/api) to the reader (@2990s/backend).
 *
 * This script is that link. It reads both sides as text and reports any field
 * the API emits that the panel cannot translate.
 *
 * It is a script rather than a vitest case on purpose: reading source files
 * needs `node:fs`, and neither package's tsconfig exposes Node types —
 * @2990s/backend is a browser app, and @2990s/api deliberately restricts
 * itself to @cloudflare/workers-types. Adding Node globals to either would let
 * someone write `process.env` / `fs` in code that has neither at runtime.
 * Same reasoning as scripts/check-migrations-applied.mjs.
 *
 * USAGE
 *   node scripts/check-audit-labels.mjs      # exit 0 = all labelled, 1 = gaps
 *
 * Wire into CI (or a pre-push hook) to turn the silence into a red build.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every API file that calls recordSoAudit() or writes field_changes directly. */
const WRITERS = [
  'apps/api/src/routes/mfg-sales-orders.ts',
  'apps/api/src/routes/so-amendments.ts',
  'apps/api/src/routes/consignment-orders.ts',
  'apps/api/src/lib/so-stock-allocation.ts',
  'apps/api/src/lib/so-audit.ts',
];

const LABELS = 'apps/backend/src/pages/sales-order/history-field-labels.ts';

const read = (rel) => {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    // Fail loudly — a renamed file must not let this pass by finding nothing.
    console.error(`✗ file not found: ${rel}`);
    console.error('  Someone moved or renamed it. Update the list in this script.');
    process.exit(2);
  }
  return fs.readFileSync(abs, 'utf8');
};

// ── what the API emits ───────────────────────────────────────────────────────
const emitted = new Map(); // field -> [files]
for (const rel of WRITERS) {
  for (const m of read(rel).matchAll(/field:\s*'([A-Za-z0-9_]+)'/g)) {
    const name = m[1];
    emitted.set(name, [...new Set([...(emitted.get(name) ?? []), rel.replace('apps/api/src/', '')])]);
  }
}

// ── what the panel can translate ─────────────────────────────────────────────
const labelSrc = read(LABELS);
const block = labelSrc.slice(labelSrc.indexOf('FIELD_LABEL'));
const labelled = new Set([...block.matchAll(/([A-Za-z0-9_]+):\s*'/g)].map((m) => m[1]));

// ── report ───────────────────────────────────────────────────────────────────
if (emitted.size < 10) {
  console.error(`✗ only found ${emitted.size} emitted fields — the regex or the file list is wrong.`);
  process.exit(2);
}

const missing = [...emitted.entries()].filter(([name]) => !labelled.has(name));

if (missing.length === 0) {
  console.log(`✓ all ${emitted.size} audit fields have a label in the History drawer.`);
  process.exit(0);
}

console.error(`✗ ${missing.length} audit field(s) would render as raw camelCase in the History drawer:\n`);
for (const [name, files] of missing) console.error(`    ${name}  — emitted by ${files.join(', ')}`);
console.error(`\n  Add them to FIELD_LABEL in ${LABELS}`);
process.exit(1);
