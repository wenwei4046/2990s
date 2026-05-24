# Bedframe Catalog (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get the 18 base bedframe models into the POS catalog as size-variant products at placeholder pricing, sellable by size immediately.

**Architecture:** Pure-data seed, identical pattern to `mattress-catalog.sql` — 18 `products` (`category_id='bedframe'`, `pricing_kind='size_variants'`) + `product_size_variants` (standard 4 @ RM2990 placeholder). No migration, no new tables. The richer configurator (colour/gap/leg/divan/total/specials) is Plan 2 (`docs/superpowers/specs/2026-05-25-bedframe-configurator-design.md` §3.3–3.7).

**Tech Stack:** Supabase Postgres, idempotent SQL seed applied via Supabase MCP, POS static-asset hero image, CF Pages deploy.

**Source:** model names from `mfg_products` WHERE category='BEDFRAME' (18 base models, variant suffixes collapsed). Decisions: spec §2.

---

## File structure
- Create: `packages/db/seeds/bedframe-catalog.sql` — the seed (only new file).
- Reuse: `apps/pos/public/catalog/mattress-bed.png` as the shared hero (it is a bed-frame line-art; Loo swaps real photos later per the mattress pattern). No new asset.
- No schema.ts / migration changes (size_variants already exists).

## The 18 models (UUID `ffffffff-…-00NN`, SKU, name ← mfg base)
0001 BED-HILTON·Hilton(1003) · 0002 BED-FENRIR·Fenrir(1005) · 0003 BED-CODY·Cody(1007) ·
0004 BED-RICARDO·Ricardo(1008) · 0005 BED-VALKRIE·Valkrie(1009) · 0006 BED-JAGER·Jager(1013) ·
0007 BED-ARIZONA·Arizona(1019) · 0008 BED-COTY·Coty(1023) · 0009 BED-TIFANNY·Tifanny(1030) ·
0010 BED-VICTORIA·Victoria(1041) · 0011 BED-ELEPHANE·Elephane(2003) · 0012 BED-REGAL·Regal(2006) ·
0013 BED-TRION·Trion(2009) · 0014 BED-NINA·Nina(2027) · 0015 BED-JACOB·Jacob(2033) ·
0016 BED-CELENE·Celene(2038) · 0017 BED-ELEGANT·Elegant(2041) · 0018 BED-DIVAN·Divan(DIVAN)

All: `visible=true`, `stock=99`, all 4 sizes active @ 2990 placeholder (Loo deactivates/prices unavailable sizes in Backend SKU Master). `detail` NULL, `size_display` NULL, no series.

---

### Task 1: Write the bedframe catalog seed

**Files:**
- Create: `packages/db/seeds/bedframe-catalog.sql`

- [ ] **Step 1: Write the seed file**

```sql
-- packages/db/seeds/bedframe-catalog.sql
-- ============================================================================
-- Bedframe catalogue · Phase 1 (pure-data seed, placeholder pricing)
-- 18 base models from mfg_products (BEDFRAME), variant suffixes collapsed.
-- pricing_kind='size_variants' (like mattresses) — standard 4 sizes @ RM2990
-- placeholder. Loo edits real per-size prices + deactivates unavailable sizes
-- in Backend SKU Master. The richer configurator (colour/gap/leg/divan/total/
-- specials) is Plan 2. Hero reuses the shared bed line-art.
-- Idempotent: stable UUIDs ffffffff-…-00NN + ON CONFLICT. Does NOT touch
-- mock (eeee…), sofa (cccc…), or mattress (dddd…) rows.
-- ============================================================================
DO $$
DECLARE
  v_img text := 'https://2990s-pos.pages.dev/catalog/mattress-bed.png';
BEGIN
  INSERT INTO products
    (id, sku, category_id, pricing_kind, name, img_key, thumb_key, visible, stock)
  VALUES
    ('ffffffff-ffff-ffff-ffff-ffffffff0001','BED-HILTON','bedframe','size_variants','Hilton',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0002','BED-FENRIR','bedframe','size_variants','Fenrir',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0003','BED-CODY','bedframe','size_variants','Cody',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0004','BED-RICARDO','bedframe','size_variants','Ricardo',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0005','BED-VALKRIE','bedframe','size_variants','Valkrie',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0006','BED-JAGER','bedframe','size_variants','Jager',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0007','BED-ARIZONA','bedframe','size_variants','Arizona',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0008','BED-COTY','bedframe','size_variants','Coty',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0009','BED-TIFANNY','bedframe','size_variants','Tifanny',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0010','BED-VICTORIA','bedframe','size_variants','Victoria',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0011','BED-ELEPHANE','bedframe','size_variants','Elephane',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0012','BED-REGAL','bedframe','size_variants','Regal',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0013','BED-TRION','bedframe','size_variants','Trion',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0014','BED-NINA','bedframe','size_variants','Nina',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0015','BED-JACOB','bedframe','size_variants','Jacob',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0016','BED-CELENE','bedframe','size_variants','Celene',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0017','BED-ELEGANT','bedframe','size_variants','Elegant',v_img,v_img,true,99),
    ('ffffffff-ffff-ffff-ffff-ffffffff0018','BED-DIVAN','bedframe','size_variants','Divan',v_img,v_img,true,99)
  ON CONFLICT (id) DO UPDATE SET
    sku=EXCLUDED.sku, category_id=EXCLUDED.category_id, pricing_kind=EXCLUDED.pricing_kind,
    name=EXCLUDED.name, img_key=EXCLUDED.img_key, thumb_key=EXCLUDED.thumb_key,
    visible=EXCLUDED.visible, stock=EXCLUDED.stock, updated_at=now();

  INSERT INTO product_size_variants (product_id, size_id, active, price)
  SELECT p.id, s.size_id, true, 2990
  FROM products p
  CROSS JOIN (VALUES ('single'),('super-single'),('queen'),('king')) AS s(size_id)
  WHERE p.id BETWEEN 'ffffffff-ffff-ffff-ffff-ffffffff0001'
                 AND 'ffffffff-ffff-ffff-ffff-ffffffff0018'
  ON CONFLICT (product_id, size_id) DO UPDATE SET active=EXCLUDED.active, price=EXCLUDED.price;
END $$;
```

