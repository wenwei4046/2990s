import { describe, expect, it } from 'vitest';
import { sampleDataset } from './sample-sales';
import {
  ageBand, dnum, NO_CRITERIA, overviewView, presets, productView, rangeLabel, stateKeys,
  type SaleLine, type SalesDataset,
} from './sales-model';

/* The design's screenshot 12 ("Sales · By product", all time, all showrooms)
   prints these numbers from the prototype's own sample. Reproducing them pins
   BOTH the sample generator (seeds + call order) and the view math. */
describe('sample data reproduces the design prototype', () => {
  const ds = sampleDataset();
  const all = { d0: ds.d0, d1: ds.d1, showroom: 'all' };

  it('category chips', () => {
    const v = productView(ds, all, 'Sofa', null);
    expect(v.catChips.map((c) => [c.label, c.count])).toEqual([
      ['Sofa', 204], ['Mattress', 253], ['Bed frame', 99], ['Accessory', 177],
    ]);
  });

  it('model ranking and the AM9036 summary', () => {
    const v = productView(ds, all, 'Sofa', null);
    expect(v.models.slice(0, 3).map((m) => [m.name, m.units, m.rev])).toEqual([
      ['AM9036', 61, 'RM 210,299'], ['5531', 50, 'RM 145,784'], ['DSL8019', 45, 'RM 139,139'],
    ]);
    expect(v.pm.name).toBe('AM9036');
    expect(v.pm.rank).toBe(1);
    expect(v.pm.line).toBe('Best seller: 3+L · 33% of units');
    expect(v.pm.facts).toEqual([
      { value: '61', label: 'Sets sold' },
      { value: '154', label: 'Compartments' },
      { value: 'RM 210,299', label: 'Revenue' },
      { value: '30%', label: 'of sofa units' },
    ]);
    expect(v.pm.mods).toEqual(['2A(LHF)', '1NA', 'L(RHF)']);
  });

  it('range label + presets match the date picker screenshot', () => {
    expect(rangeLabel(ds.d0, ds.d1)).toBe('1 Nov 2025 – 30 Sep 2026');
    const all7 = presets(ds).find((p) => p[0] === 'All time')!;
    expect(all7[2] - all7[1] + 1).toBe(334); // "334 days selected"
  });

  it('overview without criteria has no index column values', () => {
    const v = overviewView(ds, all, NO_CRITERIA, 'race');
    expect(v.cfLine).toBe('All customers · 1 Nov 2025 – 30 Sep 2026');
    expect(v.products.every((p) => p.idx === '')).toBe(true);
    expect(v.kpis.map((k) => k.label)).toEqual(['Customers', 'Items bought', 'Total revenue', 'AOV']);
  });
});

const line = (over: Partial<SaleLine>): SaleLine => ({
  order: 'SO-1', day: dnum(2026, 9, 1), showroom: '107', cat: 'Mattress', model: 'AKKA', variant: 'Queen',
  modules: [], qty: 1, amount: 1000, cust: 'c1', race: 'Chinese', age: '25–34', gender: 'Male', state: 'Selangor', ...over,
});

describe('real-data rules', () => {
  it('counts a multi-line order once', () => {
    const ds: SalesDataset = {
      lines: [line({}), line({ model: 'PILLOW', cat: 'Accessory', variant: 'Standard' })],
      showrooms: [{ id: '107', label: '2990s PJ' }], states: ['Selangor'], d0: dnum(2026, 9, 1), d1: dnum(2026, 9, 1), margins: false, sample: false,
    };
    const v = overviewView(ds, { d0: ds.d0, d1: ds.d1, showroom: 'all' }, NO_CRITERIA, 'race');
    expect(v.kpis[1]!.sub.startsWith('1 orders')).toBe(true);
    const race = v.profile.find((p) => p.title === 'Race')!;
    expect(race.rows.find((r) => r.label === 'Chinese')!.n).toBe(1);
  });

  it('adds an Unknown row only when demographics are missing', () => {
    const base = { showrooms: [{ id: '107', label: '2990s PJ' }], states: ['Selangor'], d0: dnum(2026, 9, 1), d1: dnum(2026, 9, 1), margins: false, sample: false };
    const f = { d0: base.d0, d1: base.d1, showroom: 'all' };
    const clean = overviewView({ ...base, lines: [line({})] }, f, NO_CRITERIA, 'race');
    expect(clean.profile[0]!.rows.some((r) => r.label === 'Unknown')).toBe(false);
    const gappy = overviewView({ ...base, lines: [line({}), line({ order: 'SO-2', race: null })] }, f, NO_CRITERIA, 'race');
    const unknown = gappy.profile[0]!.rows.find((r) => r.label === 'Unknown')!;
    expect(unknown.n).toBe(1);
    expect(unknown.share).toBe('50%');
  });

  it('bands the age at purchase on the design\'s edges', () => {
    expect(ageBand(17)).toBe('18–24'); // under-18 buyers fold into the youngest band
    expect(ageBand(24)).toBe('18–24');
    expect(ageBand(25)).toBe('25–34');
    expect(ageBand(35)).toBe('35–44');
    expect(ageBand(54)).toBe('45–54');
    expect(ageBand(55)).toBe('55+');
    expect(ageBand(null)).toBeNull();
    expect(ageBand(-1)).toBeNull();
    expect(ageBand(140)).toBeNull();
  });

  it('folds states past the top five into Others', () => {
    const states = ['A', 'B', 'C', 'D', 'E', 'F'];
    const lines = states.map((s, i) => line({ order: `SO-${i}`, state: s }));
    expect(stateKeys(lines)).toEqual(['A', 'B', 'C', 'D', 'E', 'Others']);
  });
});

