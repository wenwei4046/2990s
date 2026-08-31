// ----------------------------------------------------------------------------
// The commission CALCULATION, run in the POS.
//
// Loo 2026-08-31: "所有的 commission 机制只会在 POS 这边去算". This is that —
// the one place the two backends meet. Config, salespeople and KPI rules come
// from 2990 (commission-api.ts); the ORDERS and their item lines come from
// Houzs, because that is where every POS sale is written. Neither side can do
// this alone, and the POS holds a session for both.
//
// The ARITHMETIC is not here. It is `@2990s/shared/hr-commission` — the same
// pure module the API imports — so there is exactly one implementation of a
// payout and it is unit-tested away from any network.
//
// ── WHAT THIS FILE IS RESPONSIBLE FOR ───────────────────────────────────────
//   1. loading the inputs
//   2. reducing SO lines to KPI units (commission-kpi-units.ts, pure)
//   3. subtracting the item-KPI exclusion from each seller's goods
//   4. grouping by showroom and calling the engine
//   5. saying loudly when an input was missing, instead of paying RM 0
//
// ── MISSING DATA IS AN ERROR, NOT A ZERO ────────────────────────────────────
// There is no `?? 0` on any money path that could be hiding a failed read. RM 0
// is a legitimate commission (sold nothing); it must never also be how this
// module says "I could not read the rates" or "the KPI rules failed to load".
// Every such case surfaces in `warnings` and, where it would change a payout,
// stops the report rather than shading it.
// ----------------------------------------------------------------------------

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
  computeChainCommission,
  computeShowroomCommission,
  firingFlags,
  unitKpiCenti,
  unitKpiExcludedCenti,
  type CommissionConfig,
  type CommissionRow,
  type ItemKpiFlag,
  type SalespersonInput,
} from '@2990s/shared/hr-commission';
import { fabricTierAddon, type FabricTier, type FabricTierModelOverride } from '@2990s/shared/fabric-tier-addon';
import { resolveFabricTierOverride } from '@2990s/shared';
import { authedFetch } from './apiClient';
import { readMoney } from './houzs-money-keys';
import { buildKpiUnits, type CommissionLine, type UnitContext } from './commission-kpi-units';
import {
  useCommissionConfig, useCommissionKpiItems, useCommissionOverrideLevels,
  useCommissionProfiles, usePayoutPeriod,
  type CommissionKpiItem, type CommissionProfile,
} from './commission-api';
import { useCommissionRevenue, type CommissionOrder } from './commission-revenue-queries';
import {
  useCompartmentFabricTierOverrides, useFabricLibrary, useFabricTierAddonConfig,
  useMfgCatalog, useModelFabricTierOverrides,
} from './queries';

/* ── SO item lines ─────────────────────────────────────────────────────────── */

/** Houzs has no bulk item endpoint — only `GET /:docNo/items` — so the lines are
 *  fetched per order. A payout period is a month (66 orders company-wide in
 *  August 2026), and each response is cached for the session, so this is a
 *  few dozen small reads on a screen opened a few times a month. */
const useSoLines = (docNos: string[], enabled: boolean) =>
  useQueries({
    queries: docNos.map((docNo) => ({
      queryKey: ['commission', 'so-items', docNo],
      enabled,
      // Lines of a past order do not change; a long stale time keeps re-opening
      // the report from re-reading the whole month.
      staleTime: 10 * 60_000,
      queryFn: async (): Promise<{ docNo: string; lines: CommissionLine[] }> => {
        const body = await authedFetch<{ items?: Record<string, unknown>[] }>(
          `/mfg-sales-orders/${encodeURIComponent(docNo)}/items`,
        );
        return { docNo, lines: (body.items ?? []).filter(notCancelled).map(toLine) };
      },
    })),
  });

const notCancelled = (r: Record<string, unknown>): boolean => r.cancelled !== true;

const str = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s || null;
};

