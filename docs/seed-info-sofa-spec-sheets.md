# Seed Info — Sofa Spec Sheets

> Reference inventory only. **No DB writes.** This document records what is
> seedable from the 16 sofa spec sheets supplied by Loo, mapped against
> `packages/db/src/schema.ts` and the existing seed `packages/db/seeds/catalog-2990s.sql`.
> Use it to drive (or reconcile) a future `catalog-2990s.sql` update — it does
> **not** itself change any data.

Captured: 2026-06-02. Source: 16 spec sheets (sofa price/spec posters).

---

## 1. Headline

- **16 sheets → 15 seedable models + 1 excluded.**
- **Uborr** (Ubur, "jellyfish", L-Shape, RM2990) is **struck through with a red
  diagonal line** on its sheet = discontinued / **do not seed**. It is correctly
  absent from `catalog-2990s.sql` already.
- The other 15 line up 1:1 with the 15 sofas already defined in
  `catalog-2990s.sql` (imported 2026-05-23 from an earlier PDF). These sheets are
  newer and add data the current seed lacks (descriptions, per-config
  dimensions, fabric/transport fees) — and disagree on three models (see §5).

---

## 2. The 15 seedable models

Etymology = the Malay root word the brand name is derived from (printed on each
sheet). SKU + model code are from the existing seed.

| Real name | Etymology | Model code | SKU | Configs & prices (RM) | Power/extra | Seat widths |
|---|---|---|---|---|---|---|
| Ommbuc | Ombak · "ocean wave" | AM 9036 | SOF-AM9036 | 1S 1490 / 2S 1990 / 3S 2490 / L-Shape 2990 | — | 24″ / 30″ |
| Lotti | Roti · "bread" | AM 9038 | SOF-AM9038 | 1S 1490 / 2S 1990 / 3S 2490 / L-Shape 2990 | — | 24″ / 30″ |
| Pantti | Pantai · "beach" | SF 9050 | SOF-SF9050 | 2-Seater + Wood Console 2990 | — | 24″–30″ |
| Siyyp | Sayup · "wing" | AM 9053 | SOF-AM9053 | 1S 1490 / 2S 1990 / 3S 2490 / L-Shape 2990 | Power Incliner +990/seat | 24″ / 30″ |
| Annsa | Angsa · "swan" | AM 9070 | SOF-AM9070 | 1S+1HR 1990 / 2S+2HR 2490 / 2.5S+2HR 2990 | Headrest included | 28″ / 37″ |
| Krron | Kerang · "seashell" | AM 9071 | SOF-AM9071 | **2.5-Seater 2990 only** ⚠️ | — | 37″ |
| Lyyar | Layar · "sail" | SF 5119 | SOF-SF5119 | 1S 1990 / 2S 2490 / 2S+Console 2990 | Power Leg +490/seat | 30″ |
| Blatt | Bulat · "round" | SF 5080 | SOF-SF5080 | **3-Seater 2990** ⚠️ | Stool 990 | — |
| Pllao | Pulau · "island" | SF 5130 | SOF-SF5130 | **3-Seater 2990** ⚠️ | — | — |
| Qubbu | Kubu · "fortress" | DSL 8019 | SOF-DSL8019 | 3-Seater 2990 | Power Incliner +990/seat | 30″ |
| Telluc | Teluk · "bay" | DSL 8020 | SOF-DSL8020 | L-Shape 2990 | — | 24″ / 30″ |
| Boaat | Bot · "boat" | DSL 8027 | SOF-DSL8027 | 2-Seater + Power Slide 2990 | Power Slide +990/seat | 32″ |
| Xammar | Camar · "seagull" | 5531 | SOF-5531 | 1S 1490 / 2S 1990 / 3S 2490 / L-Shape 2990 | — | 24″ / 28″ |
| Trrbu | Terumbu · "reef" | 5535 | SOF-5535 | 1S 1490 / 2S 1990 / 3S 2490 / L-Shape 2990 | — | 24″ / 28″ / 30″ |
| Booqit | Bukit · "hill" | 5539 | SOF-5539 | 1B + Corner + 2A 2990 | — | — |

