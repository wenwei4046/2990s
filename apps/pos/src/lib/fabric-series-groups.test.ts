import { describe, expect, it } from 'vitest';
import { groupFabricPricingSeries, groupFabricSeries } from './fabric-series-groups';

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

  it('shows all MONZA code variants as one series without changing their pricing identities', () => {
    const fabrics = ['MONZA-HL', 'MONZA-HL-3588', 'MONZA-HL-B01', 'MONZA-HL-B04', 'MONZA-FL']
      .map((id, index) => ({ id, label: id, sofaTier: index % 2 ? 'PRICE_2' : 'PRICE_1' }));
    const colours = [
      { fabricId: 'MONZA-HL', colourId: 'MONZA-HL-01', label: 'Sand' },
      { fabricId: 'MONZA-FL', colourId: 'MONZA-FL-02', label: 'Grey' },
      lone('MONZA-HL-3588', 'White'), lone('MONZA-HL-B01', 'Blue'), lone('MONZA-HL-B04', 'Red'),
    ];
    const grouped = groupFabricSeries(fabrics, colours);
    expect(grouped.series).toEqual([{ id: 'MONZA', label: 'MONZA' }]);
    expect(grouped.coloursBySeries.get('MONZA')!.map((c) => c.colourId).sort())
      .toEqual(colours.map((c) => c.colourId).sort());
    expect(grouped.fabricsBySeries.get('MONZA')).toEqual(fabrics);
    expect(grouped.fabricsBySeries.get('MONZA')![1]).toBe(fabrics[1]);
    expect(grouped.fabricsBySeries.get('MONZA')![1]!.sofaTier).toBe('PRICE_2');
  });

  it('uses saved HOMELY for all BROWNIE colours and deduplicates the canonical tier member', () => {
    const fabric = { id: 'BROWNIE', label: 'BROWNIE' };
    const colours = ['BROWNIE-01', 'BROWNIE-02', 'BROWNIE-03']
      .map((colourId) => ({ fabricId: fabric.id, colourId, label: colourId }));
    const saved = colours.map((c) => ({ fabric_code: c.colourId, series: ' HOMELY ' }));
    const grouped = groupFabricSeries([fabric], colours, saved);
    expect(grouped.series).toEqual([{ id: 'HOMELY', label: 'HOMELY' }]);
    expect(grouped.coloursBySeries.get('HOMELY')!.map((c) => c.colourId)).toEqual(colours.map((c) => c.colourId));
    expect(grouped.fabricsBySeries.get('HOMELY')).toEqual([fabric]);
  });

  it('honours explicit saved MONZA subseries instead of folding them into the fallback family', () => {
    const fabrics = ['MONZA-HL', 'MONZA-FL'].map((id) => ({ id, label: id }));
    const colours = [
      { fabricId: 'MONZA-HL', colourId: 'MONZA-HL-01', label: 'Cream' },
      { fabricId: 'MONZA-FL', colourId: 'MONZA-FL-01', label: 'Grey' },
    ];
    const grouped = groupFabricSeries(fabrics, colours, [
      { fabric_code: 'MONZA-HL-01', series: 'Monza  Premium' },
      { fabric_code: 'MONZA-FL-01', series: 'MONZA-FL' },
    ]);
    expect(grouped.series).toEqual([
      { id: 'MONZA-PREMIUM', label: 'Monza Premium' },
      { id: 'MONZA-FL', label: 'MONZA-FL' },
    ]);
  });

  it('merges casing and separator variants of Velvet Interlace and prefers a saved spelling', () => {
    const fabrics = ['VELVET-INTERLACE', 'Velvet Interlace', 'OTHER'].map((id) => ({ id, label: id }));
    const grouped = groupFabricSeries(fabrics, [
      { fabricId: fabrics[0]!.id, colourId: 'VI-01', label: 'Blue' },
      { fabricId: fabrics[1]!.id, colourId: 'VI-02', label: 'Red' },
      { fabricId: 'OTHER', colourId: 'VI-03', label: 'Green' },
    ], [{ fabric_code: ' vi-03 ', series: ' Velvet Interlace ' }]);
    expect(grouped.series).toEqual([{ id: 'VELVET-INTERLACE', label: 'Velvet Interlace' }]);
    expect(grouped.coloursBySeries.get('VELVET-INTERLACE')!.map((c) => c.colourId))
      .toEqual(['VI-01', 'VI-02', 'VI-03']);
  });

  it('keeps HG1313 and other real numbered collections intact, including empty collections', () => {
    const fabrics = ['HG1313', 'HG1314', 'FABRIC9', 'MONZART', 'EMPTY8'].map((id) => ({ id, label: id }));
    const grouped = groupFabricSeries(fabrics, fabrics.slice(0, 4).map((s) => lone(s.id, s.id)));
    expect(grouped.series).toEqual(fabrics);
    expect(grouped.coloursBySeries.get('EMPTY8')).toEqual([]);
    expect(grouped.fabricsBySeries.get('EMPTY8')).toEqual([fabrics[4]]);
  });

  it('rebuilds groups after a saved series changes or is cleared without mutating inputs', () => {
    const fabrics = [{ id: 'BROWNIE', label: 'BROWNIE' }];
    const colours = [{ fabricId: 'BROWNIE', colourId: 'BROWNIE-01', label: 'Brown' }];
    const saved = [{ fabric_code: 'BROWNIE-01', series: 'HOMELY' }];
    const snapshot = JSON.stringify({ fabrics, colours, saved });
    expect(groupFabricSeries(fabrics, colours, saved).series[0]!.label).toBe('HOMELY');
    expect(groupFabricSeries(fabrics, colours, [{ ...saved[0]!, series: 'COMFORT' }]).series[0]!.label).toBe('COMFORT');
    expect(groupFabricSeries(fabrics, colours, [{ ...saved[0]!, series: '  ' }]).series[0]!.label).toBe('BROWNIE');
    expect(JSON.stringify({ fabrics, colours, saved })).toBe(snapshot);
  });

  it('assigns only the named colours to their saved series', () => {
    const fabric = { id: 'BROWNIE', label: 'BROWNIE' };
    const grouped = groupFabricSeries([fabric], [
      { fabricId: fabric.id, colourId: 'BROWNIE-01', label: 'Brown' },
      { fabricId: fabric.id, colourId: 'BROWNIE-02', label: 'Sand' },
    ], [{ fabric_code: 'BROWNIE-01', series: 'HOMELY' }]);
    expect(grouped.series.map((s) => s.label)).toEqual(['HOMELY', 'BROWNIE']);
    expect(grouped.coloursBySeries.get('HOMELY')!.map((c) => c.colourId)).toEqual(['BROWNIE-01']);
    expect(grouped.coloursBySeries.get('BROWNIE')!.map((c) => c.colourId)).toEqual(['BROWNIE-02']);
    expect(grouped.fabricsBySeries.get('HOMELY')).toEqual([fabric]);
    expect(grouped.fabricsBySeries.get('BROWNIE')).toEqual([fabric]);
  });
});

