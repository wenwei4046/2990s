import { describe, it, expect } from 'vitest';
import { orderV1PostSchema } from './order-v1.schema';

const base = {
  customer: { name: 'Tan Wei Ming' },
  lines: [{ qty: 1, config: { kind: 'flat' as const, productId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } }],
  clientTotal: 5980,
};

describe('orderV1PostSchema installmentMonths', () => {
  it('accepts an installment order with a 12-month term', () => {
    const r = orderV1PostSchema.safeParse({ ...base, paymentMethod: 'installment', installmentMonths: 12 });
    expect(r.success).toBe(true);
  });

  it('rejects an installment order with no term', () => {
    const r = orderV1PostSchema.safeParse({ ...base, paymentMethod: 'installment' });
    expect(r.success).toBe(false);
  });

  it('rejects an installment term that is not 6 or 12', () => {
    const r = orderV1PostSchema.safeParse({ ...base, paymentMethod: 'installment', installmentMonths: 24 });
    expect(r.success).toBe(false);
  });

  it('rejects a term on a non-installment order', () => {
    const r = orderV1PostSchema.safeParse({ ...base, paymentMethod: 'credit', installmentMonths: 6 });
    expect(r.success).toBe(false);
  });

  it('accepts a credit order with no term (null/omitted)', () => {
    expect(orderV1PostSchema.safeParse({ ...base, paymentMethod: 'credit' }).success).toBe(true);
    expect(orderV1PostSchema.safeParse({ ...base, paymentMethod: 'credit', installmentMonths: null }).success).toBe(true);
  });
});
