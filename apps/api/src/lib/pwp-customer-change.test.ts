import { describe, it, expect } from 'vitest';
import { classifyPwpVouchersForCustomerChange } from './pwp-customer-change';

const SO = 'SO-2606-004';

describe('classifyPwpVouchersForCustomerChange', () => {
  it('same-order promo (minted+redeemed here) → delete', () => {
    const r = classifyPwpVouchersForCustomerChange(
      [{ code: 'A', status: 'USED', source_doc_no: SO, redeemed_doc_no: SO }],
      SO,
    );
    expect(r).toEqual({ deleteCodes: ['A'], releaseCodes: [] });
  });

  it('cross-order voucher redeemed here → release', () => {
    const r = classifyPwpVouchersForCustomerChange(
      [{ code: 'B', status: 'USED', source_doc_no: 'SO-2606-001', redeemed_doc_no: SO }],
      SO,
    );
    expect(r).toEqual({ deleteCodes: [], releaseCodes: ['B'] });
  });

  it('minted here + still AVAILABLE (unused, old customer) → delete', () => {
    const r = classifyPwpVouchersForCustomerChange(
      [{ code: 'C', status: 'AVAILABLE', source_doc_no: SO, redeemed_doc_no: null }],
      SO,
    );
    expect(r).toEqual({ deleteCodes: ['C'], releaseCodes: [] });
  });

  it('unrelated code (other SO) → untouched', () => {
    const r = classifyPwpVouchersForCustomerChange(
      [{ code: 'D', status: 'AVAILABLE', source_doc_no: 'SO-2606-009', redeemed_doc_no: null }],
      SO,
    );
    expect(r).toEqual({ deleteCodes: [], releaseCodes: [] });
  });

  it('empty input → empty result', () => {
    expect(classifyPwpVouchersForCustomerChange([], SO)).toEqual({ deleteCodes: [], releaseCodes: [] });
  });

  it('mixed set → partitions correctly, leaves unrelated', () => {
    const r = classifyPwpVouchersForCustomerChange(
      [
        { code: 'A', status: 'USED', source_doc_no: SO, redeemed_doc_no: SO },
        { code: 'B', status: 'USED', source_doc_no: 'SO-2606-001', redeemed_doc_no: SO },
        { code: 'C', status: 'AVAILABLE', source_doc_no: SO, redeemed_doc_no: null },
        { code: 'D', status: 'AVAILABLE', source_doc_no: 'SO-2606-009', redeemed_doc_no: null },
      ],
      SO,
    );
    expect(r.deleteCodes.sort()).toEqual(['A', 'C']);
    expect(r.releaseCodes).toEqual(['B']);
  });
});
