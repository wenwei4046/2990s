import { describe, it, expect } from 'vitest';
import { nextStatus, canTransition, receivedFloorViolation, type AmendStatus } from './so-amendment';

describe('so-amendment state machine', () => {
  it('allows the happy path in order', () => {
    expect(canTransition('REQUESTED', 'supplier-confirm')).toBe(true);
    expect(canTransition('SUPPLIER_PENDING', 'approve-so')).toBe(true);
    expect(canTransition('SO_APPROVED', 'approve-po')).toBe(true);
    expect(canTransition('PO_APPROVED', 'send')).toBe(true);
  });
  it('blocks out-of-order transitions', () => {
    expect(canTransition('REQUESTED', 'approve-po')).toBe(false);
    expect(canTransition('SENT', 'reject')).toBe(false);
  });
  it('allows reject from any pre-approved gate', () => {
    for (const s of ['REQUESTED','SUPPLIER_PENDING','SO_APPROVED','PO_APPROVED'] as AmendStatus[])
      expect(canTransition(s, 'reject')).toBe(true);
  });
  it('nextStatus maps each action', () => {
    expect(nextStatus('REQUESTED','supplier-confirm')).toBe('SUPPLIER_PENDING');
    expect(nextStatus('SUPPLIER_PENDING','approve-so')).toBe('SO_APPROVED');
  });
  it('flags a line dropping below received qty', () => {
    expect(receivedFloorViolation({ newQty: 1 }, { receivedQty: 3 })).toBe(true);
    expect(receivedFloorViolation({ newQty: 5 }, { receivedQty: 3 })).toBe(false);
    expect(receivedFloorViolation({ newQty: null }, { receivedQty: 3 })).toBe(false);
  });
});
