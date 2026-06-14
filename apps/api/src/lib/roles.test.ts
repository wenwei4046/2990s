import { describe, it, expect } from 'vitest';
import { canViewAllSales, isSelfScopedSales, ALL_SALES_VIEWER_ROLES } from './roles';

describe('ALL_SALES_VIEWER_ROLES', () => {
  it('is exactly super_admin, sales_director, outlet_manager', () => {
    expect(ALL_SALES_VIEWER_ROLES).toEqual(['super_admin', 'sales_director', 'outlet_manager']);
  });
});

describe('canViewAllSales', () => {
  it.each(['super_admin', 'sales_director', 'outlet_manager'])('true for %s', (r) => {
    expect(canViewAllSales(r)).toBe(true);
  });
  it.each(['sales', 'sales_executive', 'admin', 'coordinator', 'finance', 'showroom_lead', 'master_account', 'unknown'])(
    'false for %s',
    (r) => {
      expect(canViewAllSales(r)).toBe(false);
    },
  );
  it('false for null/undefined/empty', () => {
    expect(canViewAllSales(null)).toBe(false);
    expect(canViewAllSales(undefined)).toBe(false);
    expect(canViewAllSales('')).toBe(false);
  });
});

describe('isSelfScopedSales', () => {
  it.each(['sales', 'sales_executive'])('true for %s', (r) => {
    expect(isSelfScopedSales(r)).toBe(true);
  });
  it.each(['outlet_manager', 'sales_director', 'super_admin', 'admin', 'coordinator', 'finance', 'master_account'])(
    'false for %s',
    (r) => {
      expect(isSelfScopedSales(r)).toBe(false);
    },
  );
  it('false for null/undefined/empty', () => {
    expect(isSelfScopedSales(null)).toBe(false);
    expect(isSelfScopedSales(undefined)).toBe(false);
    expect(isSelfScopedSales('')).toBe(false);
  });
});