**Excluded:** Uborr (Ubur · "jellyfish") — L-Shape 2990 — **crossed out on sheet, do not seed.**

---

## 3. Brand descriptions (`products.detail`)

Currently NULL/terse in the seed. The sheets supply on-brand copy for each. These
are the canonical strings to seed into `products.detail`:

- **Ommbuc** — True to its name, the height-adjustable backrest rolls in soft, wave-like curves that rise and fall to suit you. It brings the same easy, grounded calm of the sea into everyday living.
- **Lotti** — Big, round and plump with no hard edges anywhere, this sofa has the warm, pillowy softness of a fresh loaf. It's the kind of comfort you sink straight into.
- **Pantti** — Low armrests paired with a high pushback give it the easy, sink-in feel of a beanbag on the sand. It's laid-back, barefoot comfort for any day of the week.
- **Siyyp** — As the recliner extends, it opens out like a pair of wings spreading wide. The motion is smooth and effortless, carrying you gently into full rest.
- **Annsa** — With slender legs, a gently rounded silhouette and a soft headrest, this sofa carries the same quiet grace as the bird it's named after. Elegant to look at, effortless to settle into.
- **Krron** — Look closely at the seat and you'll see the stitching fan outward like the ridges of a shell. It's a small, natural detail that gives the whole piece its quiet rhythm.
- **Lyyar** — From the front, the armrests rise like a boat's bow and stern, while the tall backrest billows upward like a sail catching the wind. It's a shape built to carry you forward in comfort.
- **Blatt** — Not a single straight line runs through it — every curve flows softly into the next. The result is a continuous, rounded form that invites you to relax from any angle.
- **Pllao** — With one open armless side and a low, gentle back, it sits like a small island rising softly above the sea. Calm and low-profile, it's a quiet spot to retreat to.
- **Qubbu** — Lean back and the whole sofa rises around you like sturdy walls on every side. It's built to give you that reassuring feeling of being held, secure, and completely at rest.
- **Telluc** — The way the backrest, cushions and armrests curve around you echoes the sheltering arc of a coastal bay. Sit down and you're gently wrapped in a calm, protected sense of ease.
- **Boaat** — Seen from the front, its broad, low-slung form looks just like a boat resting on calm water. Steady and spacious, it's made to let you drift away into comfort.
- **Xammar** — Clean, flowing lines run through the whole piece, and the armrests open out like wings mid-glide. Graceful and light, it feels effortlessly at ease.
- **Trrbu** — Compact and solidly planted, it sits like a reef beneath the waves — understated yet incredibly sturdy. Quietly strong, it holds everything steady.
- **Booqit** — Two backrest cushions rise gently from the flat seat like soft hills on an open plain. The relaxed, natural form invites you to lean back and stay a while.

---

## 4. Per-config dimensions (reference — no dedicated column)

The schema has no per-bundle dimension column (`products.size_display` is
free-text and set NULL for sofas by design; `bundle_library` widths are global).
These are recorded here for reference only. Format: W × D × H cm (approx).

