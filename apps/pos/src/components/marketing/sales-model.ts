// ----------------------------------------------------------------------------
// Sales analysis — every number the two views draw, from a flat list of order
// lines. A port of the design prototype's `renderVals` sales half (lines
// 1446–1597 of "POS Marketing.dc.html"), kept in the same order and with the
// same formulas so the screens read exactly as designed.
//
// Two departures, both forced by real data and neither visible on clean data:
//   · ORDERS. The prototype's sample has one line per order, so it counts
//     lines. A real Sales Order has several lines, so every "orders" / "buyers"
//     count here is distinct order numbers. On one-line orders the two agree.
//   · UNKNOWN. The prototype's customers all have a race, age, gender and
//     state; about a third of real orders were captured without them. Those
//     still count in every total, and each breakdown that has any gets a final
//     grey "Unknown" row so its shares add up instead of silently falling short.
//
// And one addition: MARGIN. The design was drawn for the marketing account,
// which never sees cost. Houzs sends margin to its finance tier only (the
// directors — owner 2026-07-16); for them a Gross margin KPI, a Margin column
// and a By-product figure join the views. It is measured over the lines whose
// cost is known, and the revenue that leaves out is said, not hidden.
// ----------------------------------------------------------------------------

export type SaCat = 'Sofa' | 'Mattress' | 'Bed frame' | 'Accessory';

export const SA_CATS: ReadonlyArray<readonly [SaCat, string]> = [
  ['Sofa', '#E86B3A'], ['Mattress', '#A6471E'], ['Bed frame', '#C9A86A'], ['Accessory', '#2F5D4F'],
];
export const SA_CAT_COLOR: Readonly<Record<SaCat, string>> = Object.fromEntries(SA_CATS) as Record<SaCat, string>;
export const SA_RACES = ['Malay', 'Chinese', 'Indian', 'Others'] as const;
export const SA_AGES = ['18–24', '25–34', '35–44', '45–54', '55+'] as const;
export const SA_GENDERS = ['Male', 'Female'] as const;
const PAL = ['#E86B3A', '#2F5D4F', '#A6471E', '#C9A86A', '#1F3A8A', '#8B7E6A'];
const UNKNOWN = 'Unknown';
const UNKNOWN_COLOR = '#C9C1B4';

/* ── day numbers (UTC days since epoch), as the prototype counts them ────── */

export const SA_DAY = 86_400_000;
export const dnum = (y: number, m: number, d: number): number => Math.floor(Date.UTC(y, m - 1, d) / SA_DAY);
export const dparts = (n: number): [number, number, number] => {
  const t = new Date(n * SA_DAY);
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
};
export const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dfmt = (n: number): string => {
  const [y, m, d] = dparts(n);
  return `${d} ${MN[m - 1]} ${y}`;
};
export const isoToDay = (iso: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? dnum(Number(m[1]), Number(m[2]), Number(m[3])) : null;
};
const monthKey = (n: number): string => {
  const [y, m] = dparts(n);
  return `${y}-${String(m).padStart(2, '0')}`;
};
const mLabel = (k: string): string => {
  const [y, m] = k.split('-');
  return `${MN[Number(m) - 1]} ${y}`;
};
export const addMonths = (y: number, m: number, k: number): [number, number] => {
  const t = y * 12 + (m - 1) + k;
  return [Math.floor(t / 12), (t % 12) + 1];
};

/* ── the input ───────────────────────────────────────────────────────────── */

/** One sold line: a single SKU line, or one whole sofa build. */
export interface SaleLine {
  order: string;
  day: number;
  /** Showroom id — a venue, or the sample's kl/pj/pg/jb. */
  showroom: string;
  cat: SaCat;
  model: string;
  /** '3+L' / 'Custom-made' for a sofa build, the size for a mattress / bed. */
  variant: string;
  /** A sofa build's compartments, left to right; [] otherwise. */
  modules: string[];
  qty: number;
  /** RM per unit; revenue is amount × qty. */
  amount: number;
  /** Gross margin, RM per unit like `amount`. null where a priced line has no
   *  cost yet; absent unless the caller is Houzs's finance tier, which is the
   *  only caller it sends margin to. */
  margin?: number | null;
  cust: string;
  race: string | null;
  age: string | null;
  gender: string | null;
  state: string | null;
}

