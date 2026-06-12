import { describe, it, expect } from 'vitest';
import {
  rangeForPreset, presetForRange, amountBadge, matchesSearch,
  methodLabel, methodDetail, initials,
} from './audit-log-view';
import type { AuditLogRow } from './audit-log-queries';

const FIXED = new Date('2026-05-23T08:00:00Z');

const row = (over: Partial<AuditLogRow> = {}): AuditLogRow => ({
  id: 'b1f5d0aa-0000-0000-0000-000000000001', docNo: 'SO-2057',
  placedAt: '2026-05-21T15:01:00Z', paidAt: '2026-05-21',
  customerName: 'Hafiz Rahman', customerPhone: '+60 11 998 7766',
  total: 6819, paid: 4466, isDeposit: false,
  paymentMethod: 'installment', installmentMonths: 12,
  approvalCode: 'CONTRACT-1', merchantProvider: null, slipKey: null, slipUploaded: false,
  venueName: 'Showroom KL', salespersonId: 'sp', staffId: 'st', ...over,
});

describe('rangeForPreset', () => {
  it('today is a single day', () => {
    expect(rangeForPreset('today', FIXED)).toEqual({ from: '2026-05-23', to: '2026-05-23' });
  });
  it('yesterday is the prior single day', () => {
    expect(rangeForPreset('yesterday', FIXED)).toEqual({ from: '2026-05-22', to: '2026-05-22' });
  });
  it('last7 / last30 / last90 span back from today', () => {
    expect(rangeForPreset('last7', FIXED)).toEqual({ from: '2026-05-17', to: '2026-05-23' });
    expect(rangeForPreset('last30', FIXED)).toEqual({ from: '2026-04-24', to: '2026-05-23' });
    expect(rangeForPreset('last90', FIXED)).toEqual({ from: '2026-02-23', to: '2026-05-23' });
  });
});

describe('presetForRange', () => {
  it('round-trips each preset', () => {
    for (const p of ['today','yesterday','last7','last30','last90'] as const) {
      const { from, to } = rangeForPreset(p, FIXED);
      expect(presetForRange(from, to, FIXED)).toBe(p);
    }
  });
  it('returns null for a custom range', () => {
    expect(presetForRange('2026-01-01', '2026-01-15', FIXED)).toBeNull();
  });
});

describe('amountBadge', () => {
  it('full when paid >= total', () => {
    expect(amountBadge(6819, 6819)).toEqual({ kind: 'full' });
    expect(amountBadge(7000, 6819)).toEqual({ kind: 'full' });
  });
  it('deposit with rounded percent otherwise', () => {
    expect(amountBadge(4466, 6819)).toEqual({ kind: 'deposit', pct: 65, total: 6819 });
  });
  it('full when total is zero (no divide-by-zero)', () => {
    expect(amountBadge(0, 0)).toEqual({ kind: 'full' });
  });
});

describe('matchesSearch', () => {
  it('empty query matches everything', () => { expect(matchesSearch(row(), '  ')).toBe(true); });
  it('matches SO#, customer, and approvalCode case-insensitively', () => {
    expect(matchesSearch(row(), 'so-2057')).toBe(true);
    expect(matchesSearch(row(), 'hafiz')).toBe(true);
    expect(matchesSearch(row(), 'contract-1')).toBe(true);
    expect(matchesSearch(row(), 'nope')).toBe(false);
  });
  it('does NOT match on the payment uuid (SO# is the search key)', () => {
    expect(matchesSearch(row(), 'b1f5d0aa')).toBe(false);
  });
});

describe('methodLabel + methodDetail', () => {
  it('labels the four live method codes from the shared vocabulary', () => {
    expect(methodLabel('installment')).toBe('Installment');
    expect(methodLabel('transfer')).toBe('Bank transfer / DuitNow');
    expect(methodLabel('merchant')).toBe('Merchant');
    expect(methodLabel('cash')).toBe('Cash');
  });
  it('falls back to the raw code for an unknown method', () => {
    expect(methodLabel('credit')).toBe('credit');
  });
  it('shows the term for installment and provider for merchant', () => {
    expect(methodDetail(row({ paymentMethod: 'installment', installmentMonths: 12 }))).toBe('12 months');
    expect(methodDetail(row({ paymentMethod: 'installment', installmentMonths: null }))).toBe('—');
    expect(methodDetail(row({ paymentMethod: 'merchant', merchantProvider: 'GHL' }))).toBe('GHL');
    expect(methodDetail(row({ paymentMethod: 'merchant', merchantProvider: null }))).toBe('—');
    expect(methodDetail(row({ paymentMethod: 'transfer' }))).toBeNull();
  });
});

describe('initials', () => {
  it('first+last initial', () => { expect(initials('Hafiz Rahman')).toBe('HR'); });
  it('single name → first two chars', () => { expect(initials('Cher')).toBe('CH'); });
  it('blank → ?', () => { expect(initials('   ')).toBe('?'); });
});
