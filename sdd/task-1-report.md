# Task 1 Report: Migration + Drizzle table

## Status: DONE

## Files Changed

1. **Created** `packages/db/migrations/0176_free_item_campaigns.sql`
   - New migration file with full SQL table definition
   - Includes RLS policy definitions (fic_select_all, fic_write_editors)
   - 31 lines total (SQL + comment)

2. **Modified** `packages/db/src/schema.ts`
   - Added `freeItemCampaigns` pgTable export after `modelDefaultFreeGifts` (lines 172–190)
   - Includes all required fields: id, name, active, maxFreeQty, eligible, createdBy, createdAt, updatedAt
   - All field types match the migration SQL exactly
   - No new imports needed (boolean, integer already present on line 16)

## Typecheck

Command: `pnpm --filter @2990s/db typecheck`

Result: **PASS** (no type errors)
- Schema compiles without errors
- All field types correctly typed
- No missing imports

## Commit

Commit SHA: `7a4f4849`
Commit Message: `feat(db): free_item_campaigns table + RLS (mig 0176)`

Files staged and committed:
- packages/db/migrations/0176_free_item_campaigns.sql
- packages/db/src/schema.ts

## Notes

- The migration file syntax matches the brief exactly, including:
  - DEFAULT gen_random_uuid() for id
  - CHECK constraint on max_free_qty >= 1
  - Foreign key to staff(id) with ON DELETE SET NULL
  - RLS policies with proper role filtering (admin, super_admin, coordinator, sales_director)

- The Drizzle table exports all required fields with correct camelCase naming
- Comment documentation explains table purpose and RLS scope

- Step 4 (Apply migration to prod via Supabase MCP) is intentionally skipped per instructions