export interface SalesDataset {
  lines: SaleLine[];
  showrooms: Array<{ id: string; label: string }>;
  /** Location breakdown keys, in order ('Others' last when used). */
  states: string[];
  /** First and last day that can carry data (picker bounds, presets). */
  d0: number;
  d1: number;
  /** The feed carried margin: the views add it wherever revenue is shown. */
  margins: boolean;
  sample: boolean;
}

export interface SalesFilter {
  d0: number;
  d1: number;
  showroom: string; // 'all' or a showroom id
}

export type Criteria = { age: string; race: string; state: string; gender: string };
export const NO_CRITERIA: Criteria = { age: 'all', race: 'all', state: 'all', gender: 'all' };

/* ── formatting ─────────────────────────────────────────────────────────── */

export const RMk = (n: number): string => 'RM ' + Math.round(n).toLocaleString('en-MY');
const P0 = (x: number): string => Math.round(x) + '%';
const amt = (o: SaleLine) => o.amount * o.qty;
const sum = (l: SaleLine[]) => l.reduce((a, o) => a + amt(o), 0);
const units = (l: SaleLine[]) => l.reduce((a, o) => a + o.qty, 0);
const orderCount = (l: SaleLine[]) => new Set(l.map((o) => o.order)).size;
const custs = (l: SaleLine[]) => new Set(l.map((o) => o.cust)).size;

/** Gross margin over the lines whose cost is known. `base` is the revenue it
 *  is measured against; `unknown` is the revenue left out for want of a cost —
 *  counting it would read as 100% margin on those lines. */
interface MarginSum { rm: number; base: number; unknown: number }
const marginSum = (l: SaleLine[]): MarginSum => {
  const m = { rm: 0, base: 0, unknown: 0 };
  for (const o of l) {
    if (o.margin == null) m.unknown += amt(o);
    else { m.rm += o.margin * o.qty; m.base += amt(o); }
  }
  return m;
};
const marginPct = (m: MarginSum): number | null => (m.base > 0 ? (m.rm / m.base) * 100 : null);
const P1 = (x: number | null): string => (x == null ? '—' : x.toFixed(1) + '%');

/** Location key for a line: its state when that is a listed key, else 'Others'
 *  when the list folds, else unknown. */
const stateKey = (ds: SalesDataset, s: string | null): string | null => {
  if (!s) return null;
  if (ds.states.includes(s)) return s;
  return ds.states.includes('Others') ? 'Others' : null;
};

type DimKey = 'race' | 'age' | 'gender' | 'state' | 'cat';
const dimOf = (ds: SalesDataset, o: SaleLine, key: DimKey): string | null =>
  key === 'state' ? stateKey(ds, o.state) : key === 'cat' ? o.cat : o[key];

interface Dist { k: string; n: number; p: number; color: string }

/** Distribution of a dimension: count of distinct orders (or units) per key,
 *  share of the whole list. Unknown appended only when present. */
function distOf(ds: SalesDataset, list: SaleLine[], key: DimKey, keys: readonly string[], byUnits = false): Dist[] {
  const tot = byUnits ? units(list) : orderCount(list);
  const measure = (l: SaleLine[]) => (byUnits ? units(l) : orderCount(l));
  const rows: Dist[] = keys.map((k, i) => {
    const n = measure(list.filter((o) => dimOf(ds, o, key) === k));
    return { k, n, p: tot ? (n / tot) * 100 : 0, color: PAL[i % PAL.length]! };
  });
  if (key !== 'cat') {
    const un = measure(list.filter((o) => dimOf(ds, o, key) == null));
    if (un > 0) rows.push({ k: UNKNOWN, n: un, p: tot ? (un / tot) * 100 : 0, color: UNKNOWN_COLOR });
  }
  return rows;
}

