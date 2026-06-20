// Unit tests for pwp-claim-single.ts — pure-eligibility branches only.
//
// The DB-dependent paths (orphaned-USED check, already-on-order check, atomic
// claim UPDATE, rollback UPDATE) are integration-layer and require a live
// Supabase connection. They are documented as integration-gap below; they are
// not faked with mocks because the task brief explicitly says
// "do NOT fake DB results".
//
// What IS tested here:
//   • qty !== 1  → rejection `a PWP reward line must be quantity 1`
//   • null codeRow → `code not found …`
//   • alreadyOnOrder=true → `code is already applied to another line on this order`
//   • status USED (not orphaned) → `code already used …`
//   • status RESERVED (different owner) → `code is reserved by another salesperson`
//   • unknown status → `code is not redeemable (…)`
//   • reward_category mismatch → `code rewards X, not this item`
//   • customer_id mismatch for AVAILABLE code → `code belongs to a different customer`
//   • model not in eligible_reward_model_ids → `code is not valid for this model`
//   • isPromo=false and pwp_price_sen=0 → `this SKU has no PWP price set (SKU Master)`
//   • sofa: no reward_combo_ids → `voucher has no reward combos`
//   • sofa: empty sofaModules → `sofa line carries no build modules`
//   • sofa: modules don't match any combo → `sofa build doesn't match …`
//   • happy path non-sofa (promo) → ok, grantPwpPrice=0
//   • happy path non-sofa (pwp, price>0) → ok, grantPwpPrice=price
//   • happy path sofa (module match) → ok, grantSofaComboIds set
//   • orphaned-USED code treated as redeemable → ok
//   • RESERVED by same owner → ok

import { describe, it, expect } from 'vitest';
import {
  checkPwpEligibility,
  codeAlreadyOnOrder,
  type PwpCodeRow,
  type PureEligibilityArgs,
} from './pwp-claim-single';
import type { SofaComboRow } from '@2990s/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OWNER_ID = 'staff-abc';
const CUSTOMER_ID = 'cust-111';
const MODEL_ID = 'model-mmm';
const COMBO_ID = 'combo-ccc';

function makeCodeRow(overrides: Partial<PwpCodeRow> = {}): PwpCodeRow {
  return {
    code: 'TEST-CODE',
    status: 'AVAILABLE',
    owner_staff_id: null,
    reward_category: 'MATTRESS',
    eligible_reward_model_ids: null,      // null = no restriction
    reward_combo_ids: null,
    reward_size_codes: null,              // null = no size refinement
    reward_compartments: null,
    customer_id: null,
    source_doc_no: null,
    redeemed_doc_no: null,
    type: 'pwp',
    ...overrides,
  };
}

function makeProduct(overrides: Partial<PureEligibilityArgs['product']> = {}): PureEligibilityArgs['product'] {
  return {
    category: 'MATTRESS',
    model_id: MODEL_ID,
    base_model: null,
    pwp_price_sen: 150000,
    ...overrides,
  };
}

function baseArgs(overrides: Partial<PureEligibilityArgs> = {}): PureEligibilityArgs {
  return {
    codeRow: makeCodeRow(),
    product: makeProduct(),
    customerId: null,
    ownerStaffId: OWNER_ID,
    qty: 1,
    isOrphanedUsed: false,
    alreadyOnOrder: false,
    sofaCombos: [],
    sofaModules: [],
    ...overrides,
  };
}

function makeCombo(moduleIds: string[][]): SofaComboRow {
  return {
    id: COMBO_ID,
    baseModel: 'ANNSA',
    modules: moduleIds,
    tier: null,
    customerId: null,
    pricesByHeight: {},
    pwpPricesByHeight: {},
    label: null,
    effectiveFrom: '2026-01-01',
    deletedAt: null,
    defaultFreeGifts: [],
  };
}

// ---------------------------------------------------------------------------
// reward refinement (0182) — size_codes / compartments snapshot on the code
// ---------------------------------------------------------------------------

