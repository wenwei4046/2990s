import { describe, expect, it, vi } from 'vitest';

// pos-handover-so pulls in apiClient -> the supabase singleton, which reads
// VITE_SUPABASE_URL/KEY at module load. Mocked so the pure helpers under test
// import in a bare vitest env (same posture as pos-handover-so.test.ts).
vi.mock('./supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));

import {
  readMoney,
  readMoneyMyr,
  readMoneyOrNull,
  readPaidTotal,
  senToMyr,
} from './houzs-money-keys';
import { soMoneyPayload, readSoMoney } from './pos-handover-so';

/* The regression these guard is SILENT: Houzs migration 0305 renamed every
   `_centi` money key to `_sen`, an absent key reads as `undefined`, and every
   affected number quietly became 0. Nothing threw. So the assertions below are
   deliberately about the FALLBACK and the PAIR, not about arithmetic. */

describe('reading a money field under either spelling', () => {
  it('prefers the canonical _sen', () => {
    expect(readMoney({ total_sen: 299000, total_centi: 1 }, 'total')).toBe(299000);
  });

  it('falls back to _centi when only the legacy key is served', () => {
    // 2990's own API — still the target in local dev — never migrated.
    expect(readMoney({ total_centi: 299000 }, 'total')).toBe(299000);
  });

  it('does NOT convert: the two spellings are the same unit', () => {
    const sen = readMoney({ total_sen: 299000 }, 'total');
    const centi = readMoney({ total_centi: 299000 }, 'total');
    expect(sen).toBe(centi);
  });

  it('reads a genuine zero as zero, not as missing', () => {
    expect(readMoneyOrNull({ discount_sen: 0 }, 'discount')).toBe(0);
  });

  it('distinguishes absent from zero', () => {
    expect(readMoneyOrNull({}, 'discount')).toBeNull();
    expect(readMoney({}, 'discount')).toBe(0);
  });

  it('ignores a non-numeric value under either key', () => {
    expect(readMoneyOrNull({ total_sen: '299000' }, 'total')).toBeNull();
    expect(readMoneyOrNull({ total_sen: null, total_centi: 5 }, 'total')).toBe(5);
  });

  it('survives a null or undefined row', () => {
    expect(readMoney(null, 'total')).toBe(0);
    expect(readMoney(undefined, 'total')).toBe(0);
  });

  it('converts sen to whole ringgit for display', () => {
    expect(senToMyr(299000)).toBe(2990);
    expect(readMoneyMyr({ total_revenue_sen: 299000 }, 'total_revenue')).toBe(2990);
    expect(readMoneyMyr({ total_revenue_centi: 299000 }, 'total_revenue')).toBe(2990);
  });
});

describe('readPaidTotal — the rollup whose suffix sits in the middle', () => {
  it('prefers the renamed rollup', () => {
    expect(readPaidTotal({ paid_sen_total: 50000, paid_centi_total: 1 })).toBe(50000);
  });

  it('falls back to the legacy rollup spelling', () => {
    expect(readPaidTotal({ paid_centi_total: 50000 })).toBe(50000);
  });

  it('falls through the rollup to the header column, then the deposit', () => {
    expect(readPaidTotal({ paid_sen: 30000 })).toBe(30000);
    expect(readPaidTotal({ deposit_sen: 20000 })).toBe(20000);
    // A rollup of 0 is a real answer — an SO with nothing paid yet — and must
    // NOT fall through to the deposit.
    expect(readPaidTotal({ paid_sen_total: 0, deposit_sen: 20000 })).toBe(0);
  });

  it('is 0 when the header carries no payment information at all', () => {
    expect(readPaidTotal({})).toBe(0);
  });
});

describe('soMoneyPayload — the write half', () => {
  it('emits BOTH spellings, never one', () => {
    expect(soMoneyPayload('unitPrice', 299000)).toEqual({
      unitPriceCenti: 299000,
      unitPriceSen: 299000,
    });
  });

  it('carries the identical amount under both keys', () => {
    const p = soMoneyPayload('discount', 50000);
    expect(p.discountSen).toBe(p.discountCenti);
  });

  it('sends an explicit zero rather than omitting the key', () => {
    // Houzs reads `Number(it.discountSen ?? 0)`, so an omitted key and a zero
    // agree here — but the drift gate reads a MISSING unit price as "not
    // provided" and substitutes its own recompute. Always send the number.
    expect(soMoneyPayload('discount', 0)).toEqual({
      discountCenti: 0,
      discountSen: 0,
    });
  });

  it('round-trips through readSoMoney under either spelling', () => {
    expect(readSoMoney(soMoneyPayload('deposit', 12345), 'deposit')).toBe(12345);
    expect(readSoMoney({ depositCenti: 12345 }, 'deposit')).toBe(12345);
    expect(readSoMoney({}, 'deposit')).toBe(0);
  });
});