/* ── presets + range label ───────────────────────────────────────────────── */

export function presets(ds: SalesDataset): Array<[string, number, number]> {
  const [ty, tm] = dparts(ds.d1);
  const mStart = (y: number, m: number) => dnum(y, m, 1);
  const mEnd = (y: number, m: number) => dnum(y, m + 1, 0);
  const [lmY, lmM] = addMonths(ty, tm, -1);
  const [q3Y, q3M] = addMonths(ty, tm, -2);
  return [
    ['Last 7 days', ds.d1 - 6, ds.d1],
    ['This month', mStart(ty, tm), ds.d1],
    ['Last month', mStart(lmY, lmM), mEnd(lmY, lmM)],
    ['Last 3 months', mStart(q3Y, q3M), ds.d1],
    ['Year to date', dnum(ty, 1, 1), ds.d1],
    ['All time', ds.d0, ds.d1],
  ];
}

export const rangeLabel = (d0: number, d1: number): string => (d0 === d1 ? dfmt(d0) : `${dfmt(d0)} – ${dfmt(d1)}`);

/* ── the views ───────────────────────────────────────────────────────────── */

interface Scoped {
  d0: number; d1: number; len: number; ords: SaleLine[]; prevOrds: SaleLine[]; label: string;
}

function scope(ds: SalesDataset, f: SalesFilter): Scoped {
  const d0 = Math.min(f.d0, f.d1);
  const d1 = Math.max(f.d0, f.d1);
  const inShow = (o: SaleLine) => f.showroom === 'all' || o.showroom === f.showroom;
  const len = d1 - d0 + 1;
  return {
    d0, d1, len,
    ords: ds.lines.filter((o) => inShow(o) && o.day >= d0 && o.day <= d1),
    prevOrds: ds.lines.filter((o) => inShow(o) && o.day >= d0 - len && o.day < d0),
    label: rangeLabel(d0, d1),
  };
}

export interface ProfileRow { label: string; n: number; share: string; pct: string; color: string; d: string; dFg: string }
export interface ProfileCard { title: string; note: string; countLabel: string; rows: ProfileRow[] }

export interface OverviewView {
  cfLine: string;
  cfCount: number;
  kpis: Array<{ label: string; value: string; sub: string; subFg: string }>;
  /** The products table carries a Margin column. */
  margins: boolean;
  /** Said under the KPIs when some revenue in scope has no cost to measure. */
  marginNote: string | null;
  profile: ProfileCard[];
  products: Array<{ rank: number; name: string; cat: SaCat; color: string; units: number; rev: string; margin: string; pct: string; share: string; idx: string; idxFg: string; idxBg: string }>;
  productsEmpty: boolean;
  heatCols: string[];
  heat: Array<{ label: string; color: string; cells: Array<{ v: string; bg: string; fg: string }> }>;
}

