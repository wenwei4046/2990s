// ----------------------------------------------------------------------------
// The design prototype's sample sales — SA_ORDERS in "POS Marketing.dc.html",
// regenerated with the SAME seeds, weights and call order, so the Sales
// analysis tab shows exactly the prototype's numbers (AM9036: 61 sets,
// 154 compartments, RM 210,299 …).
//
// Shown ONLY in the local simulation build (lib/sales-lines-queries.ts), which
// has no Houzs behind it, and always under the "Sample data" label the design
// carries beside the showroom picker. A live build never falls back to it: a
// failed read is shown as a failure. Nothing here is real.
// ----------------------------------------------------------------------------

import { dnum, type SaCat, type SaleLine, type SalesDataset } from './sales-model';

const SA_MODELS: Array<[string, SaCat, number]> = [
  ['AM9036', 'Sofa', 3290], ['5531', 'Sofa', 2790], ['DSL8019', 'Sofa', 2990], ['SF5119', 'Sofa', 3090], ['AM9070', 'Sofa', 2950],
  ['AKKA-FIRM', 'Mattress', 1490], ['ARRUS-FIRM', 'Mattress', 1790], ['AKKA-SOFT', 'Mattress', 1490], ['KETTA-SOFT', 'Mattress', 1390], ['ANGGN-FIRM', 'Mattress', 1450],
  ['NH39A', 'Bed frame', 1500], ['KHJ57', 'Bed frame', 1490], ['LSD013', 'Bed frame', 1450], ['Latex Pillow', 'Accessory', 120], ['Mattress Protector', 'Accessory', 150],
];
const SA_RACES = ['Malay', 'Chinese', 'Indian', 'Others'];
const SA_AGES = ['18–24', '25–34', '35–44', '45–54', '55+'];
const SA_GENDERS = ['Male', 'Female'];
const SA_STATES: Array<[string, string[], string]> = [
  ['Selangor', ['Petaling Jaya', 'Shah Alam', 'Subang Jaya'], 'pj'], ['Kuala Lumpur', ['Kuala Lumpur', 'Cheras'], 'kl'],
  ['Penang', ['George Town', 'Bayan Lepas'], 'pg'], ['Johor', ['Johor Bahru', 'Skudai'], 'jb'], ['Perak', ['Ipoh'], 'kl'],
  ['Others', ['Seremban', 'Melaka'], 'kl'],
];
const SA_MONTH_KEYS = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
const SA_VARIANTS: Record<SaCat, Array<[string, string[]]>> = {
  Sofa: [['3+L', ['2A(LHF)', '1NA', 'L(RHF)']], ['3-Seater', ['1A(LHF)', '2A(RHF)']], ['2-Seater', ['1A(LHF)', '1A(RHF)']], ['2+L', ['2A(LHF)', 'L(RHF)']], ['Custom-made', ['1A(LHF)', '1NA', '1NA', '2A(RHF)']]],
  Mattress: [['Queen', []], ['King', []], ['Super Single', []], ['Single', []]],
  'Bed frame': [['Queen', []], ['King', []], ['Super Single', []]],
  Accessory: [['Standard', []]],
};
const SA_VARIANT_W: Record<SaCat, number[]> = { Sofa: [34, 28, 18, 12, 8], Mattress: [46, 30, 16, 8], 'Bed frame': [50, 34, 16], Accessory: [1] };
const RACE_W: Record<SaCat, number[]> = { Sofa: [30, 52, 13, 5], Mattress: [55, 28, 12, 5], 'Bed frame': [48, 34, 13, 5], Accessory: [44, 38, 12, 6] };
const AGE_W: Record<SaCat, number[]> = { Sofa: [4, 26, 40, 22, 8], Mattress: [14, 44, 24, 12, 6], 'Bed frame': [8, 40, 30, 16, 6], Accessory: [12, 38, 28, 14, 8] };
const MODEL_W = [9, 7, 6, 4, 3, 10, 8, 7, 5, 4, 6, 5, 3, 7, 5];

/** The prototype's four sample showrooms. */
export const SAMPLE_SHOWROOMS = [
  { id: 'kl', label: 'Showroom KL' }, { id: 'pj', label: 'Showroom PJ' },
  { id: 'pg', label: 'Showroom Penang' }, { id: 'jb', label: 'Showroom JB' },
];

