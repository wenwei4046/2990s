import { describe, it, expect } from 'vitest';
import {
  SERVICE_DELIVERY_FEE_CODES,
  SERVICE_EXECUTION_CODES,
  isServiceItemGroup,
  isServiceCategory,
  isServiceSkuCode,
  isServiceLine,
  isDeliveryFeeServiceCode,
  isExecutionServiceCode,
} from './service-sku';

describe('isServiceItemGroup', () => {
  it('matches the canonical lowercase value SoLineCard writes', () => {
    expect(isServiceItemGroup('service')).toBe(true);
  });
  it('matches any casing / padding', () => {
    expect(isServiceItemGroup('SERVICE')).toBe(true);
    expect(isServiceItemGroup('  Service ')).toBe(true);
  });
  it('rejects the five goods groups and empties', () => {
    for (const g of ['sofa', 'bedframe', 'mattress', 'accessory', 'others']) {
      expect(isServiceItemGroup(g)).toBe(false);
    }
    expect(isServiceItemGroup('')).toBe(false);
    expect(isServiceItemGroup(null)).toBe(false);
    expect(isServiceItemGroup(undefined)).toBe(false);
  });
});

describe('isServiceCategory', () => {
  it('matches the mfg_product_category enum value exactly (any casing)', () => {
    expect(isServiceCategory('SERVICE')).toBe(true);
    expect(isServiceCategory('service')).toBe(true);
  });
  it('rejects other categories and empties', () => {
    for (const c of ['SOFA', 'BEDFRAME', 'MATTRESS', 'ACCESSORY']) {
      expect(isServiceCategory(c)).toBe(false);
    }
    expect(isServiceCategory(null)).toBe(false);
    expect(isServiceCategory(undefined)).toBe(false);
  });
});

describe('isServiceSkuCode', () => {
  it('matches every seeded SVC-* code', () => {
    for (const code of [...SERVICE_DELIVERY_FEE_CODES, ...SERVICE_EXECUTION_CODES]) {
      expect(isServiceSkuCode(code)).toBe(true);
    }
  });
  it('is case/padding insensitive', () => {
    expect(isServiceSkuCode(' svc-delivery ')).toBe(true);
  });
  it('rejects product SKUs, the bare prefix, and empties', () => {
    expect(isServiceSkuCode('ANNSA-1A(LHF)')).toBe(false);
    expect(isServiceSkuCode('KHL35')).toBe(false);
    // A bare 'SVC-' is a typo, not a SERVICE SKU.
    expect(isServiceSkuCode('SVC-')).toBe(false);
    expect(isServiceSkuCode('')).toBe(false);
    expect(isServiceSkuCode(null)).toBe(false);
    expect(isServiceSkuCode(undefined)).toBe(false);
  });
  it('does not match SVC appearing mid-code', () => {
    expect(isServiceSkuCode('XSVC-DELIVERY')).toBe(false);
  });
});

describe('isServiceLine — OR of the three signals', () => {
  it('fires on item_group alone', () => {
    expect(isServiceLine({ itemGroup: 'service', itemCode: 'WEIRD-CODE' })).toBe(true);
  });
  it('fires on code prefix alone', () => {
    expect(isServiceLine({ itemGroup: 'others', itemCode: 'SVC-DELIVERY' })).toBe(true);
  });
  it('fires on catalog category alone', () => {
    expect(isServiceLine({ itemGroup: 'others', itemCode: 'INSTALL-FEE', category: 'SERVICE' })).toBe(true);
  });
  it('stays false for ordinary goods lines', () => {
    expect(isServiceLine({ itemGroup: 'sofa', itemCode: 'ANNSA-1A(LHF)', category: 'SOFA' })).toBe(false);
    expect(isServiceLine({ itemGroup: 'mattress', itemCode: 'M2990-SOFT-Q' })).toBe(false);
    expect(isServiceLine({})).toBe(false);
  });
});

describe('fee vs execution classification (D2 — driver work vs money line)', () => {
  it('classifies all three delivery-fee codes as fee, not execution', () => {
    for (const code of SERVICE_DELIVERY_FEE_CODES) {
      expect(isDeliveryFeeServiceCode(code)).toBe(true);
      expect(isExecutionServiceCode(code)).toBe(false);
    }
  });
  it('classifies dispose/lift as execution, not fee', () => {
    for (const code of SERVICE_EXECUTION_CODES) {
      expect(isExecutionServiceCode(code)).toBe(true);
      expect(isDeliveryFeeServiceCode(code)).toBe(false);
    }
  });
  it('future fee variants under the SVC-DELIVERY prefix classify as fee', () => {
    expect(isDeliveryFeeServiceCode('SVC-DELIVERY-EAST-MY')).toBe(true);
    expect(isExecutionServiceCode('SVC-DELIVERY-EAST-MY')).toBe(false);
  });
  it('non-service codes are neither', () => {
    expect(isDeliveryFeeServiceCode('ANNSA-1A(LHF)')).toBe(false);
    expect(isExecutionServiceCode('ANNSA-1A(LHF)')).toBe(false);
  });
});
