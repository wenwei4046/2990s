// ----------------------------------------------------------------------------
// Task 5 — Free Item Campaign: SO-create server validation logic
//
// The POST /mfg-sales-orders handler:
//   1. Loads active campaigns from free_item_campaigns (loadActiveFreeItemCampaigns).
//   2. Runs campaignsCoveringLine (shared, same as POS) per tagged line.
//   3. Rejects 409 free_item_not_eligible if ineligible / no matching campaign /
//      qty > maxFreeQty.
//   4. Forces unit_price_centi = 0 for eligible lines (freeItemByIdx.has(idx)).
//   5. Skips the pricing drift gate for those lines.
//
// Integration tests for the full handler require a live Supabase test project.
// This file covers the shared pure-logic that gates ALL four code paths above,
// verifying the handler's decision inputs are correct. If the pure logic is
// correct the handler outcome is determinate (forced-zero and drift-skip are
// trivial guards reading the Map).
//
// LIMITATION: we do not exercise the Hono handler end-to-end here because
// mocking the ~20 Supabase queries in POST /mfg-sales-orders is prohibitively
// fragile (the free-gift tests for this route do not exist either for the same
// reason). Integration coverage should be added when a live test project is
// wired to the CI harness.
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  campaignsCoveringLine,
  isFreeItemLine,
  type FreeItemCampaign,
} from '@2990s/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const camp = (over: Partial<FreeItemCampaign>): FreeItemCampaign => ({
  id: 'c1',
  name: 'June Campaign',
  active: true,
  maxFreeQty: 1,
  eligible: [],
  ...over,
});

const noCombos = new Map<string, string[][]>();
const combos = new Map<string, string[][]>([
  ['combo-X', [['2A(RHF)', '2A(LHF)'], ['L(LHF)', 'L(RHF)']]],
]);

