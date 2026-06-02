# Delivery Fee — Special-Model Fees + Cross-Order Linking (design)

> Chairman brief 2026-06-02. Amends the dormant delivery-fee system. Decisions
> below were confirmed by Loo before any code was written.

## Why this exists

The delivery fee (`base 250 + cross-category 175`) was built (`computeDeliveryFee`
+ `delivery_fee_config`) but only ever wired into the **legacy retail `/orders`
path**. The live POS→SO path (`POST /mfg-sales-orders`) charges **zero** delivery
fee today — the POS computes it for *display* in the handover summary, then drops
it before submit (`Handover.tsx:150` display only; `pos-handover-so.ts` payload
has no fee field; `mfg-sales-orders.ts` sums lines only). Evidence in the mapping
workflow `wf_c49a7d8d-162`.

So this is three layers, not a tweak:

- **Phase 0 — foundation.** Make the base + cross-category fee actually charge on
  the live SO. Server-authoritative recompute, snapshot column, shown on the SO.
- **Phase 1 — special-model fees.** Some models (2 full-latex mattresses, 1
  special sofa) cost RM 500 to transport. A special model's fee **overrides** the
  normal base. Set per-Model by the Master.
- **Phase 2 — cross-order link.** Mattress and sofa can't share one SO, so the
  customer's sofa goes on a *second* SO. Sales links it back to the earlier SO →
  the second SO charges only the reduced cross rate (175, or a per-special
  "cross-category special price" e.g. 300) instead of a fresh full base.

## Confirmed decisions (Loo, 2026-06-02)

1. **Link mechanism = manual link to the earlier SO.** Not a printed voucher
   code, not auto-by-phone. Sales searches the customer's prior SO (existing
   `/debtors/search`), picks it, server validates + applies the cross discount +
   records the link on the new SO. No new customer-dedup infra; auditable;
   anti-double-dip via a "linked SO already consumed" guard.
2. **Turn the base fee ON for live SOs now** (Phase 0). Every live SO will charge
   delivery per the rules, server-authoritative.
3. **Special fee = per-Model, set by picking the model.** Selecting a special
   model charges its special price and **overrides** the default ratio. Each
   special model carries two numbers: standalone fee (500) and cross-category
   follow-up fee (300). Stored in a dedicated `model_special_delivery_fees` table
   (one row per special model) — transparent: the table *is* the list of which
   models are special. No auto "latex" detection exists (no material field in
   the schema), so the tag is manual = a row in this table.

## The unified money model (one pure function)

`computeSoDeliveryFee(input, config)` in `packages/shared/src/pricing.ts` owns the
whole rule (honest-pricing red line: pure + unit-tested, server calls it).

```
hasSpecial = specialModels.length > 0
if isCrossCategoryFollowup:            # linked 2nd SO — base already paid on SO #1
    base = hasSpecial ? (special cross fee, highest, else 175) : 175
    cross = 0
else:                                  # standalone / first SO
    base  = hasSpecial ? (special standalone fee, highest, else 250) : 250
    cross = (≥2 deliverable categories in THIS cart) ? 175 : 0
total = base + cross + additional
```

Worked examples (matches the Chairman's brief):

| Scenario | Normal model | Special model present |
|---|---|---|
| Single category, one SO (mattress only) | 250 | **500** |
| Cross-category, **same SO** (sofa + bedframe) | 250 + 175 = **425** | **500** + 175 = **675** |
| Two-SO split · SO #1 (mattress) | 250 | 500 |
| Two-SO split · SO #2 (sofa, **linked** to SO #1) | **175** | **300** |

- "deliverable categories" = sofa / mattress / bedframe (accessories + others do
  not trip cross-category).
- Two latex mattresses still = one base 500 (max of specials, never summed).
- `additional` = free-form fee sales keys at handover; negatives clamped to 0.

## File map

| Purpose | File | Phase |
|---|---|---|
| Pure `computeSoDeliveryFee` + types | `packages/shared/src/pricing.ts` | 0 |
| Tests | `packages/shared/src/__tests__/pricing.test.ts` | 0 |
| `mfg_sales_orders.delivery_fee_centi` snapshot col + breakdown | migration + `schema.ts` | 0 |
| Server recompute + fold into total + recomputeTotals read-back | `apps/api/src/routes/mfg-sales-orders.ts` | 0 |
| POS sends `additionalDeliveryFee` (+ link ref in P2) | `pos-handover-so.ts`, `Handover.tsx` | 0/2 |
| POS handover summary uses the same fn (display == server) | `Handover.tsx`, `OrderSummaryPane.tsx` | 0 |
| Backend SO detail shows the fee row | SO detail page | 0 |
| `model_special_delivery_fees` table + read at order time | migration + `schema.ts` + server | 1 |
| Master UI to pick special models + set 2 fees | POS Products "Delivery" tab | 1 |
| `mfg_sales_orders.cross_category_source_doc_no` link col | migration + `schema.ts` | 2 |
| POS link-to-prior-SO picker (reuse `/debtors/search`) | Handover + queries | 2 |
| Server validate link + apply follow-up rate + consume guard | `mfg-sales-orders.ts` | 2 |

## Anti-tamper

Fully server-recomputed from config + the special-fee table + the validated link.
The only client input trusted is `additionalDeliveryFee` (free-form operator fee,
clamped ≥0). No client-sent fee total is honored. Mirrors the codebase's
"server recomputes, ignores client junk" pattern.

## Migrations

Append-only, **not applied to prod without an explicit Chairman go**. Local/unit
verification is via the pure-function test suite; DB apply is a separate gated step.
