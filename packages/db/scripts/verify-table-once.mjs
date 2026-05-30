#!/usr/bin/env node
// One-shot table verifier — describes a table and lists its indexes.
//
// USAGE:
//   DB_PWD=xxx TBL=sofa_combo_pricing node verify-table-once.mjs
import postgres from 'postgres';

const pwd = process.env.DB_PWD;
const tbl = process.env.TBL;
if (!pwd || !tbl) { console.error('Set DB_PWD + TBL'); process.exit(1); }

const sql = postgres({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 6543,
  user: 'postgres.dolvxrchzbnqvahocwsu',
  password: pwd,
  database: 'postgres',
  ssl: 'require',
  prepare: false,
  max: 1,
});

try {
  const cols = await sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = ${tbl}
    ORDER BY ordinal_position
  `;
  console.log(`Columns of ${tbl}:`);
  for (const c of cols) {
    console.log(`  ${c.column_name.padEnd(22)} ${c.data_type.padEnd(28)} nullable=${c.is_nullable}`);
  }

  const ixs = await sql`
    SELECT indexname, indexdef FROM pg_indexes WHERE tablename = ${tbl} ORDER BY indexname
  `;
  console.log(`\nIndexes of ${tbl}:`);
  for (const i of ixs) {
    console.log(`  ${i.indexname}`);
  }
} catch (err) {
  console.error('Failed:', err.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
