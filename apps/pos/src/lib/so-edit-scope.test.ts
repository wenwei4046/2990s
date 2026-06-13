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
    });
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
