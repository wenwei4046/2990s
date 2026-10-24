import { describe, expect, it } from 'vitest';
import { modelActiveAfter, modelShownInPos, skusToShelve } from './show-in-pos';

const on = (id: string) => ({ id, pos_active: true });
const off = (id: string) => ({ id, pos_active: false });
const oneShot = (id: string) => ({ id, pos_active: false, one_shot: true });

describe('Show in POS on a single-SKU Model', () => {
  it('reads Off for a new product: Model active, its SKU not on the shelf', () => {
    expect(modelShownInPos(true, [off('s1')])).toBe(false);
    expect(modelShownInPos(true, [on('s1')])).toBe(true);
    // a SKU from before pos_active was sent reads as on
    expect(modelShownInPos(true, [{ id: 's1' }])).toBe(true);
  });

  it('reads Off for a Model switched off the old way, whatever its SKUs say', () => {
    expect(modelShownInPos(false, [on('s1')])).toBe(false);
    expect(modelShownInPos(false, [])).toBe(false);
  });

  it('reads On while any SKU is on the shelf, and ignores one-shot SKUs', () => {
    expect(modelShownInPos(true, [off('s1'), on('s2')])).toBe(true);
    expect(modelShownInPos(true, [off('s1'), oneShot('s2')])).toBe(false);
    expect(modelShownInPos(true, [oneShot('s2')])).toBe(true);
    expect(modelShownInPos(true, [])).toBe(true);
  });

  it('switching on shelves every SKU that is off, never a one-shot', () => {
    expect(skusToShelve([off('s1'), on('s2'), oneShot('s3')], true)).toEqual(['s1']);
    expect(skusToShelve([off('s1'), on('s2'), oneShot('s3')], false)).toEqual(['s2']);
    expect(skusToShelve([on('s1')], true)).toEqual([]);
  });

  it('switching on re-activates the Model; off leaves it active while it has a SKU to hide', () => {
    expect(modelActiveAfter(false, [on('s1')], true)).toBe(true);
    expect(modelActiveAfter(true, [on('s1')], false)).toBe(true);
    expect(modelActiveAfter(true, [], false)).toBe(false);
    expect(modelActiveAfter(true, [oneShot('s1')], false)).toBe(false);
  });
});