- **Ommbuc** (SW 24″ / 30″): 1S 97/112 ·102 ·99 · 2S 157/188 · 3S 218/264 · L 218/264 ×173/102 ×99
- **Lotti** (SW 24″ / 30″): 1S 122/137 ×117 ×102 · 2S 183/213 · 3S 244/290 · L 244/290 ×183/117 ×102
- **Pantti** (2S + Wood Console): 229/239/249/259 W ×114 ×104 (per 24/26/28/30″)
- **Siyyp** (SW 24″ / 30″): 1S 107/123 ×102 ×107 · 2S 168/198 · 3S 229/274 · L 229/274 ×173/102 ×107
- **Annsa** (SW 28″ / 37″): 1S+1HR 112 ×104 ×107 · 2S+2HR 183 · 2.5S+2HR 229
- **Krron**: 2-Seater 229 ×104 ×107 (37″)
- **Lyyar** (30″): 1S 137 ×124 ×104 · 2S 213 · 2S+Console 244
- **Blatt**: 3-Seater 229 ×114 ×79 · Stool 124 ×64 ×38
- **Pllao**: 3-Seater 287 ×106 ×72
- **Qubbu**: 3-Seater 254 ×94 ×104 (30″)
- **Telluc** (SW 24″ / 30″): L-Shape 239/284 ×165/107 ×99
- **Boaat**: 2S + Power Slide 224 ×104 ×99 (32″)
- **Xammar** (SW 24″ / 28″): 1S 142/152 ×112 ×104 · 2S 203/224 · 3S 264/295 · L 264/295 ×191/112 ×104
- **Trrbu** (SW 24″/28″/30″): 1S 106/116/121 ×106 ×69 · 2S 167/187/197 · 3S 228/258/273 · L 228/258/273 ×165/106 ×69
- **Booqit**: 1B + Corner + 2A 293 ×273/106 ×102

---

## 5. ⚠️ Discrepancies — sheet vs. existing seed (need Loo's confirmation)

Likely because the sheets are newer than the 2026-05-23 PDF import. **Do not seed
over these without confirmation.**

1. **Krron (AM 9071)** — sheet shows **only a 2.5-Seater @ 2990**. Seed has
   1S 1490 / 2S 1990 / 3S 2990 / 2.5S 2990 (four bundles).
2. **Blatt (SF 5080)** — sheet says **3-Seater @ 2990 + Stool 990**. Seed mapped
   it to a `2.5S` bundle; stool was deferred to "Track 2" (stool not a placeable
   module yet). Sheet's Stool price RM990 ≠ `compartment_library` STOOL default 490.
3. **Pllao (SF 5130)** — sheet says **3-Seater @ 2990**. Seed mapped it to a
   `2+L` (L-Shape) bundle.

---

## 6. Fees

| Fee | Maps to | Value |
|---|---|---|
| Custom Fabric | `product_fabrics.surcharge` / `fabric_tier_addon_config` | RM125 (all) — **Booqit RM250** |
| Transport (West Malaysia) | global `delivery_fee_config.base_fee` (no per-product override) | RM250 |
| Transport — Booqit | no per-product column | RM500 ("covers Malaysia, too big/heavy") |

Power upgrades (already in seed via `recliner_upgrade_price` + `seat_upgrade_label`):
Power Incliner 990 (Siyyp, Qubbu), Power Leg 490 (Lyyar), Power Slide 990 (Boaat).

---

## 7. Shared specs (printed on every sheet)

- **Structure:** Crafted with solid wood
- **Based:** Belt support system
- **Seat Suspension:** Gentle Comfort Foam · Stable Foundation
- **Key Features:** Durable · Easy to Clean · Anti Dust Mite · Pet Friendly · Water Resistant
- **Warranty:** Lifetime structural · 5-Year seat · 3-Year mechanism (T&Cs apply)

(No dedicated schema columns; reference / marketing copy only.)

---

## 8. What is actually seedable from these sheets

Against the schema, the genuinely actionable items (beyond what `catalog-2990s.sql`
already contains):

1. **Enrich `products.detail`** for all 15 with the §3 brand copy. ← new content
2. **Seed custom-fabric surcharges** (125; Booqit 250) into the fabric tables.
3. **Re-confirm** bundle prices + power-upgrade prices (already seeded — §5 first).
4. **Keep excluding Uborr** (crossed out).

Items **1** and **2** are net-new. Item **3** needs the §5 discrepancies resolved
with Loo before any re-seed. Per-config dimensions (§4), transport fees (§6) and
shared specs (§7) have no schema home and stay reference-only for now.