/* Houzs sends margin to its finance tier only; the views add it wherever
   revenue is shown, and never guess at a line with no cost. */
describe('margin', () => {
  const day = dnum(2026, 9, 10);
  const base = { showrooms: [{ id: '107', label: '2990s PJ' }], states: ['Selangor'], d0: dnum(2026, 8, 1), d1: dnum(2026, 9, 30), sample: false };
  const sept = { d0: dnum(2026, 9, 1), d1: dnum(2026, 9, 30), showroom: 'all' };

  it('draws none of it when the feed carries none', () => {
    const ds: SalesDataset = { ...base, margins: false, lines: [line({ day })] };
    const ov = overviewView(ds, sept, NO_CRITERIA, 'race');
    expect(ov.margins).toBe(false);
    expect(ov.kpis.map((k) => k.label)).not.toContain('Gross margin');
    expect(ov.products[0]!.margin).toBe('');
    expect(ov.marginNote).toBeNull();
    expect(productView(ds, sept, 'Mattress', null).pm.facts.map((f) => f.label)).not.toContain('Gross margin');
  });

  it('is measured over the lines with a cost, and says what that leaves out', () => {
    const ds: SalesDataset = {
      ...base, margins: true, lines: [
        line({ order: 'SO-1', day, qty: 2, margin: 300 }), // RM 2,000 at RM 600
        line({ order: 'SO-2', day, model: 'ARRUS', amount: 1500, margin: null }), // no cost yet
        line({ order: 'SO-3', day, model: 'PILLOW', cat: 'Accessory', variant: 'Standard', amount: 0, margin: -20 }), // a free gift still costs
      ],
    };
    const ov = overviewView(ds, sept, NO_CRITERIA, 'race');
    const k = ov.kpis.find((x) => x.label === 'Gross margin')!;
    expect(k.value).toBe('29.0%'); // (600 − 20) / 2,000 — not / 3,500
    expect(k.sub.startsWith('RM 580 · ')).toBe(true);
    expect(ov.marginNote).toBe('Gross margin leaves out RM 1,500 of sales that have no cost recorded yet.');
    expect(ov.products.find((p) => p.name === 'AKKA')!.margin).toBe('30.0%');
    expect(ov.products.find((p) => p.name === 'ARRUS')!.margin).toBe('—');
    expect(productView(ds, sept, 'Mattress', 'AKKA').pm.facts).toContainEqual({ value: '30.0%', label: 'Gross margin' });
  });

  it('compares in points: with the previous period, or with all customers under criteria', () => {
    const ds: SalesDataset = {
      ...base, margins: true, lines: [
        line({ order: 'SO-0', day: dnum(2026, 8, 20), margin: 250 }), // the previous 30 days: 25%
        line({ order: 'SO-1', day, margin: 300 }),
        line({ order: 'SO-2', day, margin: 400, race: 'Malay' }), // September: 35%
      ],
    };
    const ov = overviewView(ds, sept, NO_CRITERIA, 'race');
    expect(ov.kpis.find((x) => x.label === 'Gross margin')!.sub).toBe('RM 700 · ▲ 10.0 pts vs previous 30 days');
    const chinese = overviewView(ds, sept, { ...NO_CRITERIA, race: 'Chinese' }, 'race');
    expect(chinese.kpis.find((x) => x.label === 'Gross margin')!.sub).toBe('RM 300 · −5.0 pts vs all customers');
  });

  it("leaves the prototype's sample numbers alone when the simulation adds margin", () => {
    const plain = sampleDataset();
    const withM = sampleDataset(true);
    expect(withM.margins).toBe(true);
    expect(withM.lines.map(({ margin: _m, ...rest }) => rest)).toEqual(plain.lines);
  });
});
