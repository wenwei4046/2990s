import { describe, expect, it, vi } from 'vitest';

vi.mock('./apiClient', () => ({ authedFetchRaw: vi.fn() }));

const { datasetFromWire, fetchSalesLines } = await import('./sales-lines-queries');
const { authedFetchRaw } = await import('./apiClient');
type Wire = Parameters<typeof datasetFromWire>[0][number];

const wire = (over: Partial<Wire>): Wire => ({
  docNo: '2990-SO-2610-006', soDate: '2026-10-04', venue: '2990s PJ', category: 'SOFA', model: 'KABBIN',
  modules: ['2A(LHF)', 'L(RHF)'], sizeCode: null, sizeLabel: null, qty: 1, totalSen: 311500,
  customerId: 'cust-1', race: 'Chinese', age: 35, gender: 'Female', state: 'Selangor', ...over,
});

const one = (over: Partial<Wire>) => datasetFromWire([wire(over)]).lines[0];

describe('datasetFromWire — Houzs lines into the views\' lines', () => {
  it('names a sofa by its layout and keeps its compartments', () => {
    expect(one({})).toMatchObject({ cat: 'Sofa', model: 'KABBIN', variant: '2+L', modules: ['2A(LHF)', 'L(RHF)'], amount: 3115, qty: 1 });
  });

  it('leaves a build\'s headrests out of its compartments and its name', () => {
    expect(one({ modules: ['2S', 'HEADREST', 'HEADREST'] })).toMatchObject({ cat: 'Sofa', variant: '2-Seater', modules: ['2S'] });
  });

  it('counts a "sofa" that is only a headrest as an accessory sold on its own', () => {
    expect(one({ modules: ['HEADREST'], qty: 2, totalSen: 0 })).toMatchObject({ cat: 'Accessory', variant: 'Headrest', modules: [], amount: 0 });
  });

  it('names a mattress or bed frame by its size code, then its label', () => {
    expect(one({ category: 'MATTRESS', modules: [], sizeCode: 'K', sizeLabel: '6FT' })).toMatchObject({ cat: 'Mattress', variant: 'King' });
    expect(one({ category: 'BEDFRAME', modules: [], sizeCode: 'SS', sizeLabel: '3.5FT' })).toMatchObject({ cat: 'Bed frame', variant: 'Super Single' });
    expect(one({ category: 'BEDFRAME', modules: [], sizeCode: null, sizeLabel: '6FT' })).toMatchObject({ variant: '6FT' });
    expect(one({ category: 'MATTRESS', modules: [], sizeCode: null, sizeLabel: null })).toMatchObject({ variant: '—' });
  });

  it('names an accessory by its size label, else Standard', () => {
    expect(one({ category: 'ACCESSORY', modules: [], sizeLabel: '16" X 16"' })).toMatchObject({ cat: 'Accessory', variant: '16" X 16"' });
    expect(one({ category: 'ACCESSORY', modules: [] })).toMatchObject({ variant: 'Standard' });
  });

  it('bands the age, keys the showroom by venue, and keeps a walk-in apart', () => {
    expect(one({ age: 35, venue: ' 2990s PJ ', customerId: null })).toMatchObject({
      age: '35–44', showroom: '2990s PJ', cust: 'walk-in:2990-SO-2610-006',
    });
    const ds = datasetFromWire([wire({ venue: null, age: null })]);
    expect(ds.lines[0]).toMatchObject({ age: null, showroom: 'unknown' });
    expect(ds.showrooms).toEqual([{ id: 'unknown', label: 'Unassigned' }]);
  });

  it('skips what the views cannot place: an unknown category, a bad date, no quantity', () => {
    const ds = datasetFromWire([
      wire({ category: 'SERVICE' }),
      wire({ soDate: 'yesterday' }),
      wire({ qty: 0 }),
    ]);
    expect(ds.lines).toEqual([]);
    expect(ds.sample).toBe(false);
  });
});

describe('datasetFromWire — margin, for the finance tier only', () => {
  it('reads no margin when Houzs sends none', () => {
    const ds = datasetFromWire([wire({})]);
    expect(ds.margins).toBe(false);
    expect('margin' in ds.lines[0]!).toBe(false);
  });

  it('reads it per unit like the price, and keeps an unknown one unknown', () => {
    const ds = datasetFromWire([
      wire({ qty: 2, totalSen: 300000, marginSen: 90000 }),
      wire({ docNo: 'SO-2', totalSen: 149000, marginSen: null }),
    ]);
    expect(ds.margins).toBe(true);
    expect(ds.lines[0]).toMatchObject({ amount: 1500, margin: 450 });
    expect(ds.lines[1]!.margin).toBeNull();
  });
});

describe('fetchSalesLines', () => {
  const answer = (status: number, body: unknown) =>
    vi.mocked(authedFetchRaw).mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

  it('shows a 404 as a failure — never as sample data', async () => {
    answer(404, { error: 'not_found' });
    await expect(fetchSalesLines(false)).rejects.toThrow(/sales-analysis\/lines returned 404/);
  });

  it('shows a refusal as a failure, with what Houzs said', async () => {
    answer(403, { error: 'forbidden', reason: 'sales_lines_requires_scm.so.view_all_or_pos_marketing' });
    await expect(fetchSalesLines(false)).rejects.toThrow(/^403: .*sales_lines_requires/);
  });

  it('turns the lines into a real dataset, asking for test orders only when told to', async () => {
    answer(200, { includeTest: true, lines: [wire({})] });
    const ds = await fetchSalesLines(true);
    expect(vi.mocked(authedFetchRaw)).toHaveBeenLastCalledWith('/sales-analysis/lines?includeTest=true');
    expect(ds.sample).toBe(false);
    expect(ds.lines).toHaveLength(1);
  });
});
