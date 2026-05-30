import { describe, it, expect, beforeEach } from 'vitest';
import { useQuickPicks } from './quickpicks';

describe('quickpicks store (personal Quick Pick layer)', () => {
  beforeEach(() => { useQuickPicks.getState().clear(); });

  it('adds a personal pick tagged with staff + model', () => {
    const p = useQuickPicks.getState().addPick({
      staffId: 'AW', baseModel: 'Booqit', label: 'My L-sofa',
      modules: ['2A-LHF', 'L-RHF'], depth: '24',
    });
    expect(p.id).toBeTruthy();
    expect(p.savedAt).toBeGreaterThan(0);
    const mine = useQuickPicks.getState().listForStaff('AW', 'Booqit');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.modules).toEqual(['2A-LHF', 'L-RHF']);
    expect(mine[0]!.label).toBe('My L-sofa');
  });

  it('listForStaff filters by BOTH staffId and baseModel', () => {
    const s = useQuickPicks.getState();
    s.addPick({ staffId: 'AW', baseModel: 'Booqit', label: 'a', modules: ['1NA'], depth: '24' });
    s.addPick({ staffId: 'JM', baseModel: 'Booqit', label: 'b', modules: ['1NA'], depth: '24' });
    s.addPick({ staffId: 'AW', baseModel: 'Lotti',  label: 'c', modules: ['1NA'], depth: '24' });
    expect(useQuickPicks.getState().listForStaff('AW', 'Booqit')).toHaveLength(1);
    expect(useQuickPicks.getState().listForStaff('JM', 'Booqit')).toHaveLength(1);
    expect(useQuickPicks.getState().listForStaff('AW', 'Lotti')).toHaveLength(1);
    expect(useQuickPicks.getState().listForStaff('SN', 'Booqit')).toHaveLength(0);
  });

  it('removePick deletes only that pick', () => {
    const s = useQuickPicks.getState();
    const p1 = s.addPick({ staffId: 'AW', baseModel: 'Booqit', label: 'a', modules: ['1NA'], depth: '24' });
    s.addPick({ staffId: 'AW', baseModel: 'Booqit', label: 'b', modules: ['2NA'], depth: '24' });
    useQuickPicks.getState().removePick(p1.id);
    const mine = useQuickPicks.getState().listForStaff('AW', 'Booqit');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.label).toBe('b');
  });

  it('separate staff never see each other’s picks (per-device, per-staff)', () => {
    useQuickPicks.getState().addPick({ staffId: 'AW', baseModel: 'Booqit', label: 'a', modules: ['1NA'], depth: '24' });
    expect(useQuickPicks.getState().listForStaff('JM', 'Booqit')).toHaveLength(0);
  });
});
