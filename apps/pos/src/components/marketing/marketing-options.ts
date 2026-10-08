// ----------------------------------------------------------------------------
// Every option list the Marketing forms offer, from the SAME sources a Sales
// Order line reads — the design's rule ("same options as a Sales Order line").
// The prototype hard-coded sample lists (four showrooms, three fabric series,
// 2"/4"/6" legs…); each one is replaced here by its live source:
//
//   showrooms          → the venue master (/venues) — the one branch list the
//                        order form and commission already share
//   models + photos    → the POS catalogue (/pos-pools/mfg-catalog)
//   fabric / colour    → the fabric library + colours
//   legs, seat, divan,
//   sizes, compartments→ the master Maintenance config
//
// Values are stored as the human-readable text the screens print ('4"',
// 'No leg', 'AM275', 'AM275-05 BROWN', 'Queen'): a display record is read by
// people, and the prototype stores them the same way.
// ----------------------------------------------------------------------------

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { maintActiveValues } from '@2990s/shared';
import { classifySofaCompartment, representativeArtCode } from '@2990s/shared/sofa-build';
import {
  fetchMfgCatalog, resolvePhotoUrl, useFabricColours, useFabricLibrary,
  type MfgAllowedOptions, type MfgCatalogApiRow,
} from '../../lib/queries';
import { useMaintenanceConfig } from '../../lib/products/mfg-products-queries';
import { useVenues, type VenueRow } from '../../lib/so-maintenance/venues-queries';
import { moduleInfo, sizeName, type DisplayType } from './marketing-model';

export interface ShowroomOption { id: string; name: string; area: string }

export interface ModelOption {
  id: string;
  name: string;
  code: string;
  type: DisplayType;
  photoUrl: string | null;
  /** Size codes this Model is sold in (K / Q / S / SS …). */
  sizeCodes: string[];
  allowed: MfgAllowedOptions | null;
}

export interface ModuleOption {
  id: string;
  label: string;
  dim: string;
  art: string;
  group: string;
}

export interface FabricSeriesOption { id: string; label: string }
export interface ColourOption { code: string; label: string; seriesId: string }

/* ── formatting ─────────────────────────────────────────────────────────── */

/** Maintenance stores bare inches ('4', '28') and 'No Leg'; the screens print
 *  '4"' and 'No leg' as the design does. Anything else passes through. */
export const inchOption = (v: string): string => {
  const t = v.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return `${t}"`;
  if (/^no\s*-?\s*legs?$/i.test(t)) return 'No leg';
  return t;
};

const SIZE_ORDER = ['S', 'SS', 'Q', 'K', 'SK', 'SP'];
const bySizeOrder = (a: string, b: string) => {
  const ia = SIZE_ORDER.indexOf(a.toUpperCase());
  const ib = SIZE_ORDER.indexOf(b.toUpperCase());
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
};

/** Builder group heading for a compartment code (design: 1-SEATER / 2-SEATER /
 *  CHAISE; live data adds the groups it has modules for). */
const GROUP_LABEL: Record<string, string> = {
  '1-seater': '1-Seater', '2-seater': '2-Seater', '3-seater': '3-Seater',
  'L-Shape': 'Chaise', Corner: 'Corner', Accessory: 'Accessory', Other: 'Other',
};
export const MODULE_GROUP_ORDER = ['1-Seater', '2-Seater', '3-Seater', 'Chaise', 'Corner', 'Accessory', 'Other'];

const TYPE_OF_CATEGORY: Record<string, DisplayType | undefined> = {
  SOFA: 'sofa', MATTRESS: 'mattress', BEDFRAME: 'bedframe', ACCESSORY: 'accessory',
};

/** The short code a display card prints beside the name: 'SOFA ANNSA',
 *  '2990 AKKA-FIRM MATT', 'ARIA'. */
const displayCode = (category: string, leadCode: string, modelCode: string): string => {
  if (category === 'SOFA') return `SOFA ${modelCode}`;
  return leadCode.replace(/\s*-?\s*\([^()]+\)\s*$/, '').trim() || modelCode;
};