describe('checkPwpEligibility — reward refinement (0182)', () => {
  it('no refinement on the code → any size passes', () => {
    expect(checkPwpEligibility(baseArgs({ product: makeProduct({ size_code: 'K' }) })).ok).toBe(true);
  });
  it('non-sofa reward_size_codes gates by the reward SKU size_code', () => {
    const codeRow = makeCodeRow({ reward_size_codes: ['Q'] });
    expect(checkPwpEligibility(baseArgs({ codeRow, product: makeProduct({ size_code: 'Q' }) })).ok).toBe(true);
    expect(checkPwpEligibility(baseArgs({ codeRow, product: makeProduct({ size_code: 'K' }) })).ok).toBe(false);
  });
  it('sofa reward_compartments gates by the built modules', () => {
    const codeRow = makeCodeRow({
      reward_category: 'SOFA', reward_combo_ids: [COMBO_ID], reward_compartments: ['CNR'],
    });
    const product = makeProduct({ category: 'SOFA', base_model: 'ANNSA' });
    const sofaCombos = [makeCombo([['2A'], ['CNR']])];
    expect(checkPwpEligibility(baseArgs({ codeRow, product, sofaCombos, sofaModules: ['2A', 'CNR'] })).ok).toBe(true);
    const codeRecliner = makeCodeRow({
      reward_category: 'SOFA', reward_combo_ids: [COMBO_ID], reward_compartments: ['RECLINER'],
    });
    expect(checkPwpEligibility(baseArgs({ codeRow: codeRecliner, product, sofaCombos, sofaModules: ['2A', 'CNR'] })).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// qty check
// ---------------------------------------------------------------------------

describe('checkPwpEligibility — qty', () => {
  it('rejects qty !== 1', () => {
    const result = checkPwpEligibility(baseArgs({ qty: 2 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('a PWP reward line must be quantity 1');
    }
  });

  it('rejects qty 0', () => {
    const result = checkPwpEligibility(baseArgs({ qty: 0 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('quantity 1');
    }
  });

  it('accepts qty 1', () => {
    const result = checkPwpEligibility(baseArgs({ qty: 1 }));
    // May still fail for other reasons (category etc.) — but NOT for qty.
    if (!result.ok) {
      expect(result.reason).not.toContain('quantity 1');
    }
  });
});

// ---------------------------------------------------------------------------
// Missing code row
// ---------------------------------------------------------------------------

describe('checkPwpEligibility — missing code row', () => {
  it('rejects null codeRow', () => {
    const result = checkPwpEligibility(baseArgs({ codeRow: null }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/code not found/);
    }
  });
});

// ---------------------------------------------------------------------------
// Already on this order (add-line only rule)
// ---------------------------------------------------------------------------

describe('checkPwpEligibility — alreadyOnOrder', () => {
  it('rejects code already claimed on another line of the same order', () => {
    const result = checkPwpEligibility(baseArgs({ alreadyOnOrder: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('already applied to another line on this order');
    }
  });
});

// ---------------------------------------------------------------------------
// Status checks
// ---------------------------------------------------------------------------

describe('checkPwpEligibility — status', () => {
  it('rejects USED (non-orphan) with redeemed_doc_no', () => {
    const result = checkPwpEligibility(baseArgs({
      codeRow: makeCodeRow({ status: 'USED', redeemed_doc_no: 'SO-1234' }),
      isOrphanedUsed: false,
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/code already used on SO-1234/);
    }
  });

  it('rejects USED (non-orphan) without redeemed_doc_no', () => {
    const result = checkPwpEligibility(baseArgs({
      codeRow: makeCodeRow({ status: 'USED', redeemed_doc_no: null }),
      isOrphanedUsed: false,
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('code already used');
    }
  });

  it('rejects RESERVED by a different owner', () => {
    const result = checkPwpEligibility(baseArgs({
      codeRow: makeCodeRow({ status: 'RESERVED', owner_staff_id: 'other-staff' }),
      ownerStaffId: OWNER_ID,
      isOrphanedUsed: false,
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('code is reserved by another salesperson');
    }
  });

  it('accepts RESERVED by the same owner', () => {
    const result = checkPwpEligibility(baseArgs({
      codeRow: makeCodeRow({ status: 'RESERVED', owner_staff_id: OWNER_ID }),
      ownerStaffId: OWNER_ID,
      isOrphanedUsed: false,
    }));
    // Proceeds past status check — succeeds for MATTRESS with open eligibility.
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown status', () => {
    const result = checkPwpEligibility(baseArgs({
      codeRow: makeCodeRow({ status: 'PENDING' }),
      isOrphanedUsed: false,
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('code is not redeemable');
      expect(result.reason).toContain('PENDING');
    }
  });

  it('treats orphaned-USED as redeemable (self-heal)', () => {
    const result = checkPwpEligibility(baseArgs({
      codeRow: makeCodeRow({ status: 'USED', redeemed_doc_no: 'SO-DEAD' }),
      isOrphanedUsed: true,
    }));
    // Proceeds past status; succeeds on MATTRESS with open eligibility.
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Category mismatch
// ---------------------------------------------------------------------------

describe('checkPwpEligibility — category', () => {
  it('rejects when product category does not match reward_category', () => {
    const result = checkPwpEligibility(baseArgs({
      product: makeProduct({ category: 'BEDFRAME' }),
      codeRow: makeCodeRow({ reward_category: 'MATTRESS' }),
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/code rewards MATTRESS, not this item/);
    }
  });

  it('accepts matching category (case-insensitive)', () => {
    const result = checkPwpEligibility(baseArgs({
      product: makeProduct({ category: 'mattress' }),
      codeRow: makeCodeRow({ reward_category: 'MATTRESS' }),
    }));
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Customer binding
// ---------------------------------------------------------------------------

describe('checkPwpEligibility — customer binding', () => {
  it('rejects AVAILABLE code bound to a different customer', () => {
    const result = checkPwpEligibility(baseArgs({
      codeRow: makeCodeRow({ status: 'AVAILABLE', customer_id: 'cust-AAA' }),
      customerId: 'cust-BBB',
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('code belongs to a different customer');
    }
  });

  it('accepts AVAILABLE code bound to same customer', () => {
    const result = checkPwpEligibility(baseArgs({
      codeRow: makeCodeRow({ status: 'AVAILABLE', customer_id: CUSTOMER_ID }),
      customerId: CUSTOMER_ID,
    }));
    expect(result.ok).toBe(true);
  });

  it('accepts AVAILABLE code with null customer_id (no binding)', () => {
    const result = checkPwpEligibility(baseArgs({
      codeRow: makeCodeRow({ status: 'AVAILABLE', customer_id: null }),
      customerId: CUSTOMER_ID,
    }));
    expect(result.ok).toBe(true);
  });

  it('accepts AVAILABLE code when order has no resolved customer', () => {
    const result = checkPwpEligibility(baseArgs({
      codeRow: makeCodeRow({ status: 'AVAILABLE', customer_id: 'cust-AAA' }),
      customerId: null,
    }));
    // create loop only rejects when BOTH sides are non-null
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Model eligibility (non-sofa)
// ---------------------------------------------------------------------------

describe('checkPwpEligibility — model eligibility', () => {
  it('rejects when model not in eligible_reward_model_ids', () => {
    const result = checkPwpEligibility(baseArgs({
      product: makeProduct({ model_id: 'model-ZZZ' }),
      codeRow: makeCodeRow({ eligible_reward_model_ids: ['model-AAA', 'model-BBB'] }),
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('code is not valid for this model');
    }
  });

  it('accepts when model is in eligible_reward_model_ids', () => {
    const result = checkPwpEligibility(baseArgs({
      product: makeProduct({ model_id: MODEL_ID }),
      codeRow: makeCodeRow({ eligible_reward_model_ids: [MODEL_ID, 'other-model'] }),
    }));
    expect(result.ok).toBe(true);
  });

  it('accepts when eligible_reward_model_ids is empty (no restriction)', () => {
    const result = checkPwpEligibility(baseArgs({
      product: makeProduct({ model_id: MODEL_ID }),
      codeRow: makeCodeRow({ eligible_reward_model_ids: [] }),
    }));
    expect(result.ok).toBe(true);
  });

  it('accepts when eligible_reward_model_ids is null (no restriction)', () => {
    const result = checkPwpEligibility(baseArgs({
      product: makeProduct({ model_id: MODEL_ID }),
      codeRow: makeCodeRow({ eligible_reward_model_ids: null }),
    }));
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PWP price check (non-sofa, type='pwp')
// ---------------------------------------------------------------------------

describe('checkPwpEligibility — pwp price (non-sofa)', () => {
  it('rejects pwp code when pwp_price_sen is 0', () => {
    const result = checkPwpEligibility(baseArgs({
      product: makeProduct({ pwp_price_sen: 0 }),
      codeRow: makeCodeRow({ type: 'pwp' }),
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('no PWP price set');
    }
  });

  it('rejects pwp code when pwp_price_sen is null', () => {
    const result = checkPwpEligibility(baseArgs({
      product: makeProduct({ pwp_price_sen: null }),
      codeRow: makeCodeRow({ type: 'pwp' }),
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('no PWP price set');
    }
  });

  it('accepts pwp code when pwp_price_sen > 0', () => {
    const result = checkPwpEligibility(baseArgs({
      product: makeProduct({ pwp_price_sen: 99900 }),
      codeRow: makeCodeRow({ type: 'pwp' }),
    }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.grantPwpPrice).toBe(99900);
      expect(result.grantSofaComboIds).toBeNull();
    }
  });

  it('accepts promo code when pwp_price_sen is 0 (free)', () => {
    const result = checkPwpEligibility(baseArgs({
      product: makeProduct({ pwp_price_sen: 0 }),
      codeRow: makeCodeRow({ type: 'promo' }),
    }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.grantPwpPrice).toBe(0);
    }
  });

  it('returns rounded grantPwpPrice', () => {
    const result = checkPwpEligibility(baseArgs({
      product: makeProduct({ pwp_price_sen: 150000 }),
      codeRow: makeCodeRow({ type: 'pwp' }),
    }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.grantPwpPrice).toBe(150000);
    }
  });
});

// ---------------------------------------------------------------------------
// Sofa reward path
// ---------------------------------------------------------------------------

describe('checkPwpEligibility — sofa reward', () => {
  const sofaProduct = makeProduct({ category: 'SOFA', base_model: 'ANNSA', pwp_price_sen: null });
  const sofaCodeRow = makeCodeRow({
    reward_category: 'SOFA',
    reward_combo_ids: [COMBO_ID],
    eligible_reward_model_ids: null,
    type: 'pwp',
  });

  it('rejects when reward_combo_ids is empty', () => {
    const result = checkPwpEligibility(baseArgs({
      product: sofaProduct,
      codeRow: makeCodeRow({ reward_category: 'SOFA', reward_combo_ids: [] }),
      sofaModules: ['mod-1A', 'mod-2A'],
      sofaCombos: [makeCombo([['mod-1A', 'mod-2A']])],
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('voucher has no reward combos');
    }
  });

  it('rejects when sofaModules is empty (no build)', () => {
    const result = checkPwpEligibility(baseArgs({
      product: sofaProduct,
      codeRow: sofaCodeRow,
      sofaModules: [],
      sofaCombos: [makeCombo([['mod-1A', 'mod-2A']])],
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('sofa line carries no build modules');
    }
  });

  it("rejects when sofa modules don't match any reward combo", () => {
    const result = checkPwpEligibility(baseArgs({
      product: sofaProduct,
      codeRow: sofaCodeRow,
      sofaModules: ['mod-3S'],
      sofaCombos: [makeCombo([['mod-1A', 'mod-2A']])],
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("sofa build doesn't match the voucher's reward combo");
    }
  });

  it('accepts when sofa modules match a reward combo', () => {
    // matchComboSubset checks if built is a SUBSET of one combo's modules slot.
    // Create a simple case: combo has exactly the built modules.
    const result = checkPwpEligibility(baseArgs({
      product: makeProduct({ category: 'SOFA', base_model: null, pwp_price_sen: null }),
      codeRow: sofaCodeRow,
      sofaModules: ['mod-1A', 'mod-2A'],
      sofaCombos: [makeCombo([['mod-1A', 'mod-2A']])],
    }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.grantSofaComboIds).toEqual([COMBO_ID]);
      expect(result.grantPwpPrice).toBe(0);
    }
  });

  it('rejects when base_model does not match combo base_model', () => {
    const combo = { ...makeCombo([['mod-1A', 'mod-2A']]), baseModel: 'TELLUC' };
    const result = checkPwpEligibility(baseArgs({
      product: makeProduct({ category: 'SOFA', base_model: 'ANNSA', pwp_price_sen: null }),
      codeRow: sofaCodeRow,
      sofaModules: ['mod-1A', 'mod-2A'],
      sofaCombos: [combo],
    }));
    // base_model filter excludes the only combo → no match.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("sofa build doesn't match");
    }
  });
});

// ---------------------------------------------------------------------------
// codeAlreadyOnOrder — pure helper for the already-on-order guard
// ---------------------------------------------------------------------------

describe('codeAlreadyOnOrder', () => {
  it('returns false for null rows', () => {
    expect(codeAlreadyOnOrder(null, 'ABC-123')).toBe(false);
  });

  it('returns false for empty rows array', () => {
    expect(codeAlreadyOnOrder([], 'ABC-123')).toBe(false);
  });

  it('returns false when no row has variants.pwpCode', () => {
    const rows = [
      { variants: { otherKey: 'ABC-123' } },
      { variants: null },
      { variants: 42 },
    ];
    expect(codeAlreadyOnOrder(rows, 'ABC-123')).toBe(false);
  });

  it('returns true when a row variants.pwpCode matches exactly', () => {
    const rows = [
      { variants: { pwpCode: 'OTHER-CODE' } },
      { variants: { pwpCode: 'ABC-123' } },
    ];
    expect(codeAlreadyOnOrder(rows, 'ABC-123')).toBe(true);
  });

  it('returns false when no row matches the code', () => {
    const rows = [
      { variants: { pwpCode: 'OTHER-CODE' } },
      { variants: { pwpCode: 'YET-ANOTHER' } },
    ];
    expect(codeAlreadyOnOrder(rows, 'ABC-123')).toBe(false);
  });

  it('trims whitespace on both sides before comparing', () => {
    const rows = [{ variants: { pwpCode: '  ABC-123  ' } }];
    expect(codeAlreadyOnOrder(rows, 'ABC-123')).toBe(true);
    expect(codeAlreadyOnOrder(rows, '  ABC-123  ')).toBe(true);
  });

  it('returns false when variants.pwpCode is not a string', () => {
    const rows = [
      { variants: { pwpCode: 123 } },
      { variants: { pwpCode: null } },
      { variants: { pwpCode: undefined } },
    ];
    expect(codeAlreadyOnOrder(rows, '123')).toBe(false);
  });

  it('non-pwp rows (no pwpCode key) are ignored', () => {
    const rows = [
      { variants: { itemGroup: 'mattress', size: 'Queen' } },
    ];
    expect(codeAlreadyOnOrder(rows, 'ABC-123')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Customer binding — orphaned-USED must NOT apply customer check (mirrors create)
// ---------------------------------------------------------------------------

describe('checkPwpEligibility — customer binding: orphaned-USED skips customer check', () => {
  it('does NOT reject an orphaned-USED code belonging to a different customer', () => {
    // Create path gates customer check on `cRow.status === 'AVAILABLE'` only.
    // An orphaned-USED self-heal must bypass the customer check — otherwise
    // a stuck code with customer_id would never recover for a different customer order.
    const result = checkPwpEligibility(baseArgs({
      codeRow: makeCodeRow({
        status: 'USED',
        redeemed_doc_no: 'SO-DEAD',
        customer_id: 'cust-ORIGINAL',
      }),
      customerId: 'cust-DIFFERENT',
      isOrphanedUsed: true,
    }));
    // Should not be rejected on customer grounds — may succeed or fail for
    // other reasons, but the reason must NOT mention customer binding.
    if (!result.ok) {
      expect(result.reason).not.toBe('code belongs to a different customer');
    }
    // In the MATTRESS happy path (baseArgs defaults) this should succeed.
    expect(result.ok).toBe(true);
  });

  it('still rejects an AVAILABLE code belonging to a different customer', () => {
    // Ensure the fix didn't regress the AVAILABLE customer check.
    const result = checkPwpEligibility(baseArgs({
      codeRow: makeCodeRow({ status: 'AVAILABLE', customer_id: 'cust-ORIGINAL' }),
      customerId: 'cust-DIFFERENT',
      isOrphanedUsed: false,
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('code belongs to a different customer');
    }
  });
});

// ---------------------------------------------------------------------------
// Integration-gap documentation (not tested — requires live DB)
// ---------------------------------------------------------------------------
//
// The following paths in claimPwpForSingleLine are NOT covered by unit tests
// because they make real Supabase queries and the brief says "do NOT fake DB
// results":
//
//   • Fetching the pwp_codes row (SELECT by code) — happy path + fetch error.
//   • Checking mfg_sales_order_items.redeemed_item_code for already-on-order.
//   • Orphaned-USED check: SELECT mfg_sales_orders WHERE doc_no = redeemed_doc_no.
//   • Loading sofa_combo_pricing for SOFA reward path (live combos).
//   • Atomic claim: UPDATE pwp_codes WHERE code=? AND status=? → maybeSingle().
//   • rollbackSinglePwpClaim: UPDATE pwp_codes WHERE code=? AND status='USED'.
//
// These should be covered by an integration test against a seeded test branch
// (e.g., Supabase branch `test-pwp-claim`) once the harness is set up.
//
// ---------------------------------------------------------------------------
