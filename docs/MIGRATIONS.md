# Auto-Migrations (deploy-time)

Since 2026-06-12, `packages/db/migrations/*.sql` apply **automatically on every
deploy to main** — no more pasting SQL into the Supabase dashboard.

## How it works

- `.github/workflows/deploy.yml` runs `node scripts/db-migrate.mjs` (step
  **Apply DB migrations**) after the build, before the Workers/Pages deploys.
- The script connects with the `SUPABASE_DB_URL` secret and keeps a tracking
  table `schema_migrations(filename, applied_at)` in the database. Each
  eligible file runs once, in its own transaction, in filename order. Any
  failure rolls back that file and **aborts the deploy** (non-zero exit).
- A file is eligible only if it is not yet recorded AND either:
  - numbered **>= 0168** (all new migrations from here on), or
  - in the one-time **backfill allowlist** (the four files that were never
    pasted manually): `0126_fifo_adjustment_branch.sql`,
    `0162_fix_stock_takes_status_check.sql`, `0166_mfg_products_barcode.sql`,
    `0167_fabric_active.sql`.
- The ~160 legacy files (0000–0167, already applied manually) are **never
  touched or re-run**.
- **On hold:** `0164_so_scan_samples.sql` is intentionally NOT applied (owner
  ruling — scan feature reserved for another system). It is below the 0168
  cutoff and not in the allowlist, so the runner skips it. Do not add it to
  the allowlist without the owner's word.
- If the `SUPABASE_DB_URL` secret is absent, the step prints
  `secret not configured, skipping migrations` and exits 0 — the deploy
  proceeds and migrations stay manual until the secret is set.

## One-time setup (required once)

1. Supabase Dashboard → Project Settings → Database → **Connection string**
   → URI tab → copy the URI and substitute the database password.
2. GitHub repo → Settings → **Secrets and variables → Actions** →
   **New repository secret**:
   - Name: `SUPABASE_DB_URL`
   - Value: the connection string URI from step 1.

(The older manual workflow `db-migrate.yml` uses a separate `DATABASE_URL`
secret with the same value; it remains available for one-off/manual runs.)

## The rule going forward

- **From 0168, every new migration auto-applies on the next deploy.** Just
  commit the `.sql` file under `packages/db/migrations/` — number it 0168+.
- Write migrations idempotently where practical (`IF NOT EXISTS`, guarded
  constraint swaps) and keep one concern per file.
- `0164` stays on hold until the owner says otherwise.
