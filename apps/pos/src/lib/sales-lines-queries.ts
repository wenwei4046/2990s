// ----------------------------------------------------------------------------
// Order LINES for the Marketing › Sales analysis tab, from Houzs.
//
// The design needs every sold line with its day, showroom, model, combo and the
// customer's race / age / gender / state — so the date picker can filter by
// day, the showroom picker by showroom, and Customer criteria by demographic.
// The older GET /sales-analysis (the page this tab replaced) cannot serve
// that: it returns month-level rollups, and it strips the demographics.
//
// So this reads GET /sales-analysis/lines (Houzs, added for this page —
// backend/src/scm/routes/sales-analysis.ts, live since Houzs #4541). Every
// failure is shown as one, a 404 included: a 404 here means Houzs no longer
// serves the route (it has deleted POS routes as "dead code" before — see
// CLAUDE.md), and invented numbers would hide exactly that. Only the local
// simulation build, which has no Houzs behind it, shows the design's sample
// data, under its "Sample data" label.
//
// MARGIN arrives only for Houzs's finance tier (`canViewScmFinance`, with the
// cost display switch on); for anyone else the key is absent, never zero, and
// the views draw no margin at all.
// ----------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query';
import { findModule, normalizeCompartmentCode } from '@2990s/shared/sofa-build';
import { authedFetchRaw } from './apiClient';
import {
  ageBand, dnum, isoToDay, stateKeys, type SaCat, type SaleLine, type SalesDataset,
} from '../components/marketing/sales-model';
import { isSofaAccessory, shapeName, sizeName } from '../components/marketing/marketing-model';
import { sampleDataset } from '../components/marketing/sample-sales';
import { IS_SIMULATION } from './simulation-mode';

/** One line as Houzs sends it (scm/lib/sales-lines.ts over there). Facts, not
 *  labels: the variant each view prints is named here, by the same rules the
 *  showroom displays use. `totalSen` is the line's revenue after its discount,
 *  integer sen (hundredths of a ringgit); `age` is on the order date — Houzs
 *  does not send the birthday. */
export interface WireLine {
  docNo: string;
  soDate: string;
  venue: string | null;
  category: string;
  model: string;
  /** A sofa build's compartments, left to right; [] otherwise. */
  modules: string[] | null;
  sizeCode: string | null;
  sizeLabel: string | null;
  qty: number;
  totalSen: number;
  /** Revenue minus cost, integer sen: present for the finance tier only, and
   *  null where a priced line has no cost yet. */
  marginSen?: number | null;
  customerId: string | null;
  race: string | null;
  age: number | null;
  gender: string | null;
  state: string | null;
}

const CAT: Record<string, SaCat | undefined> = {
  SOFA: 'Sofa', MATTRESS: 'Mattress', BEDFRAME: 'Bed frame', ACCESSORY: 'Accessory',
};

/** What a line is, as the views group it: a sofa by its layout, a mattress or
 *  bed frame by its size, an accessory by its size label. A "sofa" that is only
 *  a stool, console or headrest is an accessory sold on its own. */
function classify(w: WireLine, cat: SaCat): { cat: SaCat; variant: string; modules: string[] } {
  const all = Array.isArray(w.modules) ? w.modules.map(String) : [];
  if (cat === 'Sofa') {
    const seats = all.filter((m) => !isSofaAccessory(m));
    if (seats.length) return { cat, variant: shapeName(seats), modules: seats };
    const names = [...new Set(all.map((m) => findModule(normalizeCompartmentCode(m))?.label ?? m))];
    return { cat: 'Accessory', variant: names.join(' + ') || 'Standard', modules: [] };
  }
  if (cat === 'Mattress' || cat === 'Bed frame') {
    return { cat, variant: (w.sizeCode ? sizeName(w.sizeCode) : '') || w.sizeLabel?.trim() || '—', modules: [] };
  }
  return { cat, variant: w.sizeLabel?.trim() || 'Standard', modules: [] };
}

/** Today in Malaysia, as a day number — the picker's last selectable day. */
export const todayMy = (): number => {
  const t = new Date(Date.now() + 8 * 3_600_000);
  return dnum(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
};

export function datasetFromWire(lines: WireLine[]): SalesDataset {
  const out: SaleLine[] = [];
  const showrooms = new Map<string, string>();
  // Houzs puts the key on every line or on none (scm/lib/sales-lines.ts).
  const margins = lines.some((w) => w != null && typeof w === 'object' && 'marginSen' in w);
  for (const w of lines) {
    const wireCat = CAT[String(w.category).toUpperCase()];
    const day = isoToDay(w.soDate ?? '');
    if (!wireCat || day == null || !(w.qty > 0)) continue;
    const venue = w.venue?.trim() || '';
    const showroom = venue || 'unknown';
    showrooms.set(showroom, venue || 'Unassigned');
    const totalSen = typeof w.totalSen === 'number' && Number.isFinite(w.totalSen) ? w.totalSen : 0;
    const { cat, variant, modules } = classify(w, wireCat);
    out.push({
      order: w.docNo,
      day,
      showroom,
      cat,
      model: w.model || '—',
      variant,
      modules,
      qty: w.qty,
      amount: totalSen / 100 / w.qty,
      ...(margins
        ? { margin: typeof w.marginSen === 'number' && Number.isFinite(w.marginSen) ? w.marginSen / 100 / w.qty : null }
        : {}),
      cust: w.customerId ?? `walk-in:${w.docNo}`,
      race: w.race || null,
      age: ageBand(w.age),
      gender: w.gender || null,
      state: w.state?.trim() || null,
    });
  }
  const today = todayMy();
  const first = out.reduce((m, o) => Math.min(m, o.day), today);
  return {
    lines: out,
    showrooms: [...showrooms.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
    states: stateKeys(out),
    d0: first,
    d1: today,
    margins,
    sample: false,
  };
}

export async function fetchSalesLines(includeTest: boolean): Promise<SalesDataset> {
  const params = new URLSearchParams();
  if (includeTest) params.set('includeTest', 'true');
  const qs = params.toString();
  const res = await authedFetchRaw(`/sales-analysis/lines${qs ? `?${qs}` : ''}`);
  if (res.status === 404) {
    throw new Error('HouzsERP does not serve the sales lines this page reads (GET /sales-analysis/lines returned 404).');
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as { lines?: WireLine[] };
  return datasetFromWire(body.lines ?? []);
}

export function useSalesLines(includeTest: boolean, enabled: boolean) {
  return useQuery<SalesDataset>({
    queryKey: ['marketing', 'sales-lines', includeTest],
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      if (IS_SIMULATION) {
        const { simulationPersona } = await import('../simulation/marketing');
        return sampleDataset(simulationPersona() === 'director');
      }
      return fetchSalesLines(includeTest);
    },
  });
}