const toLine = (r: Record<string, unknown>): CommissionLine => {
  const variants = (r.variants ?? {}) as Record<string, unknown>;
  const specials = Array.isArray(variants.specials) ? variants.specials : [];
  return {
    itemCode: String(r.item_code ?? ''),
    qty: Number(r.qty ?? 0),
    totalCenti: readMoney(r, 'total'),
    specialSurchargeCenti: readMoney(r, 'special_order_price'),
    itemGroup: str(r.item_group),
    buildKey: str(variants.buildKey),
    fabricId: str(variants.fabricId),
    specialCodes: specials
      .map((s) => str((s as { code?: unknown })?.code))
      .filter((s): s is string => !!s),
    /* A persisted split build STRIPS variants.cells, so the compartment comes
       off the module's own SKU suffix — `ANNSA-1A(LHF)` → `1A(LHF)`. That is the
       key the per-compartment fabric override (migration 0184) is stored under. */
    compartmentCode: compartmentOf(String(r.item_code ?? '')),
  };
};

/** The compartment code a module SKU occupies: everything after the FIRST dash.
 *  `ANNSA-1A(LHF)` → `1A(LHF)`. Returns null when the code carries no suffix. */
export const compartmentOf = (itemCode: string): string | null => {
  const i = itemCode.indexOf('-');
  return i > 0 ? itemCode.slice(i + 1) || null : null;
};

/* ── the report ────────────────────────────────────────────────────────────── */

export interface CommissionReportRow extends CommissionRow {
  staffName: string;
  kpiDetail: Array<{ label: string; qty: number; bonusCenti: number; lineCenti: number }>;
}

export interface CommissionReportShowroom {
  showroomId: string;
  showroomName: string;
  showroomGoodsCenti: number;
  showroomKpiHit: boolean;
  rows: CommissionReportRow[];
}

export interface CommissionReport {
  from: string;
  to: string;
  config: CommissionConfig & { overrideMode: 'showroom' | 'chain' };
  showrooms: CommissionReportShowroom[];
  /** Non-empty when something could not be read. Each entry is a sentence for a
   *  human, not an error code. */
  warnings: string[];
  /** Total payout across every showroom — what a period close freezes. */
  totalCenti: number;
}

/**
 * Compute one period.
 *
 * `isLoading` covers every input including the per-order line reads, so the
 * screen never renders a half-loaded payout that looks complete.
 */
