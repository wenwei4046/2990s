# Split item.remark from the special add-on (note + extra charge)

**Date:** 2026-06-13
**Author:** Claude (with Loo)
**Status:** Approved — ready to implement

## Problem

The POS product page has ONE "Remark & extra charge" card. The single `remark`
value does double duty:

1. it is stored to `mfg_sales_order_items.remark` (prints on the SO as `Remark: …`), and
2. it is also pushed into `custom_specials` + the Description-2 `SPECIAL:` segment
   as the label for the extra charge (so a remark with money reads as a special add-on).

Loo wants these two concepts separated:

- A **special add-on** = a note/description paired with the extra charge. It is
  conceptually a special add-on, so it should sit directly **below the SPECIAL
  ADD-ON chips** and only feed the Specials surfaces.
- A genuine **item remark** = a plain per-line remark that prints on the SO and is
  not a special add-on. This is "the item.remark I really want."

He also wants the `pos_product_remark` SO-Maintenance toggle **removed** — both
fields should always show (he did not know the toggle existed and does not want it).

## Decisions (locked with Loo, 2026-06-13)

- **Data split: fully separate.** Each field has exactly one destination.
- **Layout:** the new "Item remark" field sits directly below the special-add-on
  block; both blocks sit right after the SPECIAL ADD-ON chips.
- **Toggle:** remove `pos_product_remark` entirely (no gate; always show).

## Data model

Introduce a new variants key `extraAddonNote`, paired with the existing
`extraAddonAmountRM`.

| UI field | variants key | Persisted to | Renders as |
|---|---|---|---|
| **Item remark** | `remark` *(existing key + plumbing, unchanged)* | `mfg_sales_order_items.remark` column | `Remark: …` line on the SO |
| **Special add-on** | `extraAddonNote` *(NEW)* + `extraAddonAmountRM` | `custom_specials` jsonb | Specials / 特别加购 column + Description-2 `SPECIAL:` segment |

Rules:

- `variants.remark` → DB `.remark` column plumbing is **unchanged** (route store,
  sofa per-compartment propagation, `SalesOrderPrint`, backend SO PDF, `SoLineCard`
  edit). It is now *only* the item remark — it no longer feeds `custom_specials`.
- The two surfaces that build the special-add-on label switch from reading
  `variants.remark` to reading `variants.extraAddonNote`, keeping the existing
  `"Extra add-on"` fallback when the note is blank but the amount > 0:
  - `apps/api/src/lib/mfg-pricing-recompute.ts` (`custom_specials` composition).
  - `packages/shared/src/variant-summary.ts` (Description-2 `SPECIAL:` segment).
- Money path is **unchanged**: `extraAddonAmountRM` still folds into both
  authoritative branches / drift gate, stays out of the PWP base and cost path.

## UI (apps/pos/src/pages/Configurator.tsx)

Replace the single "Remark & extra charge" `RailSection` with two adjacent
`RailSection`s, rendered immediately after the special-add-on chips:

```
… SPECIAL ADD-ON (chips)
┌─ Special add-on ─────────  Optional — adds a charged item to the sales order
│  Description  [textarea]    → lineExtraNote → variants.extraAddonNote
│  Amount (RM)  [   0    ]     → lineExtraRm   → variants.extraAddonAmountRM
├─ Remark ─────────────────  Optional — prints on the sales order
│  Remark       [textarea]    → lineRemark     → variants.remark
```

- State: keep `lineRemark` (item remark) + `lineExtraRm`; add `lineExtraNote`.
- `effectiveExtraRm` no longer gated — computed straight from `lineExtraRm`.
- Edit-hydration: hydrate `lineRemark` from `cfg.remark` (unchanged) and the new
  `lineExtraNote` from `cfg.extraAddonNote`.
- Placement per product type (right after the special-add-on UI):
  - **Bedframe:** after the "Build" section (special-add-on chips live inside it).
    Currently the remark block is *above* Build — move it below.
  - **Mattress:** right after the "Add-ons" section. PWP moves below the two blocks.
  - **Sofa:** right after `specialAddonsBlock` inside `SofaQuickPick` / `CustomBuilder`.

## Plumbing

- `apps/pos/src/state/cart.ts` — add `extraAddonNote?: string` to
  `SofaConfigSnapshot`, `SizeConfigSnapshot`, `BedframeConfigSnapshot`.
- `apps/pos/src/lib/pos-handover-so.ts` — for sofa/bedframe/size, emit
  `if (config.extraAddonNote?.trim()) v.extraAddonNote = config.extraAddonNote.trim();`
  and add `extraAddonNote?` to the line-config input type.

## Remove the `pos_product_remark` toggle

- `Configurator.tsx` — drop `remarkCardEnabled` / `useSoSettingEnabled`; always render.
- `apps/api/src/routes/mfg-sales-orders.ts` — remove the `pos_product_remark === false`
  rejection (the "extra_amount_disabled" 400). Keep the `pos_remark_extra_auto_sku`
  read for `autoSkuEnabled` (that retired flag is out of scope).
- `apps/pos/src/pages/SalesOrderMaintenance.tsx` + `apps/backend/src/pages/SalesOrderMaintenance.tsx`
  — remove the `PosSettingsSection` (it only held this toggle) and its imports/render.
- Migration — delete the `pos_product_remark` row from `so_settings`. The generic
  `so_settings` table + `/so-settings` route stay (dormant, reserved for future
  toggles; avoids touching the parallel session's surface area).

## Backward compatibility

- Historical orders keep `variants.remark` → still print as `Remark: …`. Their
  persisted `custom_specials` is untouched. On any re-derivation they simply stop
  duplicating the old remark inside the `SPECIAL:` segment (they have no
  `extraAddonNote`) — a removed duplication, no data loss.

## Tests

- `apps/api/src/lib/mfg-pricing-recompute.test.ts` — `custom_specials` is driven by
  `extraAddonNote` (not `remark`); `remark` alone no longer creates a special.
- `packages/shared/src/variant-summary.test.ts` — `SPECIAL:` segment reads
  `extraAddonNote`; bare `remark` no longer appears there.
- `apps/pos/src/lib/pos-handover-so.test.ts` — `extraAddonNote` maps into variants.

## Out of scope

- `TbcLineEditor` (no remark/extra fields).
- The retired `pos_remark_extra_auto_sku` flag and one-shot mint code path.
- The generic `so_settings` table / `/so-settings` route / hooks (kept dormant).