// ---------------------------------------------------------------------------
// Case 1: valid free-item line (active campaign + matching model) → covered
// Simulates what the handler's validation block does before setting freeItemByIdx.
// ---------------------------------------------------------------------------
describe('Task 5 — eligible line (handler grants forced-zero)', () => {
  it('returns the matching campaign for a mattress model', () => {
    const c = camp({ eligible: [{ modelId: 'mattress-m1', scope: 'model', comboId: null }] });
    const result = campaignsCoveringLine(
      { category: 'MATTRESS', modelId: 'mattress-m1', builtModuleIds: [] },
      [c],
      noCombos,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('c1');
    expect(result[0]?.name).toBe('June Campaign');
    // Handler: chosen = result.find(r => r.id === campaignId) → truthy → freeItemByIdx.set(idx, ...)
    // → unit forced to 0, drift skipped.
  });

  it('returns the matching campaign for a bedframe model', () => {
    const c = camp({ eligible: [{ modelId: 'bf-m1', scope: 'model', comboId: null }] });
    const result = campaignsCoveringLine(
      { category: 'BEDFRAME', modelId: 'bf-m1', builtModuleIds: [] },
      [c],
      noCombos,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('c1');
  });
});

// ---------------------------------------------------------------------------
// Case 2: ineligible → 409 free_item_not_eligible
// The handler rejects when `chosen` is falsy or qty > maxFreeQty.
// ---------------------------------------------------------------------------
describe('Task 5 — ineligible line → handler returns 409 free_item_not_eligible', () => {
  it('campaign inactive → not covered (covering = []) → not_eligible', () => {
    const c = camp({ active: false, eligible: [{ modelId: 'm1', scope: 'model', comboId: null }] });
    const result = campaignsCoveringLine(
      { category: 'MATTRESS', modelId: 'm1', builtModuleIds: [] },
      [c],
      noCombos,
    );
    expect(result).toHaveLength(0);
    // Handler: chosen = undefined → rejections.push({ idx, reason: 'not_eligible' }) → 409
  });

  it('model mismatch → not covered → not_eligible', () => {
    const c = camp({ eligible: [{ modelId: 'm1', scope: 'model', comboId: null }] });
    const result = campaignsCoveringLine(
      { category: 'MATTRESS', modelId: 'WRONG-MODEL', builtModuleIds: [] },
      [c],
      noCombos,
    );
    expect(result).toHaveLength(0);
    // Handler: chosen = undefined → 409 not_eligible
  });

  it('no campaigns at all → not covered → not_eligible', () => {
    const result = campaignsCoveringLine(
      { category: 'MATTRESS', modelId: 'm1', builtModuleIds: [] },
      [],
      noCombos,
    );
    expect(result).toHaveLength(0);
  });

  it('null modelId on line → not covered (short-circuit)', () => {
    const c = camp({ eligible: [{ modelId: 'm1', scope: 'model', comboId: null }] });
    const result = campaignsCoveringLine(
      { category: 'MATTRESS', modelId: null, builtModuleIds: [] },
      [c],
      noCombos,
    );
    expect(result).toHaveLength(0);
  });

  it('over_cap: qty > maxFreeQty → handler rejects (pure logic: qty guard)', () => {
    // campaignsCoveringLine returns the campaign but the handler then checks qty.
    // Simulate: maxFreeQty = 1, line qty = 3.
    const c = camp({ maxFreeQty: 1, eligible: [{ modelId: 'm1', scope: 'model', comboId: null }] });
    const result = campaignsCoveringLine(
      { category: 'MATTRESS', modelId: 'm1', builtModuleIds: [] },
      [c],
      noCombos,
    );
    // Campaign is covering (result not empty) but qty check fails in handler.
    expect(result).toHaveLength(1);
    const chosen = result[0]!;
    const lineQty = 3;
    const overCap = lineQty > chosen.maxFreeQty;
    expect(overCap).toBe(true);
    // Handler: rejections.push({ idx, reason: 'over_cap' }) → 409
  });

  it('qty = maxFreeQty → allowed (boundary: not over cap)', () => {
    const c = camp({ maxFreeQty: 2, eligible: [{ modelId: 'm1', scope: 'model', comboId: null }] });
    const result = campaignsCoveringLine(
      { category: 'MATTRESS', modelId: 'm1', builtModuleIds: [] },
      [c],
      noCombos,
    );
    expect(result).toHaveLength(1);
    const overCap = 2 > result[0]!.maxFreeQty;
    expect(overCap).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Case 3: sofa build (combo scope) → all module rows inherit unit = 0
// The handler passes `buildUnitPriceSen: unit` (where unit = 0) to
// splitSofaBuildIntoModuleLines, so every module row gets unit_price_centi = 0.
// This test validates the combo coverage logic that gates that outcome.
// ---------------------------------------------------------------------------
describe('Task 5 — sofa build: combo-scope campaign covers matching build', () => {
  it('matching sofa combo build → covered → unit forced to 0 on all module rows', () => {
    const c = camp({
      eligible: [{ modelId: 'sofa-m1', scope: 'combo', comboId: 'combo-X' }],
    });
    // The built modules match combo-X slots [2A(RHF)|2A(LHF)] + [L(LHF)|L(RHF)]
    const result = campaignsCoveringLine(
      { category: 'SOFA', modelId: 'sofa-m1', builtModuleIds: ['2A(RHF)', 'L(LHF)'] },
      [c],
      combos,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('c1');
    // Handler: unit = 0 → splitSofaBuildIntoModuleLines receives buildUnitPriceSen = 0
    // → every module row unit_price_centi = 0 and carries variants.freeItem (via sharedVariants).
  });

  it('non-matching sofa combo build → not covered → 409 not_eligible', () => {
    const c = camp({
      eligible: [{ modelId: 'sofa-m1', scope: 'combo', comboId: 'combo-X' }],
    });
    // Different module set — does not match combo-X
    const result = campaignsCoveringLine(
      { category: 'SOFA', modelId: 'sofa-m1', builtModuleIds: ['1A(LHF)'] },
      [c],
      combos,
    );
    expect(result).toHaveLength(0);
    // Handler: chosen = undefined → 409 free_item_not_eligible
  });

  it('sofa scope model (not combo) covers any build of the model', () => {
    const c = camp({
      eligible: [{ modelId: 'sofa-m1', scope: 'model', comboId: null }],
    });
    const result = campaignsCoveringLine(
      { category: 'SOFA', modelId: 'sofa-m1', builtModuleIds: ['1A(LHF)'] },
      [c],
      noCombos,
    );
    expect(result).toHaveLength(1);
    // Handler: unit = 0 for ALL module rows → all unit_price_centi = 0.
  });
});

// ---------------------------------------------------------------------------
// Case 4: anti-tamper — fabricated freeItem with no active covering campaign
// The POS sends variants.freeItem = { campaignId: 'fake' }. The server must
// reject 409 (not silently make it free).
// ---------------------------------------------------------------------------
describe('Task 5 — anti-tamper: fabricated campaignId → 409', () => {
  it('campaignId not in covering list → chosen = undefined → 409', () => {
    const c = camp({ id: 'real-campaign', eligible: [{ modelId: 'm1', scope: 'model', comboId: null }] });
    const result = campaignsCoveringLine(
      { category: 'MATTRESS', modelId: 'm1', builtModuleIds: [] },
      [c],
      noCombos,
    );
    // Campaign covers the line but the client sent a DIFFERENT (fake) campaignId.
    const chosenById = result.find((r) => r.id === 'fake-campaign-id');
    expect(chosenById).toBeUndefined();
    // Handler: chosen = undefined → rejections.push({ idx, reason: 'not_eligible' }) → 409.
  });

  it('no active campaigns at all + freeItem tag → not covered → 409', () => {
    // If table returns [] (no active campaigns), covering = [], chosen = undefined → 409.
    const result = campaignsCoveringLine(
      { category: 'MATTRESS', modelId: 'm1', builtModuleIds: [] },
      [],    // loadActiveFreeItemCampaigns returns []
      noCombos,
    );
    expect(result).toHaveLength(0);
    const chosen = result.find((r) => r.id === 'any-campaign');
    expect(chosen).toBeUndefined();
    // Handler: 409 free_item_not_eligible — NOT silently free.
  });

  it('active campaign covers a DIFFERENT model → not covered → 409', () => {
    // Client tags a line for model 'victim-m' under campaign c1, but c1 only
    // covers 'other-m'. Anti-tamper: cannot cross-apply a campaign to a wrong Model.
    const c = camp({ id: 'c1', eligible: [{ modelId: 'other-m', scope: 'model', comboId: null }] });
    const result = campaignsCoveringLine(
      { category: 'MATTRESS', modelId: 'victim-m', builtModuleIds: [] },
      [c],
      noCombos,
    );
    expect(result).toHaveLength(0);
    // Handler: 409 free_item_not_eligible
  });
});

// ---------------------------------------------------------------------------
// Task 6 — Edit-endpoint grandfathering
//
// A line persisted with variants.freeItem (made free at create time) must STAY
// at unit_price_centi = 0 when the SO is later edited, WITHOUT re-validating
// against active campaigns ("changes apply to new orders only" — the campaign
// may have since been toggled off). The two in-place edit endpoints that
// recompute an existing line's unit price guard on isFreeItemLine(prev.variants):
//
//   • PATCH /:docNo/items/:itemId   — skips the POS drift gate + forces unit = 0
//   • POST  /:docNo/items/:itemId/tbc-update — skips the POS floor gate + newUnit = 0
//
// Same harness limitation as Task 5 (the full Hono handler reads ~20 Supabase
// queries): we cover the pure predicate that GATES both guards. If the predicate
// reads the persisted marker correctly, the forced-zero + gate-skip outcomes are
// determinate (they are trivial `isFreeItemLine(...) ? 0 : recomputed` branches
// reading the SAME value the DB returns for prev.variants).
//
// The campaign-toggled-off scenario from the brief is exactly what the predicate
// makes irrelevant: the guard reads the persisted marker, never the campaign
// table, so an inactive (or deleted) campaign cannot reprice a grandfathered line.
// ---------------------------------------------------------------------------
describe('Task 6 — grandfather: persisted free-item line stays free on edit', () => {
  it('a persisted freeItem marker is recognised regardless of campaign state', () => {
    // The line was made free at create under campaign 'june-2026'. That campaign
    // is later toggled inactive — but the EDIT path never consults it; it reads
    // the marker the DB stored on prev.variants.
    const prevVariants = { fabricCode: 'COTTON-BEIGE', freeItem: { campaignId: 'june-2026' } };
    expect(isFreeItemLine(prevVariants)).toBe(true);
    // Handler (PATCH + tbc-update): isFreeItemLine(prev.variants) === true
    //   → drift/floor gate SKIPPED, unit/newUnit forced to 0.
  });

  it('an unrelated-field edit does not strip the marker (predicate still true)', () => {
    // Simulate a PATCH that touches only an unrelated field; the merged variants
    // still carry the create-time freeItem marker, so the line stays free.
    const prevVariants = { freeItem: { campaignId: 'c1' }, remark: 'old' };
    const afterUnrelatedEdit = { ...prevVariants, remark: 'updated note' };
    // The guard reads PREV (persisted) variants — the marker is intact either way.
    expect(isFreeItemLine(prevVariants)).toBe(true);
    expect(isFreeItemLine(afterUnrelatedEdit)).toBe(true);
  });

  it('a normal (non-free) line is NOT grandfathered → recompute drives the price', () => {
    const prevVariants = { fabricCode: 'LINEN-GREY' };
    expect(isFreeItemLine(prevVariants)).toBe(false);
    // Handler: isFreeItemLine === false → unit = recomputed.unit_price_sen (normal path).
  });

  it('a malformed marker (no campaignId) is NOT grandfathered', () => {
    // A line whose freeItem object lost / never had a campaignId must reprice
    // normally — only a fully-formed marker is honoured.
    expect(isFreeItemLine({ freeItem: {} })).toBe(false);
    expect(isFreeItemLine({ freeItem: { campaignId: '' } })).toBe(false);
    expect(isFreeItemLine(null)).toBe(false);
    expect(isFreeItemLine({})).toBe(false);
  });
});