/** Prototype photos for the By-product summary card (non-sofa models). */
export const SAMPLE_PHOTOS: Readonly<Record<string, string>> = {
  'AKKA-FIRM': '/catalog/mattress-2990s-firm.jpg',
  'AKKA-SOFT': '/catalog/mattress-2990s-soft.jpg',
  'ARRUS-FIRM': '/catalog/mattress-2990s-firm.jpg',
  'KETTA-SOFT': '/catalog/mattress-2990s-soft.jpg',
  NH39A: '/catalog/bedframe-nh39a.png',
};

function generate(): SaleLine[] {
  let s = 20260908;
  const r = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const pick = <T,>(items: readonly T[], w: readonly number[]): T => {
    const t = w.reduce((a, b) => a + b, 0);
    let x = r() * t;
    for (let i = 0; i < items.length; i++) { x -= w[i]!; if (x <= 0) return items[i]!; }
    return items[items.length - 1]!;
  };
  const raw: Array<Omit<SaleLine, 'day' | 'order' | 'modules'> & { month: string }> = [];
  for (let i = 0; i < 640; i++) {
    const m = pick(SA_MODELS, MODEL_W);
    const st = pick(SA_STATES, [34, 27, 14, 13, 7, 5]);
    // Property order below is the prototype's object-literal evaluation order;
    // every r() call must happen in the same sequence or the numbers drift.
    const amount = Math.round(m[2] * (0.85 + r() * 0.4));
    const qty = m[1] === 'Accessory' ? 1 + Math.floor(r() * 3) : 1;
    const race = pick(SA_RACES, RACE_W[m[1]]);
    const age = pick(SA_AGES, AGE_W[m[1]]);
    const gender = pick(SA_GENDERS, m[1] === 'Sofa' ? [55, 45] : [42, 58]);
    const city = st[1][Math.floor(r() * st[1].length)]!;
    const month = SA_MONTH_KEYS[Math.min(10, Math.floor(r() * 11.6))]!;
    const cust = 'c' + Math.floor(r() * 520);
    const variant = pick(SA_VARIANTS[m[1]].map((v) => v[0]), SA_VARIANT_W[m[1]]);
    raw.push({
      model: m[0], cat: m[1], amount, qty, race, age, gender, state: st[0], showroom: st[2], month, cust, variant,
      custName: `Customer ${cust.slice(1)}`, city,
    });
  }
  let s2 = 777;
  const r2 = () => { s2 = (s2 * 1664525 + 1013904223) % 4294967296; return s2 / 4294967296; };
  return raw.map((o, i) => {
    const [y, mo] = o.month.split('-').map(Number) as [number, number];
    const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const { month: _month, ...rest } = o;
    return {
      ...rest,
      order: `sample-${i}`,
      day: dnum(y, mo, 1 + Math.floor(r2() * dim)),
      modules: (SA_VARIANTS[o.cat].find((v) => v[0] === o.variant)?.[1] ?? []).slice(),
    };
  });
}

/** Made-up margins (34–49% of the price), so the simulation's director persona
 *  can see the margin views. Drawn from the model's place in the list rather
 *  than the generator, which keeps every number above exactly the prototype's.
 *  One model has no cost, as some real lines do, so the "left out" note shows. */
const sampleMargin = (o: SaleLine): number | null => {
  if (o.model === 'ANGGN-FIRM') return null;
  const i = SA_MODELS.findIndex((m) => m[0] === o.model);
  return Math.round(o.amount * (0.34 + (i % 4) * 0.05));
};

const cached: { plain?: SalesDataset; margins?: SalesDataset } = {};

/** `withMargins` is the simulation's director persona — the finance tier. */
export function sampleDataset(withMargins = false): SalesDataset {
  const key = withMargins ? 'margins' : 'plain';
  if (!cached[key]) {
    const lines = generate();
    cached[key] = {
      lines: withMargins ? lines.map((o) => ({ ...o, margin: sampleMargin(o) })) : lines,
      showrooms: SAMPLE_SHOWROOMS,
      states: SA_STATES.map((x) => x[0]),
      d0: dnum(2025, 11, 1),
      d1: dnum(2026, 9, 30),
      margins: withMargins,
      sample: true,
    };
  }
  return cached[key]!;
}
