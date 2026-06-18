# MRP lead-time applied on Proceed PO + maintenance moved to the MRP page

Status: APPROVED (Commander 2026-06-18) — implemented same day.

## Problem
When you Proceed PO from the MRP page, the PO delivery date is set to the
customer's delivery date verbatim. If the supplier delivers exactly on that
date and is late, the customer order is blown. The owner always asks suppliers
to deliver a buffer (e.g. 7 days) ahead, so the PO delivery date should be the
customer date minus a per-category number of days.

## Key finding (existing infra)
A per-category lead-time config already exists and was 80% of this feature:
- Table `mrp_category_lead_times` (migration 0099): one integer `lead_days` per
  category (sofa / bedframe / mattress / accessory / service). Route
  `apps/api/src/routes/mrp-lead-times.ts` (GET map + PUT upsert).
- The MRP report already computes an `orderByDate = delivery − lead_days[cat]`
  hint (`mrp.ts orderByOf`).
- **Gap:** Proceed PO (`POST /mfg-purchase-orders/from-sos`) set each PO line's
  delivery date to `line_delivery_date ?? customer_delivery_date` — it never
  applied the lead days. So the config was display-only.
- The maintenance UI lived on the Sales Order Maintenance page, not MRP.

## Decisions (owner)
1. **Reuse** `mrp_category_lead_times` (no new config, no migration).
2. **Default auto-deduct** on Proceed PO; the PO date stays manually editable
   afterward.
3. **Move** the lead-time maintenance to the MRP page; **remove** it from Sales
   Order Maintenance (one source of truth, in the place it's used).

## Design
### A. Backend — deduct on Proceed PO (`mfg-purchase-orders.ts`)
- New pure helper `subtractCalendarDays(dateStr, days)` — UTC calendar-day
  subtraction; null/empty → null; days ≤ 0 → unchanged.
- In `POST /from-sos`, preload `mrp_category_lead_times` once into a
  `leadDaysByCat` map (keyed lowercase; category on a SO/PO line is its
  `item_group`).
- Where each line's delivery date is derived, change to:
  `lineDeliveryDate = expectedAtOverride ?? subtractCalendarDays(line_delivery_date ?? customer_delivery_date, leadDaysByCat[item_group])`.
  An explicit caller override is still taken as-is. The deducted date flows
  through the supplier bucketing → PO line insert → header `expected_at`
  (= earliest line date), so everything stays consistent and equals the MRP
  report's order-by hint (no double-deduction).
- This single point covers BOTH the MRP "Proceed PO" (new POs) and the picker
  "Convert from SO / Add Line Item" (same handler with `targetPoId`).
- The separate whole-SO `POST /:id/convert-from-so` path does NOT derive a
  delivery date from the SO (leaves it null), so there is nothing to deduct
  there — left unchanged.

### B. Frontend — maintenance on the MRP page (`Mrp.tsx`)
- Self-contained `LeadTimesDialog` (reuses `useCategoryLeadTimes` /
  `useUpdateCategoryLeadTime`), opened by an admin-gated "Lead Times" toolbar
  button next to Re-bind WH. Shows the four orderable categories (sofa /
  bedframe / mattress / accessory; Service excluded, mirroring the MRP tabs),
  each an Edit→Save day input. No naked edit.
- Removed `LeadTimesSection` + its usage + its import from
  `SalesOrderMaintenance.tsx`.

## Edge cases
- lead 0 → unchanged (current behaviour preserved).
- null delivery date → stays null (no buffer possible).
- Calendar days (UTC), not business days.

## Out of scope / caveats
- A SO that is past its processing-date lock cannot have its delivery date
  edited (by design); unrelated to this change.
- `service` lead time stays in the config (default 0), just not shown on MRP.

## Verification
typecheck + test + lint (no new errors) → merge to main → CF deploy → live check
(set a lead day, Proceed a PO, confirm PO delivery date = customer date − days).