function modelsFromCatalog(rows: MfgCatalogApiRow[]): Record<DisplayType, ModelOption[]> {
  const byModel = new Map<string, ModelOption>();
  for (const r of rows) {
    const type = TYPE_OF_CATEGORY[r.category];
    const m = r.product_models;
    if (!type || !r.model_id || !m || m.active === false) continue;
    let opt = byModel.get(r.model_id);
    if (!opt) {
      opt = {
        id: r.model_id, name: m.name, code: displayCode(r.category, r.code, m.model_code), type,
        photoUrl: resolvePhotoUrl(m.photo_url), sizeCodes: [], allowed: m.allowed_options ?? null,
      };
      byModel.set(r.model_id, opt);
    }
    if (r.size_code && !opt.sizeCodes.includes(r.size_code)) opt.sizeCodes.push(r.size_code);
  }
  const out: Record<DisplayType, ModelOption[]> = { sofa: [], mattress: [], bedframe: [], accessory: [] };
  for (const o of byModel.values()) {
    o.sizeCodes.sort(bySizeOrder);
    out[o.type].push(o);
  }
  for (const k of Object.keys(out) as DisplayType[]) out[k].sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/* ── the hook ───────────────────────────────────────────────────────────── */

export interface MarketingOptions {
  isLoading: boolean;
  showrooms: ShowroomOption[];
  models: Record<DisplayType, ModelOption[]>;
  fabricSeries: FabricSeriesOption[];
  colours: ColourOption[];
  sofaLegs: string[];
  bedLegs: string[];
  seats: string[];
  divans: string[];
  mattressSizes: string[];
  bedframeSizes: string[];
  modules: ModuleOption[];
  moduleLabel: (code: string) => string | null;
}

export function useMarketingOptions(): MarketingOptions {
  const venues = useVenues();
  const catalog = useQuery({
    queryKey: ['marketing', 'catalog'],
    staleTime: 60_000,
    queryFn: () => fetchMfgCatalog(),
  });
  const fabrics = useFabricLibrary();
  const colours = useFabricColours();
  const maint = useMaintenanceConfig('master');

  return useMemo<MarketingOptions>(() => {
    const cfg = (maint.data?.data ?? {}) as unknown as Record<string, unknown>;
    const values = (key: string) => maintActiveValues((cfg[key] ?? []) as Parameters<typeof maintActiveValues>[0]);
    const priced = (key: string) =>
      ((cfg[key] ?? []) as Array<{ value: string; active?: boolean }>)
        .filter((o) => o.active !== false)
        .map((o) => o.value);
    const meta = (cfg.sofaCompartmentMeta ?? {}) as Record<string, { description?: string }>;

    const showrooms = (venues.data ?? [])
      .filter((v) => v.active !== false)
      .map((v) => {
        const x = v as VenueRow & { city?: string | null; state?: string | null };
        return { id: v.id, name: v.name, area: [x.city, x.state].filter((s): s is string => !!s && !!s.trim()).join(', ') };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const modules: ModuleOption[] = values('sofaCompartments').map((code) => {
      const info = moduleInfo(code, meta[code]?.description);
      return {
        id: code, label: info.label, dim: info.dim,
        art: `/sofa-modules/${representativeArtCode(code)}.svg`,
        group: GROUP_LABEL[classifySofaCompartment(code)] ?? 'Other',
      };
    });

    return {
      isLoading: venues.isLoading || catalog.isLoading || fabrics.isLoading || colours.isLoading || maint.isLoading,
      showrooms,
      models: modelsFromCatalog(catalog.data ?? []),
      fabricSeries: (fabrics.data ?? []).map((f) => ({ id: f.id, label: f.label })),
      colours: (colours.data ?? []).map((c) => ({ code: c.colourId, label: c.label || c.colourId, seriesId: c.fabricId })),
      sofaLegs: priced('sofaLegHeights').map(inchOption),
      bedLegs: priced('legHeights').map(inchOption),
      seats: values('sofaSizes').map(inchOption),
      divans: priced('divanHeights').map(inchOption),
      mattressSizes: values('mattressSizes').sort(bySizeOrder).map(sizeName),
      bedframeSizes: values('bedframeSizes').sort(bySizeOrder).map(sizeName),
      modules,
      moduleLabel: (code: string) => meta[code]?.description ?? null,
    };
  }, [venues.data, venues.isLoading, catalog.data, catalog.isLoading, fabrics.data, fabrics.isLoading, colours.data, colours.isLoading, maint.data, maint.isLoading]);
}

/* ── per-Model narrowing (the Sales Order line's allowed-options rule) ──── */

/** The fabric series and colours a Model may be sold in. An empty allowed list
 *  is "no restriction", exactly as the server treats it. */
export function fabricsFor(opts: MarketingOptions, allowed: MfgAllowedOptions | null | undefined) {
  const codes = allowed?.fabrics ?? [];
  if (!codes.length) return { series: opts.fabricSeries, colours: opts.colours };
  const set = new Set(codes);
  const colours = opts.colours.filter((c) => set.has(c.code));
  const seriesIds = new Set(colours.map((c) => c.seriesId));
  const series = opts.fabricSeries.filter((s) => seriesIds.has(s.id));
  return series.length ? { series, colours } : { series: opts.fabricSeries, colours: opts.colours };
}

/** A Model's ticked list, formatted, or the master pool when it ticks none. */
export function allowedOr(pool: string[], allowed: string[] | undefined): string[] {
  const picked = (allowed ?? []).map(inchOption);
  return picked.length ? picked : pool;
}

/** Colour labels of one series (by the series LABEL the form stores). */
export function coloursOf(opts: { fabricSeries: FabricSeriesOption[]; colours: ColourOption[] }, seriesLabel: string): string[] {
  const s = opts.fabricSeries.find((x) => x.label === seriesLabel);
  if (!s) return [];
  return opts.colours.filter((c) => c.seriesId === s.id).map((c) => c.label);
}

/** The design's preferred default when the live list has it, else the first. */
export const preferred = (list: string[], want: string): string => (list.includes(want) ? want : list[0] ?? '');

/** A saved request keeps the text it was saved with, but the live list can
 *  drop it (a fabric series renamed or retired in the library). Without the
 *  stored value among the options its select would show "—" while the field
 *  still counts as filled, so it is appended. */
export const withValue = (list: string[], value: string): string[] =>
  value && !list.includes(value) ? [...list, value] : list;