export function overviewView(ds: SalesDataset, f: SalesFilter, crit: Criteria, heatDim: 'race' | 'age' | 'gender' | 'state'): OverviewView {
  const s = scope(ds, f);
  const cfOk = (o: SaleLine) => (['age', 'race', 'state', 'gender'] as const)
    .every((k) => crit[k] === 'all' || dimOf(ds, o, k) === crit[k]);
  const cfCount = (['age', 'race', 'state', 'gender'] as const).filter((k) => crit[k] !== 'all').length;
  const pOrds = s.ords.filter(cfOk);
  const pPrev = s.prevOrds.filter(cfOk);
  const allRev = sum(s.ords) || 1;
  const allOrders = orderCount(s.ords) || 1;
  const pOrders = orderCount(pOrds);
  const prevOrders = orderCount(pPrev);
  const dl = (a: number, b: number) => (b ? ((a - b) / b) * 100 : null);
  const fmtD = (x: number | null) => (x == null ? 'no earlier data' : `${x >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(x))}% vs previous ${s.len === 1 ? 'day' : s.len + ' days'}`);
  const fgD = (x: number | null) => (x == null ? '#8B7E6A' : x >= 0 ? '#2F5D4F' : '#A6471E');
  const rev = sum(pOrds);
  const prevRev = sum(pPrev);
  const kD = [
    dl(custs(pOrds), custs(pPrev)),
    dl(units(pOrds), units(pPrev)),
    dl(rev, prevRev),
    prevOrders ? dl(rev / (pOrders || 1), prevRev / prevOrders) : null,
  ];
  const aov = rev / (pOrders || 1);
  const allAov = allRev / allOrders;

  const profCard = (title: string, key: DimKey, keys: readonly string[], note: string, countLabel: string, byUnits = false): ProfileCard => {
    const a = distOf(ds, pOrds, key, keys, byUnits);
    const b = distOf(ds, pPrev, key, keys, byUnits);
    const prevKnown = byUnits ? units(pPrev) > 0 : pPrev.length > 0;
    return {
      title, note, countLabel,
      rows: a.map((r) => {
        const pp = b.find((x) => x.k === r.k)?.p ?? 0;
        const dd = prevKnown ? r.p - pp : null;
        return {
          label: r.k, n: r.n, share: P0(r.p), pct: r.p + '%',
          color: key === 'cat' ? SA_CAT_COLOR[r.k as SaCat] : r.color,
          d: dd == null ? '—' : Math.abs(dd) < 0.5 ? '±0' : `${dd > 0 ? '+' : '−'}${Math.abs(dd).toFixed(1)}`,
          dFg: dd == null || Math.abs(dd) < 0.5 ? '#8B7E6A' : dd > 0 ? '#2F5D4F' : '#A6471E',
        };
      }),
    };
  };

  const gm = new Map<string, { units: number; rev: number; cat: SaCat; lines: SaleLine[] }>();
  for (const o of pOrds) {
    const g = gm.get(o.model) ?? { units: 0, rev: 0, cat: o.cat, lines: [] };
    g.units += o.qty; g.rev += amt(o); g.lines.push(o); gm.set(o.model, g);
  }
  const gTop = [...gm.entries()].sort((a, b) => b[1].rev - a[1].rev).slice(0, 8);
  const gMax = gTop.length ? gTop[0]![1].rev : 1;
  const allM = new Map<string, number>();
  for (const o of s.ords) allM.set(o.model, (allM.get(o.model) ?? 0) + amt(o));

  const dims: Record<'race' | 'age' | 'gender' | 'state', readonly string[]> = {
    race: SA_RACES, age: SA_AGES, gender: SA_GENDERS, state: ds.states,
  };
  const heat = SA_CATS.map(([cat, color]) => {
    const rows = pOrds.filter((o) => o.cat === cat);
    const tot = orderCount(rows) || 1;
    return {
      label: cat, color,
      cells: dims[heatDim].map((dv) => {
        const v = orderCount(rows.filter((o) => dimOf(ds, o, heatDim) === dv)) / tot;
        const k = heatDim === 'gender' ? 0.8 : 1.4;
        const cut = heatDim === 'gender' ? 0.6 : 0.4;
        return { v: P0(v * 100), bg: `rgba(232,107,58,${(0.06 + v * k).toFixed(2)})`, fg: v > cut ? '#fff' : '#221F20' };
      }),
    };
  });

  const crLine = [
    crit.race !== 'all' ? crit.race : '',
    crit.gender !== 'all' ? crit.gender.toLowerCase() : '',
    crit.age !== 'all' ? 'aged ' + crit.age : '',
    crit.state !== 'all' ? 'in ' + crit.state : '',
  ].filter(Boolean).join(', ');

  /* Gross margin, for the finance tier only (Houzs sends it to no one else).
     Compared like the other KPIs — with the previous period, or with all
     customers while criteria are set — but in points, not percent. */
  const mg = marginSum(pOrds);
  const mPct = marginPct(mg);
  const mVs = marginPct(marginSum(cfCount ? s.ords : pPrev));
  const mD = mPct != null && mVs != null ? mPct - mVs : null;
  const pts = (x: number) => `${Math.abs(x).toFixed(1)} pts`;
  const marginKpi = {
    label: 'Gross margin',
    value: P1(mPct),
    sub: `${RMk(mg.rm)} · ${mD == null
      ? (cfCount ? 'no comparison' : 'no earlier data')
      : cfCount ? `${mD >= 0 ? '+' : '−'}${pts(mD)} vs all customers`
      : `${mD >= 0 ? '▲' : '▼'} ${pts(mD)} vs previous ${s.len === 1 ? 'day' : s.len + ' days'}`}`,
    subFg: fgD(mD),
  };

  return {
    cfCount,
    cfLine: cfCount ? `Customers ${crLine} · ${s.label}` : `All customers · ${s.label}`,
    margins: ds.margins,
    marginNote: ds.margins && mg.unknown > 0
      ? `Gross margin leaves out ${RMk(mg.unknown)} of sales that have no cost recorded yet.`
      : null,
    kpis: [
      { label: 'Customers', value: String(custs(pOrds)), sub: fmtD(kD[0]!), subFg: fgD(kD[0]!) },
      { label: 'Items bought', value: String(units(pOrds)), sub: `${pOrders} orders · ${fmtD(kD[1]!)}`, subFg: fgD(kD[1]!) },
      { label: 'Total revenue', value: RMk(rev), sub: cfCount ? `${P0((rev / allRev) * 100)} of all revenue` : fmtD(kD[2]!), subFg: cfCount ? '#5C5455' : fgD(kD[2]!) },
      {
        label: 'AOV', value: RMk(aov),
        sub: cfCount ? (() => { const x = dl(aov, allAov) ?? 0; return `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x))}% vs all customers`; })() : fmtD(kD[3]!),
        subFg: cfCount ? (aov >= allAov ? '#2F5D4F' : '#A6471E') : fgD(kD[3]!),
      },
      ...(ds.margins ? [marginKpi] : []),
    ],
    profile: [
      profCard('Race', 'race', SA_RACES, s.label, 'Orders'),
      profCard('Age', 'age', SA_AGES, s.label, 'Orders'),
      profCard('Location', 'state', ds.states, s.label, 'Orders'),
      profCard('Category', 'cat', SA_CATS.map((c) => c[0]), 'By units sold', 'Units', true),
    ],
    products: gTop.map(([name, g], i) => {
      const sg = g.rev / (rev || 1);
      const sa0 = (allM.get(name) ?? 0) / allRev;
      const ix = sa0 ? sg / sa0 : 1;
      return {
        rank: i + 1, name, cat: g.cat, color: SA_CAT_COLOR[g.cat], units: g.units, rev: RMk(g.rev),
        margin: ds.margins ? P1(marginPct(marginSum(g.lines))) : '',
        pct: (g.rev / gMax) * 100 + '%', share: P0(sg * 100),
        idx: cfCount ? ix.toFixed(1) + '×' : '',
        idxFg: ix >= 1.2 ? '#2F5D4F' : ix <= 0.8 ? '#A6471E' : '#5C5455',
        idxBg: ix >= 1.2 ? 'rgba(47,93,79,0.12)' : ix <= 0.8 ? 'rgba(232,107,58,0.12)' : '#F4F3F2',
      };
    }),
    productsEmpty: pOrds.length === 0,
    heatCols: [...dims[heatDim]],
    heat,
  };
}