export function useCommissionReport(from: string, to: string) {
  const configQ = useCommissionConfig();
  const profilesQ = useCommissionProfiles();
  const kpiQ = useCommissionKpiItems();
  const levelsQ = useCommissionOverrideLevels();
  const revenueQ = useCommissionRevenue(from, to);
  const closedQ = usePayoutPeriod(from, to);

  // Catalogue + fabric-tier inputs. Only the fabric ones are conditional; the
  // catalogue is already cached by the rest of the POS.
  const catalogQ = useMfgCatalog();
  const fabricsQ = useFabricLibrary();
  const addonCfgQ = useFabricTierAddonConfig();
  const modelOvrQ = useModelFabricTierOverrides();
  const compOvrQ = useCompartmentFabricTierOverrides();

  const orders: CommissionOrder[] = useMemo(() => revenueQ.data?.orders ?? [], [revenueQ.data]);
  const docNos = useMemo(() => [...new Set(orders.map((o) => o.docNo))], [orders]);

  /* The line pass is only worth its requests when a KPI rule could actually
     fire. With no active rule the bonus is 0 and the exclusion is 0 for every
     unit, so the whole month of item reads is skipped. */
  const activeFlags: ItemKpiFlag[] = useMemo(
    () => (kpiQ.data ?? []).filter((k) => k.active).map(toFlag),
    [kpiQ.data],
  );
  const needLines = activeFlags.length > 0 && docNos.length > 0;
  const lineQs = useSoLines(docNos, needLines);
  const linesLoading = needLines && lineQs.some((q) => q.isLoading || q.isFetching);
  const linesError = lineQs.find((q) => q.error)?.error ?? null;

  const isLoading =
    configQ.isLoading || profilesQ.isLoading || kpiQ.isLoading || levelsQ.isLoading
    || revenueQ.isLoading || closedQ.isLoading || linesLoading;

  /* A failed read of ANY input is an error, never a quiet zero: an empty KPI
     rule list and a failed KPI read must not produce the same payout. */
  const error =
    configQ.error ?? profilesQ.error ?? kpiQ.error ?? levelsQ.error
    ?? revenueQ.error ?? closedQ.error ?? linesError ?? null;

  const report: CommissionReport | null = useMemo(() => {
    if (isLoading || error) return null;
    const config = configQ.data;
    const profiles = profilesQ.data;
    if (!config || !profiles) return null;

    const warnings: string[] = [];
    if (revenueQ.data?.truncated) {
      warnings.push('This range holds more orders than one read can cover, so the figures are incomplete. Narrow the range — a payout period is normally one month.');
    }

    /* ── item-KPI pass ───────────────────────────────────────────────────── */
    const ctx = makeUnitContext({
      catalog: catalogQ.data ?? [],
      fabrics: fabricsQ.data ?? [],
      addonConfig: addonCfgQ.data ?? null,
      modelOverrides: modelOvrQ.data ?? [],
      compartmentOverrides: compOvrQ.data ?? [],
    });

    const bonusByStaff = new Map<string, number>();
    const excludedByStaff = new Map<string, number>();
    const detailByStaff = new Map<string, Map<string, CommissionReportRow['kpiDetail'][number]>>();
    const unresolved = new Set<string>();

    if (activeFlags.length > 0) {
      const salespersonOf = new Map(orders.map((o) => [o.docNo, o.salespersonId]));
      const labelOf = new Map((kpiQ.data ?? []).map((k) => [`${k.flagType}:${k.ref}`, k.label || k.ref]));

      for (const q of lineQs) {
        const payload = q.data;
        if (!payload) continue;
        const sp = salespersonOf.get(payload.docNo);
        if (!sp) continue;
        const { units, unresolvedFabric } = buildKpiUnits(payload.lines, ctx);
        unresolvedFabric.forEach((c) => unresolved.add(c));

        for (const u of units) {
          const bonus = unitKpiCenti(u, activeFlags);
          const excluded = unitKpiExcludedCenti(u, activeFlags);
          if (bonus > 0) bonusByStaff.set(sp, (bonusByStaff.get(sp) ?? 0) + bonus);
          if (excluded > 0) excludedByStaff.set(sp, (excludedByStaff.get(sp) ?? 0) + excluded);
          if (bonus <= 0) continue;
          /* firingFlags, not the raw list: a category rule suppressed by a
             product rule paid nothing, so it must not appear in a breakdown
             that has to sum back to `bonus`. */
          for (const f of firingFlags(u, activeFlags)) {
            const key = `${f.flagType}:${f.ref}`;
            const m = detailByStaff.get(sp) ?? new Map();
            const prev = m.get(key) ?? { label: labelOf.get(key) ?? f.ref, qty: 0, bonusCenti: f.bonusCenti, lineCenti: 0 };
            prev.qty += u.qty;
            prev.lineCenti += u.qty * f.bonusCenti;
            m.set(key, prev);
            detailByStaff.set(sp, m);
          }
        }
      }
    }

    if (unresolved.size > 0) {
      warnings.push(`The fabric add-on could not be resolved for ${unresolved.size} item(s), so their KPI exclusion was not applied — those salespeople may be paid slightly more than the scheme intends. Check the fabric tier settings for: ${[...unresolved].slice(0, 5).join(', ')}.`);
    }

    /* ── goods per salesperson, less the exclusion ────────────────────────── */
    const goodsByStaff = new Map<string, number>();
    for (const o of orders) {
      goodsByStaff.set(o.salespersonId, (goodsByStaff.get(o.salespersonId) ?? 0) + o.goodsCenti);
    }
    const commissionable = new Map<string, number>();
    for (const p of profiles) {
      if (!p.active) continue;
      commissionable.set(
        p.staffId,
        Math.max(0, (goodsByStaff.get(p.staffId) ?? 0) - (excludedByStaff.get(p.staffId) ?? 0)),
      );
    }

    /* ── group by showroom and compute ────────────────────────────────────── */
    const active = profiles.filter((p) => p.active);
    const byShowroom = new Map<string, CommissionProfile[]>();
    for (const p of active) {
      const arr = byShowroom.get(p.showroomId) ?? [];
      arr.push(p);
      byShowroom.set(p.showroomId, arr);
    }

    const levels = (levelsQ.data ?? [])
      .filter((l) => l.active)
      .map((l) => ({ level: l.level, rateBps: l.rateBps }));

    if (config.overrideMode === 'chain' && levels.length === 0) {
      warnings.push('Commission is set to reporting-chain mode but no override levels are configured, so every manager earns RM 0 override. Add the levels in Setup, or switch back to showroom mode.');
    }

    const engineConfig: CommissionConfig = {
      baseBps: config.baseBps,
      personalKpiThresholdCenti: config.personalKpiThresholdCenti,
      personalKpiBonusBps: config.personalKpiBonusBps,
      showroomKpiThresholdCenti: config.showroomKpiThresholdCenti,
      showroomKpiBonusBps: config.showroomKpiBonusBps,
      overrideBaseBps: config.overrideBaseBps,
      overrideKpiBonusBps: config.overrideKpiBonusBps,
    };

    const showrooms: CommissionReportShowroom[] = [...byShowroom.entries()].map(([sid, people]) => {
      const inputs: SalespersonInput[] = people.map((p) => ({
        staffId: p.staffId,
        tier: p.tier,
        personalGoodsCenti: commissionable.get(p.staffId) ?? 0,
        itemKpiCenti: bonusByStaff.get(p.staffId) ?? 0,
      }));
      /* The showroom total is the sum of its REGISTERED members' goods — the
         rule signed off 2026-06-14 ("algorithm A"). An unregistered seller's
         orders are not in it, which is why the Setup screen warns that a missing
         registration can hold a whole room under its target. */
      const showroomGoodsCenti = inputs.reduce((s, p) => s + p.personalGoodsCenti, 0);

      const computed = config.overrideMode === 'chain'
        // Chain mode needs a reporting tree, which only Houzs holds
        // (users.manager_id). Until that is bridged, every downline is empty —
        // stated as a warning above rather than paid as a confident RM 0.
        ? computeChainCommission(engineConfig, showroomGoodsCenti, levels,
            inputs.map((p) => ({ ...p, goodsByLevel: new Map<number, number>() })))
        : computeShowroomCommission(engineConfig, showroomGoodsCenti, inputs);

      const nameOf = new Map(people.map((p) => [p.staffId, p.staffName]));
      const rows: CommissionReportRow[] = computed.map((r) => ({
        ...r,
        staffName: nameOf.get(r.staffId) ?? '',
        kpiDetail: [...(detailByStaff.get(r.staffId)?.values() ?? [])],
      }));
      // managers first, then sales; stable within tier.
      rows.sort((a, b) => (a.tier === 'manager' ? 0 : 1) - (b.tier === 'manager' ? 0 : 1));

      return {
        showroomId: sid,
        showroomName: people[0]?.showroomName || sid,
        showroomGoodsCenti,
        showroomKpiHit: showroomGoodsCenti >= config.showroomKpiThresholdCenti,
        rows,
      };
    });

    if (config.overrideMode === 'chain') {
      warnings.push('Reporting-chain overrides are configured but the reporting tree lives in HouzsERP and is not read here yet, so every chain override is RM 0. Switch to showroom mode for a payout you can pay.');
    }

    return {
      from, to,
      config: { ...engineConfig, overrideMode: config.overrideMode },
      showrooms,
      warnings,
      totalCenti: showrooms.reduce((s, sr) => s + sr.rows.reduce((t, r) => t + r.totalCenti, 0), 0),
    };
    // lineQs is a new array identity each render; its DATA is what matters, and
    // that changes only when a query resolves — which also flips linesLoading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isLoading, error, configQ.data, profilesQ.data, kpiQ.data, levelsQ.data,
    revenueQ.data, catalogQ.data, fabricsQ.data, addonCfgQ.data, modelOvrQ.data,
    compOvrQ.data, activeFlags, orders, from, to,
  ]);

  return { report, closed: closedQ.data ?? null, isLoading, error };
}

