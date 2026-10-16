import { describe, expect, it } from 'vitest';
import { groupFabricSeries } from './fabric-series-groups';

const lone = (code: string, label: string) => ({ fabricId: code, colourId: code, label });

describe('groupFabricSeries', () => {
  it('folds lone KN codes into one KN group, sorted by code', () => {
    const codes = ['KN12', 'KN10', 'KN01', 'KN05', 'KN04', 'KN02'];
    const names = ['Forest', 'Tiffany', 'Smoky Blue', 'Steel', 'Dark Grey', 'Black'];
    const { series, coloursBySeries } = groupFabricSeries(
      codes.map((id) => ({ id, label: id })),
      codes.map((c, i) => lone(c, names[i]!)),
    );
    expect(series).toEqual([{ id: 'KN', label: 'KN' }]);
    expect(coloursBySeries.get('KN')!.map((c) => c.label)).toEqual([
      'KN01 Smoky Blue', 'KN02 Black', 'KN04 Dark Grey', 'KN05 Steel', 'KN10 Tiffany', 'KN12 Forest',
    ]);
  });

  it('leaves a real series alone and merges lone codes into a matching one', () => {
    const { series, coloursBySeries } = groupFabricSeries(
      [{ id: 'HG1313', label: 'HG1313' }, { id: 'KN', label: 'KN' }, { id: 'KN07', label: 'KN07' }],
      [
        { fabricId: 'HG1313', colourId: 'HG1313-02', label: 'HG1313-02' },
        { fabricId: 'HG1313', colourId: 'HG1313-01', label: 'HG1313-01' },
        { fabricId: 'KN', colourId: 'KN-03', label: 'Sand' },
        lone('KN07', 'Moss'),
      ],
    );
    expect(series.map((s) => s.id)).toEqual(['HG1313', 'KN']);
    // A real series keeps the order it came in.
    expect(coloursBySeries.get('HG1313')!.map((c) => c.colourId)).toEqual(['HG1313-02', 'HG1313-01']);
    expect(coloursBySeries.get('KN')!.map((c) => c.label)).toEqual(['KN-03 Sand', 'KN07 Moss']);
  });
});