export interface ProductView {
  catChips: Array<{ label: SaCat; dot: string; count: number }>;
  models: Array<{ rank: number; name: string; units: number; rev: string; pct: string; color: string }>;
  selName: string;
  pm: {
    name: string; cat: SaCat; color: string; rank: number; isSofa: boolean; mods: string[];
    line: string; facts: Array<{ value: string; label: string }>;
    variantTitle: string;
    variants: Array<{ label: string; units: number; share: string; pct: string; mods: string[]; short: string }>;
    trendTitle: string; trendN: number;
    trend: Array<{ v: string; h: string; label: string; tip: string }>;
    showrooms: Array<{ label: string; units: number; pct: string }>;
    profile: Array<{ title: string; rows: Array<{ label: string; n: number; share: string; pct: string; color: string; vs: string; vsFg: string }> }>;
    whoLine: string;
  };
  rangeLabel: string;
}

export function productView(ds: SalesDataset, f: SalesFilter, saCat: SaCat, saModel: string | null): ProductView {
  const s = scope(ds, f);
  const catOrds = s.ords.filter((o) => o.cat === saCat);
  const mm = new Map<string, { units: number; rev: number }>();
  for (const o of catOrds) {
    const g = mm.get(o.model) ?? { units: 0, rev: 0 };
    g.units += o.qty; g.rev += amt(o); mm.set(o.model, g);
  }
  const modelsSorted = [...mm.entries()].sort((a, b) => b[1].units - a[1].units);
  const maxU = modelsSorted.length ? modelsSorted[0]![1].units : 1;
  const selName = modelsSorted.find((m) => m[0] === saModel) ? saModel! : (modelsSorted[0]?.[0] ?? '');
  const mOrds = catOrds.filter((o) => o.model === selName);
  const mUnits = units(mOrds);
  const mRev = sum(mOrds);
  const catUnits = units(catOrds) || 1;
  const vm = new Map<string, number>();
  const vMods = new Map<string, string[]>();
  for (const o of mOrds) {
    vm.set(o.variant, (vm.get(o.variant) ?? 0) + o.qty);
    if (!vMods.has(o.variant)) vMods.set(o.variant, o.modules);
  }
  const vSorted = [...vm.entries()].sort((a, b) => b[1] - a[1]);
  const vMax = vSorted.length ? vSorted[0]![1] : 1;
  const daily = s.len <= 31;
  const rangeKeys: string[] = [];
  for (let k = monthKey(s.d0); k <= monthKey(s.d1);) {
    rangeKeys.push(k);
    const [y, m] = k.split('-').map(Number) as [number, number];
    const [ny, nm] = addMonths(y, m, 1);
    k = `${ny}-${String(nm).padStart(2, '0')}`;
  }
  const trendRaw = daily
    ? Array.from({ length: s.len }, (_, i) => {
        const dn = s.d0 + i;
        return { label: String(dparts(dn)[2]), tip: dfmt(dn), v: units(mOrds.filter((o) => o.day === dn)) };
      })
    : rangeKeys.map((k) => ({ label: MN[Number(k.split('-')[1]) - 1]!, tip: mLabel(k), v: units(mOrds.filter((o) => monthKey(o.day) === k)) }));
  const tMax = Math.max(1, ...trendRaw.map((t) => t.v));
  const srm = ds.showrooms
    .map((r) => ({ label: r.label.replace('Showroom ', ''), units: units(mOrds.filter((o) => o.showroom === r.id)) }))
    .sort((a, b) => b.units - a.units);
  const srMax = Math.max(1, ...srm.map((r) => r.units));
  const profDims: Array<[string, DimKey, readonly string[]]> = [
    ['Race', 'race', SA_RACES], ['Age', 'age', SA_AGES], ['Location', 'state', ds.states], ['Gender', 'gender', SA_GENDERS],
  ];
  const mProfile = profDims.map(([title, key, keys]) => {
    const a = distOf(ds, mOrds, key, keys);
    const b = distOf(ds, s.ords, key, keys);
    return {
      title,
      rows: a.filter((r) => r.n > 0).map((r) => {
        const d = r.p - (b.find((x) => x.k === r.k)?.p ?? 0);
        return {
          label: r.k, n: r.n, share: P0(r.p), pct: r.p + '%', color: r.color,
          vs: Math.abs(d) < 3 ? '' : (d > 0 ? '+' : '−') + Math.abs(Math.round(d)),
          vsFg: d > 0 ? '#2F5D4F' : '#A6471E',
        };
      }),
    };
  });
  const topOf = (d: { rows: Array<{ label: string; share: string }> }) =>
    [...d.rows].filter((r) => r.label !== UNKNOWN).sort((x, y) => parseFloat(y.share) - parseFloat(x.share))[0];
  const tR = topOf(mProfile[0]!);
  const tA = topOf(mProfile[1]!);
  const tL = topOf(mProfile[2]!);
  const best = vSorted[0];

  return {
    catChips: SA_CATS.map(([c, dot]) => ({ label: c, dot, count: units(s.ords.filter((o) => o.cat === c)) })),
    models: modelsSorted.map(([name, g], i) => ({
      rank: i + 1, name, units: g.units, rev: RMk(g.rev), pct: (g.units / maxU) * 100 + '%', color: SA_CAT_COLOR[saCat],
    })),
    selName,
    rangeLabel: s.label,
    pm: {
      name: selName || '—', cat: saCat, color: SA_CAT_COLOR[saCat],
      rank: Math.max(1, modelsSorted.findIndex((m) => m[0] === selName) + 1),
      isSofa: saCat === 'Sofa', mods: best ? (vMods.get(best[0]) ?? []) : [],
      line: best ? `Best seller: ${best[0]} · ${P0((best[1] / (mUnits || 1)) * 100)} of units` : 'No sales in this period',
      facts: [
        { value: String(mUnits), label: saCat === 'Sofa' ? 'Sets sold' : 'Units sold' },
        ...(saCat === 'Sofa' ? [{ value: String(mOrds.reduce((a, o) => a + o.modules.length * o.qty, 0)), label: 'Compartments' }] : []),
        { value: RMk(mRev), label: 'Revenue' },
        ...(ds.margins ? [{ value: P1(marginPct(marginSum(mOrds))), label: 'Gross margin' }] : []),
        { value: P0((mUnits / catUnits) * 100), label: `of ${saCat.toLowerCase()} units` },
      ],
      variantTitle: saCat === 'Sofa' ? 'Best-selling combos' : saCat === 'Accessory' ? 'Variants' : 'Best-selling sizes',
      variants: vSorted.map(([label, u]) => ({
        label, units: u, share: P0((u / (mUnits || 1)) * 100), pct: (u / vMax) * 100 + '%',
        mods: vMods.get(label) ?? [], short: label.split(' ').map((w) => w[0]).join(''),
      })),
      trendN: trendRaw.length,
      trendTitle: daily ? 'Daily units' : 'Monthly units',
      trend: trendRaw.map((t, i) => ({
        v: daily ? '' : (t.v ? String(t.v) : ''),
        h: Math.max(3, Math.round((t.v / tMax) * 96)) + 'px',
        label: daily && s.len > 14 && i % 5 !== 0 ? '' : t.label,
        tip: `${t.tip} · ${t.v} units`,
      })),
      showrooms: srm.map((r) => ({ ...r, pct: (r.units / srMax) * 100 + '%' })),
      profile: mProfile,
      whoLine: tR && tA && tL ? `Mostly ${tR.label} (${tR.share}), aged ${tA.label} (${tA.share}), in ${tL.label} (${tL.share}).` : '',
    },
  };
}

/* ── real data → lines ───────────────────────────────────────────────────── */

/** Age band of a customer's age on the day they bought (Houzs sends the age,
 *  never the birthday), or null when unknown / implausible. Under-18 buyers fold
 *  into the youngest band. */
export function ageBand(age: number | null | undefined): string | null {
  if (age == null || !Number.isFinite(age) || age < 0 || age > 110) return null;
  if (age < 25) return '18–24';
  if (age < 35) return '25–34';
  if (age < 45) return '35–44';
  if (age < 55) return '45–54';
  return '55+';
}

/** Location keys: the five states with the most orders, then 'Others' for the
 *  rest — the design's Selangor / KL / Penang / Johor / Perak / Others shape,
 *  driven by where customers actually are. */
export function stateKeys(lines: SaleLine[]): string[] {
  const n = new Map<string, Set<string>>();
  for (const o of lines) {
    if (!o.state) continue;
    const set = n.get(o.state) ?? new Set<string>();
    set.add(o.order);
    n.set(o.state, set);
  }
  const ranked = [...n.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0])).map(([k]) => k);
  return ranked.length > 5 ? [...ranked.slice(0, 5), 'Others'] : ranked;
}
