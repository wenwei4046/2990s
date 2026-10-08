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
// backend/src/scm/routes/sales-analysis.ts). Until a Houzs build that serves it
// is deployed the route 404s, and the tab falls back to the design's sample
// data, clearly labelled "Sample data". A 404 is the ONLY status that falls
// back: anything else is a real failure and is shown as one, never papered
// over with invented numbers.
// ----------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query';
import { findModule, normalizeCompartmentCode } from '@2990s/shared/sofa-build';
import { authedFetchRaw } from './apiClient';
import {
  ageBand, dnum, isoToDay, stateKeys, type SaCat, type SaleLine, type SalesDataset,
} from '../components/marketing/sales-model';
import { isSofaAccessory, shapeName, sizeName } from '../components/marketing/marketing-model';
import { sampleDataset } from '../components/marketing/sample-sales';

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
    sample: false,
  };
}

export function useSalesLines(includeTest: boolean, enabled: boolean) {
  return useQuery<SalesDataset>({
    queryKey: ['marketing', 'sales-lines', includeTest],
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (includeTest) params.set('includeTest', 'true');
      const qs = params.toString();
      const res = await authedFetchRaw(`/sales-analysis/lines${qs ? `?${qs}` : ''}`);
      if (res.status === 404) return sampleDataset();
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text.slice(0, 200)}`);
      }
      const body = (await res.json()) as { lines?: WireLine[] };
      return datasetFromWire(body.lines ?? []);
    },
  });
}
