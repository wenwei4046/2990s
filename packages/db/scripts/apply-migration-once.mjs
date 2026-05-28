#!/usr/bin/env node
// One-shot migration runner. Pass the migration filename via env MIG_FILE
// (relative to packages/db/migrations) and the DB password via env DB_PWD.
//
// Bypasses the (broken) GH Actions workflow that needs a DATABASE_URL
// repo secret the commander hasn't set. Uses postgres@3 already vendored
// in packages/db/node_modules.
//
// USAGE:
//   DB_PWD=xxx MIG_FILE=0090_sofa_combo_pricing.sql node apply-migration-once.mjs
//
// The DB password should be revoked from Supabase Dashboard right after
// applying.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));

const pwd = process.env.DB_PWD;
const file = process.env.MIG_FILE;
if (!pwd) {
  console.error('Set DB_PWD env var.');
  process.exit(1);
}
if (!file) {
  console.error('Set MIG_FILE env var (e.g. 0090_sofa_combo_pricing.sql).');
  process.exit(1);
}

const sqlPath = resolve(here, '..', 'migrations', file);
const sql = readFileSync(sqlPath, 'utf8');

const PROJECT_REF = 'dolvxrchzbnqvahocwsu';
const HOST = `aws-1-ap-southeast-1.pooler.supabase.com`;
const PORT = 6543;
const USER = `postgres.${PROJECT_REF}`;
const DB = 'postgres';

const client = postgres({
  host: HOST,
  port: PORT,
  user: USER,
  password: pwd,
  database: DB,
  ssl: 'require',
  prepare: false,
  max: 1,
});

console.log(`> Applying ${file} to ${HOST}:${PORT}/${DB} as ${USER}`);
try {
  await client.begin(async (tx) => {
    await tx.unsafe(sql);
  });
  console.log(`✓ Migration applied: ${file}`);
} catch (err) {
  console.error('✗ Migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