describe('groupFabricPricingSeries', () => {
  it('returns one tier row for MONZA and preserves every member tier', () => {
    const fabrics = [
      { id: 'MONZA-HL', label: 'MONZA-HL', sofaTier: 'PRICE_1' },
      { id: 'MONZA-FL', label: 'MONZA-FL', sofaTier: 'PRICE_2' },
    ];
    expect(groupFabricPricingSeries(fabrics, [])).toEqual([
      { id: 'MONZA', label: 'MONZA', fabrics, shared: false },
    ]);
  });

  it('combines saved groups that share an original tier row into one explicit shared control', () => {
    const fabric = { id: 'BROWNIE', label: 'BROWNIE', sofaTier: 'PRICE_2' };
    const colours = [
      { fabricId: fabric.id, colourId: 'BROWNIE-01', label: 'Brown' },
      { fabricId: fabric.id, colourId: 'BROWNIE-02', label: 'Sand' },
    ];
    expect(groupFabricPricingSeries([fabric], colours, [{ fabric_code: 'BROWNIE-01', series: 'HOMELY' }]))
      .toEqual([{ id: 'HOMELY', label: 'HOMELY / BROWNIE', fabrics: [fabric], shared: true }]);
  });

  it('combines transitive overlaps once while leaving unrelated and empty collections independent', () => {
    const fabrics = ['SOURCE1', 'SOURCE2', 'KN03', 'HG1313'].map((id) => ({ id, label: id }));
    const colours = [
      { fabricId: 'SOURCE1', colourId: 'SOURCE1-01', label: 'Blue' },
      { fabricId: 'SOURCE1', colourId: 'SOURCE1-02', label: 'Grey' },
      { fabricId: 'SOURCE2', colourId: 'SOURCE2-01', label: 'Blue' },
      { fabricId: 'SOURCE2', colourId: 'SOURCE2-02', label: 'Grey' },
      lone('KN03', 'Red'),
    ];
    const saved = [
      { fabric_code: 'SOURCE1-01', series: 'A' },
      { fabric_code: 'SOURCE1-02', series: 'B' },
      { fabric_code: 'SOURCE2-01', series: 'B' },
      { fabric_code: 'SOURCE2-02', series: 'C' },
    ];
    expect(groupFabricPricingSeries(fabrics, colours, saved)).toEqual([
      { id: 'A', label: 'A / B / C', fabrics: fabrics.slice(0, 2), shared: true },
      { id: 'KN', label: 'KN', fabrics: [fabrics[2]], shared: false },
      { id: 'HG1313', label: 'HG1313', fabrics: [fabrics[3]], shared: false },
    ]);
  });
});
