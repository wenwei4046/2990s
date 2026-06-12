#!/usr/bin/env node
// ----------------------------------------------------------------------------
// scripts/db-migrate.mjs — auto-apply packages/db/migrations/*.sql on deploy.
//
// Invoked by .github/workflows/deploy.yml (step "Apply DB migrations") with
// env SUPABASE_DB_URL = the Supabase Postgres connection string (URI).
//
// RULES
//   • Tracking table `schema_migrations(filename PK, applied_at)` records what
//     has been applied BY THIS SCRIPT. Created on first run.
//   • A file is eligible only when BOTH:
//       (a) not yet recorded in schema_migrations, AND
//       (b) its leading number >= 0168 (AUTO_APPLY_FROM)  OR  the exact
//           filename is in BACKFILL (the known-unapplied stragglers).
//     Everything else (the ~160 legacy files 0000–0167 the owner already
//     pasted into Supabase manually) is never touched and never re-run.
//   • SKIP list (intentionally NOT auto-applied — do not add to BACKFILL):
//       0164_so_scan_samples.sql — owner ruling 2026-06-12: scan feature is
//       reserved for another system; apply manually if/when that changes.
//     (0164 is < 0168 and not in BACKFILL, so the number gate skips it.)
//   • Each file runs in its own transaction; on error → ROLLBACK + exit 1
//     (deploy aborts before anything ships against a half-migrated schema).
//     Files that carry their own BEGIN/COMMIT (e.g. 0126, 0162) are run as-is.
//   • If SUPABASE_DB_URL is unset (secret not configured) → exit 0 so the
//     deploy still proceeds; migrations simply stay manual until it's set.
// ----------------------------------------------------------------------------

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const AUTO_APPLY_FROM = 168; // every migration numbered >= 0168 auto-applies

// One-time backfill: files < 0168 that were NOT applied manually.
const BACKFILL = new Set([
  '0126_fifo_adjustment_branch.sql',
  '0162_fix_stock_takes_status_check.sql',
  '0166_mfg_products_barcode.sql',
  '0167_fabric_active.sql',
]);

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages',
  'db',
  'migrations',
);

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.log('SUPABASE_DB_URL secret not configured, skipping migrations');
  process.exit(0);
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort(); // filename order == numeric order (zero-padded prefixes)

const numberOf = (f) => {
  const m = /^(\d+)/.exec(f);
  return m ? parseInt(m[1], 10) : NaN;
};

const client = new pg.Client({
  connectionString: dbUrl,
  // Supabase poolers terminate TLS with a cert Node doesn't chain by default.
  ssl: { rejectUnauthorized: false },
});

let applied = 0;
let failedFile = null;

try {
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await client.query('SELECT filename FROM schema_migrations');
  const done = new Set(rows.map((r) => r.filename));

  for (const file of files) {
    const num = numberOf(file);
    const eligible = num >= AUTO_APPLY_FROM || BACKFILL.has(file);

    if (!eligible) {
      console.log(`skip    ${file} (legacy/manual — below ${AUTO_APPLY_FROM} cutoff, not in backfill)`);
      continue;
    }
    if (done.has(file)) {
      console.log(`skip    ${file} (already recorded in schema_migrations)`);
      continue;
    }

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    // Files that manage their own transaction (line-leading COMMIT) are run
    // as-is; wrapping them would make our outer BEGIN/COMMIT no-op warnings.
    const selfTransacted = /^\s*COMMIT\s*;?\s*$/im.test(sql);

    console.log(`apply   ${file} ...`);
    try {
      if (selfTransacted) {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      } else {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
      }
      applied += 1;
      console.log(`applied ${file}`);
    } catch (err) {
      failedFile = file;
      try {
        await client.query('ROLLBACK');
      } catch {
        /* no open transaction */
      }
      console.error(`FAILED  ${file}: ${err.message}`);
      throw err;
    }
  }

  console.log(`done — ${applied} migration(s) applied, ${files.length - applied} skipped`);
} catch (err) {
  if (!failedFile) console.error(`migration runner error: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
