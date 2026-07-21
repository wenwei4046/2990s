import { describe, it, expect } from 'vitest';
import { getSoEditScope } from './so-edit-scope';

describe('getSoEditScope', () => {
  it('Order placed (CONFIRMED, not proceeded) → full edit', () => {
    const s = getSoEditScope({ status: 'CONFIRMED', proceededAt: null });
    expect(s).toEqual({
      isDeliveredLane: false,
      editablePlaced: true,
      editableProceed: false,
      canEditDetails: true,
      canEditControlledAddress: true,
    });
  });

  // Houzs address-lock parity: state/city/postcode go read-only once
  // processing_date has passed, mirroring the server's so_locked_processing
  // 409. Free fields (address lines, phone, email) still open under
  // canEditDetails.
  it('processingPassed → CONTROLLED address (state/city/postcode) locks; other details stay open', () => {
    const s = getSoEditScope({
      status: 'CONFIRMED',
      proceededAt: '2026-06-13T00:00:00Z',
      processingDate: '2026-06-20',
      todayMY: '2026-07-01',
    });
    expect(s.canEditDetails).toBe(true);              // FREE fields stay editable
    expect(s.canEditControlledAddress).toBe(false);   // CONTROLLED fields lock
  });

  it('processing date in the future → nothing locked yet', () => {
    const s = getSoEditScope({
      status: 'CONFIRMED',
      proceededAt: '2026-06-13T00:00:00Z',
      processingDate: '2026-08-15',
      todayMY: '2026-07-01',
    });
    expect(s.canEditControlledAddress).toBe(true);
  });

  it('delivered lane + past processing date → nothing editable (address lock is a subset)', () => {
    const s = getSoEditScope({
      status: 'DELIVERED',
      proceededAt: '2026-06-13T00:00:00Z',
      processingDate: '2026-06-20',
      todayMY: '2026-07-01',
    });
    expect(s.canEditDetails).toBe(false);
    expect(s.canEditControlledAddress).toBe(false);
  });

  it('Proceed (CONFIRMED + proceeded) → details only, not placed', () => {
    const s = getSoEditScope({ status: 'CONFIRMED', proceededAt: '2026-06-13T00:00:00Z' });
    expect(s.editablePlaced).toBe(false);
    expect(s.editableProceed).toBe(true);
    expect(s.canEditDetails).toBe(true);
  });

  it.each(['IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED'])(
    '%s → Proceed lane, details editable',
    (status) => {
      const s = getSoEditScope({ status, proceededAt: null });
      expect(s.editableProceed).toBe(true);
      expect(s.editablePlaced).toBe(false);
      expect(s.canEditDetails).toBe(true);
    },
  );

  it.each(['DELIVERED', 'INVOICED', 'CLOSED'])(
    '%s → delivered lane, nothing editable',
    (status) => {
      const s = getSoEditScope({ status, proceededAt: '2026-06-13T00:00:00Z' });
      expect(s.isDeliveredLane).toBe(true);
      expect(s.canEditDetails).toBe(false);
      expect(s.editablePlaced).toBe(false);
      expect(s.editableProceed).toBe(false);
    },
  );
});