- [ ] **Step 2: Commit the seed file**

```bash
git add packages/db/seeds/bedframe-catalog.sql
git commit -m "feat(catalog): seed 18 bedframe models (size_variants, placeholder)"
```

### Task 2: Apply to live Supabase + verify

- [ ] **Step 1: Pre-check preconditions** (Supabase MCP `execute_sql`)

```sql
SELECT (SELECT count(*) FROM categories WHERE id='bedframe') AS has_cat,
       (SELECT count(*) FROM size_library WHERE id IN ('single','super-single','queen','king')) AS sizes,
       (SELECT count(*) FROM products WHERE id BETWEEN 'ffffffff-ffff-ffff-ffff-ffffffff0001' AND 'ffffffff-ffff-ffff-ffff-ffffffff9999') AS already;
```
Expected: `has_cat=1, sizes=4, already=0`.

- [ ] **Step 2: Apply the seed** — paste the full `DO $$…$$` block from Task 1 Step 1 into Supabase MCP `execute_sql`. Expected: `[]` (no error).

- [ ] **Step 3: Verify** (`execute_sql`)

```sql
SELECT (SELECT count(*) FROM products WHERE category_id='bedframe' AND id BETWEEN 'ffffffff-ffff-ffff-ffff-ffffffff0001' AND 'ffffffff-ffff-ffff-ffff-ffffffff9999') AS frames,
       (SELECT count(*) FROM product_size_variants v JOIN products p ON p.id=v.product_id WHERE p.category_id='bedframe' AND v.price=2990) AS variants,
       (SELECT count(*) FROM products WHERE category_id='bedframe' AND img_key IS NULL) AS missing_img;
```
Expected: `frames=18, variants=72, missing_img=0`.

### Task 3: Ship + deploy + verify live

- [ ] **Step 1: Branch is `feat/bedframe-configurator`** (spec already committed there). Push + PR.

```bash
git push -u origin feat/bedframe-configurator
gh pr create --title "feat(catalog): bedframe catalog (Phase 1) — 18 models as size variants" --base main --body "Seeds 18 bedframe models as size_variants @ placeholder RM2990 (Loo prices in Backend). Spec: docs/superpowers/specs/2026-05-25-bedframe-configurator-design.md. Configurator = Plan 2."
```

- [ ] **Step 2: Merge + watch deploy** (no new asset needed — hero already live from the mattress ship).

```bash
gh pr merge --squash --delete-branch
gh run watch <deploy-run-id> --exit-status
```

- [ ] **Step 3: Verify on live POS** — Loo eyeballs the Bed frames category (18 frames, hero image, "By size", pick size → cart at RM2990). PWA hard-refresh.

---

## Self-review
- **Spec coverage:** Plan 1 covers spec §2 (18 models), §3.1 (catalog products), §3.2 (standard-4 sizes @ placeholder), §3.8 (pricing in SKU Master — placeholder set here, edited there). Deferred to Plan 2 (explicitly): §3.3 colour, §3.4 options, §3.5 config, §3.6 recompute, §3.7 configurator UI, §4 migrations. No gaps for Phase 1.
- **Placeholders:** none — full SQL + exact verification counts (18/72/0).
- **Consistency:** UUID range `…0001–0018`, `pricing_kind='size_variants'`, all `img_key` set; matches the verified mattress seed pattern.

## Notes for Plan 2 (next)
Switch bedframes `size_variants → bedframe_build`, add `bedframe_colours`/`product_bedframe_colours`/`bedframe_options` (+ migrations), snapshot maintenance values into `bedframe_options` (Decision B), `BedframeConfig` Zod (`order-v1` + `order.schema`), `computeBedframePrice` (shared/pricing) + server recompute in `POST /orders`, the 7-dimension configurator branch in `Configurator.tsx` (DIVAN ONLY = size+colour+leg), cart snapshot + `buildPostBody`. **Blocked on Loo's colour list.**