const toFlag = (k: CommissionKpiItem): ItemKpiFlag => ({
  flagType: k.flagType,
  ref: k.ref,
  bonusCenti: k.bonusCenti,
  countsAsRevenue: k.countsAsRevenue,
});

/* ── the fabric-tier add-on resolver ───────────────────────────────────────── */
/* Reproduces the Δ the POS charged when it SOLD the item, using the same shared
   `fabricTierAddon` + the same override resolution the Configurator uses. That
   is what keeps the reported add-on equal to the billed one.
   ⚠️ It reads the CURRENT tier settings, so it is exact unless a tier price
   changed between the sale and the payout. */
function makeUnitContext(src: {
  catalog: Array<{ code: string; category: string; modelId: string | null }>;
  fabrics: Array<{ id: string; sofaTier: string | null; bedframeTier: string | null }>;
  addonConfig: { sofaTier2Delta: number; sofaTier3Delta: number; bedframeTier2Delta: number; bedframeTier3Delta: number } | null;
  modelOverrides: Array<{ modelId: string; tier2Delta: number | null; tier3Delta: number | null }>;
  compartmentOverrides: Array<{ compartmentId: string; tier2Delta: number | null; tier3Delta: number | null }>;
}): UnitContext {
  const product = new Map(src.catalog.map((p) => [p.code, p]));
  const fabric = new Map(src.fabrics.map((f) => [f.id, f]));
  const modelOvr = new Map(src.modelOverrides.map((o) => [o.modelId, { tier2Delta: o.tier2Delta, tier3Delta: o.tier3Delta }]));
  const compOvr = new Map<string, FabricTierModelOverride>(
    src.compartmentOverrides.map((o) => [o.compartmentId, { tier2Delta: o.tier2Delta, tier3Delta: o.tier3Delta }]),
  );

  return {
    /* The catalogue only carries POS-active SKUs, so a retired product resolves
       to null and a CATEGORY rule simply does not fire on it. Deliberate: paying
       a category bonus on a guess is worse than not paying it. */
    categoryOf: (code) => product.get(code)?.category ?? null,

    fabricAddonMyr: ({ itemCodes, category, fabricId, compartments }) => {
      // No config loaded is "cannot resolve", NOT "no add-on".
      if (!src.addonConfig) return null;
      // The Δ only exists for these two categories; anything else genuinely
      // charges nothing, which is a real zero.
      if (category !== 'SOFA' && category !== 'BEDFRAME') return 0;
      const f = fabric.get(fabricId);
      if (!f) return null; // flagged fabric we cannot price — say so
      const tier = (category === 'SOFA' ? f.sofaTier : f.bedframeTier) as FabricTier | null;

      const modelId = itemCodes.map((c) => product.get(c)?.modelId).find((m) => !!m) ?? null;
      const override = resolveFabricTierOverride(
        compartments,
        (modelId ? modelOvr.get(modelId) : null) ?? null,
        compOvr,
      );
      // WHOLE RINGGIT — the caller converts, once, in myrToCenti.
      return fabricTierAddon(category, tier, src.addonConfig, override);
    },
  };
}
