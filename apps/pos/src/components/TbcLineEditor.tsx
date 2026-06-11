// TBC fill-in editor (Loo 2026-06-11) — completes a customer's deferred picks
// (fabric / leg height / gap / divan / special add-ons) on an EXISTING Sales
// Order line, from the My-orders drawer. Pricing is server-authoritative: the
// API's /tbc-update endpoint moves the line by the surcharge DELTA only, and
// rejects any change that would drop the bill below the original SO total
// (POS sales callers). The figures shown here are a preview from the same
// maintenance tables; the server's answer is final.
//
// A product swap (/tbc-swap) exchanges the line for a different non-sofa SKU,
// repriced from the SKU Master with every option reset to TBC — the same
// floor rule applies.

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { fmtRM, fabricTierAddon, type FabricTier } from '@2990s/shared';
import { supabase } from '../lib/supabase';
import {
  useFabricLibrary,
  useFabricColours,
  useModelAllowedFabricCodes,
  useModelAllowedSpecials,
  useBedframeCustomizerData,
  useSofaLegHeights,
  useSpecialAddons,
  useFabricTierAddonConfig,
  type ProductFabricRow,
  type BedframeOptionRow,
} from '../lib/queries';
import { FabricColourPicker, type FabricSelection } from './FabricColourPicker';
import { OptionSelect } from './BedframeOptions';
import { SpecialAddonsPicker, specialSelSurchargeRM, specialSelsSurcharge, type SpecialSel } from './SpecialAddonsPicker';
import { Button } from '@2990s/design-system';
import styles from './TbcLineEditor.module.css';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export interface TbcEditTarget {
  itemId: string;
  itemCode: string;
  itemGroup: string; // 'sofa' | 'bedframe' | 'mattress' | 'accessory' | 'others'
  qty: number;
  unitPriceCenti: number;
  discountCenti: number;
  variants: Record<string, unknown>;
  isSofaBuild: boolean;
}

/* Resolve the SO line's mfg product row by CODE — the SO stores item_code,
   while every configurator data hook keys on mfg_products.id ('mfg-…'). */
const useMfgProductByCode = (code: string) =>
  useQuery({
    enabled: !!code,
    queryKey: ['mfg-product-by-code', code],
    staleTime: 60_000,
    queryFn: async (): Promise<{ id: string; model_id: string | null; category: string; base_model: string | null } | null> => {
      const { data, error } = await supabase
        .from('mfg_products')
        .select('id, model_id, category, base_model')
        .eq('code', code)
        .maybeSingle();
      if (error) throw error;
      return (data as { id: string; model_id: string | null; category: string; base_model: string | null } | null) ?? null;
    },
  });

/* Swap-candidate search — active, POS-visible, non-sofa SKUs by code / name. */
const useSwapCandidates = (q: string) =>
  useQuery({
    enabled: q.trim().length >= 2,
    queryKey: ['tbc-swap-candidates', q],
    staleTime: 30_000,
    queryFn: async (): Promise<Array<{ code: string; name: string; category: string; sell_price_sen: number | null }>> => {
      const term = q.trim().replace(/[%_,()]/g, ' ');
      const { data, error } = await supabase
        .from('mfg_products')
        .select('code, name, category, sell_price_sen')
        .eq('status', 'ACTIVE')
        .eq('pos_active', true)
        .neq('category', 'SOFA')
        .or(`code.ilike.%${term}%,name.ilike.%${term}%`)
        .order('code')
        .limit(8);
      if (error) throw error;
      return (data ?? []) as Array<{ code: string; name: string; category: string; sell_price_sen: number | null }>;
    },
  });

const friendlyError = (payload: Record<string, unknown>): string => {
  const err = String(payload.error ?? '');
  if (err === 'so_total_below_original') {
    return 'This change would bring the bill below the original sales order total — it can only stay equal or go up.';
  }
  if (err === 'variant_not_allowed') {
    return `This Model doesn't allow ${String(payload.field ?? 'that option')} "${String(payload.value ?? '')}".`;
  }
  if (err === 'pwp_line_locked') return 'PWP reward lines are edited by the coordinator.';
  if (err === 'product_unpriced') return 'That product has no selling price yet — ask an admin to price it first.';
  if (err === 'so_sofa_no_other_main') return 'A sofa cannot share a sales order with a bedframe or mattress.';
  if (err === 'so_has_children') return 'This order already has a delivery or invoice — lines are locked.';
  const reason = payload.reason ?? payload.message;
  return reason ? String(reason) : (err || 'Save failed.');
};

export const TbcLineEditor = ({ docNo, target, onSaved, onClose }: {
  docNo: string;
  target: TbcEditTarget;
  onSaved: () => void;
  onClose: () => void;
}) => {
  const qc = useQueryClient();
  const v = target.variants;
  const product = useMfgProductByCode(target.itemCode);
  const productId = product.data?.id;
  const category: 'SOFA' | 'BEDFRAME' | null =
    target.itemGroup === 'sofa' ? 'SOFA' : target.itemGroup === 'bedframe' ? 'BEDFRAME' : null;

  /* ── Fabric (sofa + bedframe) ─────────────────────────────────────── */
  const fabricLib = useFabricLibrary();
  const fabricColours = useFabricColours();
  const allowedFabricsQ = useModelAllowedFabricCodes(productId);
  const addonCfgQ = useFabricTierAddonConfig();
  const allowedFabricCodes = allowedFabricsQ.data ?? [];
  // Series rows offered on this Model — same construction the Configurator
  // uses (allowed colour codes → their series, joined to the library).
  const fabricRows = useMemo<ProductFabricRow[]>(() => {
    if (!category) return [];
    const enabled = new Set(allowedFabricCodes);
    const fabricIds = new Set(
      (fabricColours.data ?? []).filter((c) => enabled.has(c.colourId)).map((c) => c.fabricId),
    );
    return (fabricLib.data ?? [])
      .filter((f) => fabricIds.has(f.id))
      .map((f) => ({ fabricId: f.id, active: f.active, surcharge: f.defaultSurcharge }));
  }, [category, allowedFabricCodes, fabricColours.data, fabricLib.data]);

  // undefined = untouched (line keeps its stored pick); null = cleared.
  const [fabricSel, setFabricSel] = useState<FabricSelection | null | undefined>(undefined);
  const fabricTouched = fabricSel !== undefined;
  const shownFabricId = fabricTouched ? (fabricSel?.fabricId ?? null) : ((v.fabricId as string | undefined) ?? null);
  const shownColourId = fabricTouched ? (fabricSel?.colourId ?? null) : ((v.colourId as string | undefined) ?? null);
  const tierOf = (fabricId: string | null): FabricTier | null => {
    if (!fabricId || !category) return null;
    const row = (fabricLib.data ?? []).find((f) => f.id === fabricId);
    const t = category === 'SOFA' ? row?.sofaTier : row?.bedframeTier;
    return (t as FabricTier | undefined) ?? null;
  };
  const fabricDeltaRM = category && addonCfgQ.data && fabricTouched
    ? fabricTierAddon(category, tierOf(fabricSel?.fabricId ?? null), addonCfgQ.data)
      - fabricTierAddon(category, tierOf((v.fabricId as string | undefined) ?? null), addonCfgQ.data)
    : 0;

  /* ── Sofa leg height ──────────────────────────────────────────────── */
  const sofaLegOpts = useSofaLegHeights(target.itemGroup === 'sofa' ? productId : undefined);
  const sofaLegRows: BedframeOptionRow[] = useMemo(
    () => (sofaLegOpts.data ?? []).map((o, i) => ({ id: o.value, kind: 'leg_height', value: o.value, surcharge: o.surcharge, sortOrder: i })),
    [sofaLegOpts.data],
  );
  const [sofaLeg, setSofaLeg] = useState<string | null | undefined>(undefined);
  const shownSofaLeg = sofaLeg !== undefined ? sofaLeg : ((v.sofaLegHeight as string | undefined) ?? null);
  const legSurcharge = (rows: BedframeOptionRow[], value: string | null) =>
    rows.find((o) => o.value === value)?.surcharge ?? 0;
  const sofaLegDeltaRM = sofaLeg !== undefined
    ? legSurcharge(sofaLegRows, sofaLeg) - legSurcharge(sofaLegRows, (v.sofaLegHeight as string | undefined) ?? null)
    : 0;

  /* ── Bedframe gap / leg / divan (variants store the human LABEL) ──── */
  const bfOpts = useBedframeCustomizerData(target.itemGroup === 'bedframe' ? productId : undefined);
  const bfByKind = useMemo(() => {
    const m: Record<string, BedframeOptionRow[]> = { gap: [], leg_height: [], divan_height: [] };
    for (const o of bfOpts.data ?? []) if (m[o.kind]) m[o.kind]!.push(o);
    return m;
  }, [bfOpts.data]);
  const [bfGap, setBfGap] = useState<string | null | undefined>(undefined);       // option VALUE (label)
  const [bfLeg, setBfLeg] = useState<string | null | undefined>(undefined);
  const [bfDivan, setBfDivan] = useState<string | null | undefined>(undefined);
  const shownGap = bfGap !== undefined ? bfGap : ((v.gap as string | undefined) ?? null);
  const shownBfLeg = bfLeg !== undefined ? bfLeg : ((v.legHeight as string | undefined) ?? null);
  const shownDivan = bfDivan !== undefined ? bfDivan : ((v.divanHeight as string | undefined) ?? null);
  const bfDeltaRM =
    (bfGap !== undefined ? legSurcharge(bfByKind.gap ?? [], bfGap) - legSurcharge(bfByKind.gap ?? [], (v.gap as string | undefined) ?? null) : 0)
    + (bfLeg !== undefined ? legSurcharge(bfByKind.leg_height ?? [], bfLeg) - legSurcharge(bfByKind.leg_height ?? [], (v.legHeight as string | undefined) ?? null) : 0)
    + (bfDivan !== undefined ? legSurcharge(bfByKind.divan_height ?? [], bfDivan) - legSurcharge(bfByKind.divan_height ?? [], (v.divanHeight as string | undefined) ?? null) : 0);

  /* ── Special add-ons (bedframe / mattress / sofa) ─────────────────── */
  const specialsQ = useSpecialAddons();
  const allowedSpecialsQ = useModelAllowedSpecials(productId);
  const specialAddons = useMemo(() => {
    const allowed = new Set(allowedSpecialsQ.data ?? []);
    const cat = (product.data?.category ?? '').toUpperCase();
    return (specialsQ.data ?? []).filter(
      (a) => a.active && allowed.has(a.code) && a.categories.map((x) => x.toUpperCase()).includes(cat),
    );
  }, [specialsQ.data, allowedSpecialsQ.data, product.data?.category]);
  const seededSpecials = useMemo<SpecialSel[]>(() => {
    const ids = (v.specialIds as string[] | undefined) ?? [];
    const labels = (v.specialLabels as string[] | undefined) ?? [];
    const choices = (v.specialChoices as Record<string, string[]> | undefined) ?? {};
    return ids.map((code, i) => {
      const addon = (specialsQ.data ?? []).find((a) => a.code === code);
      const ch = choices[code] ?? [];
      return {
        id: code,
        label: addon?.label ?? labels[i] ?? code,
        choices: ch,
        surcharge: addon ? specialSelSurchargeRM(addon, ch) : 0,
      };
    });
  }, [v, specialsQ.data]);
  const [specialSel, setSpecialSel] = useState<SpecialSel[] | undefined>(undefined);
  const shownSpecials = specialSel ?? seededSpecials;
  const specialsDeltaRM = specialSel !== undefined
    ? specialSelsSurcharge(specialSel) - specialSelsSurcharge(seededSpecials)
    : 0;

  const touched = fabricTouched || sofaLeg !== undefined || bfGap !== undefined
    || bfLeg !== undefined || bfDivan !== undefined || specialSel !== undefined;
  const deltaRM = fabricDeltaRM + sofaLegDeltaRM + bfDeltaRM + specialsDeltaRM;
  const belowFloor = deltaRM < 0;

  /* ── Save (variants delta) ────────────────────────────────────────── */
  const [error, setError] = useState<string | null>(null);
  const authedPost = async (path: string, body: unknown) => {
    if (!API_URL) throw new Error('VITE_API_URL is not set');
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) throw new Error('not_authenticated');
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let payload: Record<string, unknown> = { error: `http_${res.status}` };
      try { payload = (await res.json()) as Record<string, unknown>; } catch { /* keep http_NNN */ }
      throw new Error(friendlyError(payload));
    }
    return res.json();
  };

  const save = useMutation({
    mutationFn: async () => {
      const patch: Record<string, unknown> = {};
      if (fabricTouched) {
        if (fabricSel) {
          patch.fabricId = fabricSel.fabricId;
          patch.fabricLabel = fabricSel.fabricLabel;
          patch.colourId = fabricSel.colourId;
          patch.colourLabel = fabricSel.colourLabel;
          patch.colourHex = fabricSel.colourHex ?? null;
          // The colour code IS the procurement fabric_code (same mapping the
          // handover uses) — it satisfies the required-fabricCode axis.
          patch.fabricCode = fabricSel.colourId;
        } else {
          patch.fabricId = null; patch.fabricLabel = null; patch.colourId = null;
          patch.colourLabel = null; patch.colourHex = null; patch.fabricCode = null;
        }
      }
      if (sofaLeg !== undefined) patch.sofaLegHeight = sofaLeg;
      if (bfGap !== undefined) { patch.gap = bfGap; patch.gapLabel = bfGap; }
      if (bfLeg !== undefined) { patch.legHeight = bfLeg; patch.legHeightLabel = bfLeg; }
      if (bfDivan !== undefined) { patch.divanHeight = bfDivan; patch.divanHeightLabel = bfDivan; }
      if (specialSel !== undefined) {
        const codes = specialSel.map((s) => s.id);
        patch.specials = codes;
        patch.specialIds = codes;
        patch.specialLabels = specialSel.map((s) => s.label);
        patch.specialChoices = Object.fromEntries(specialSel.map((s) => [s.id, s.choices ?? []]));
      }
      return authedPost(`/mfg-sales-orders/${docNo}/items/${target.itemId}/tbc-update`, { variants: patch });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-orders'] });
      onSaved();
    },
    onError: (e: Error) => setError(e.message),
  });

  /* ── Product swap ─────────────────────────────────────────────────── */
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapQuery, setSwapQuery] = useState('');
  const candidates = useSwapCandidates(swapQuery);
  const prevLineTotal = (target.qty * target.unitPriceCenti) - target.discountCenti;
  const swap = useMutation({
    mutationFn: async (code: string) =>
      authedPost(`/mfg-sales-orders/${docNo}/items/${target.itemId}/tbc-swap`, { itemCode: code }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-orders'] });
      onSaved();
    },
    onError: (e: Error) => setError(e.message),
  });

  const isSofa = target.itemGroup === 'sofa';
  const isBedframe = target.itemGroup === 'bedframe';

  return (
    <div className={styles.editor}>
      {category && fabricRows.length > 0 && (
        <FabricColourPicker
          productFabrics={fabricRows}
          fabricId={shownFabricId}
          colourId={shownColourId}
          onChange={(next) => setFabricSel(next)}
          category={category}
          addonConfig={addonCfgQ.data ?? null}
          enabledColourIds={allowedFabricCodes}
          optional
          onClear={() => setFabricSel(null)}
        />
      )}

      {isSofa && sofaLegRows.length > 0 && (
        <OptionSelect
          label="Leg height"
          opts={sofaLegRows}
          selectedId={shownSofaLeg}
          onPick={(o) => setSofaLeg(o.value)}
          onClear={() => setSofaLeg(null)}
        />
      )}

      {isBedframe && (
        <>
          {(bfByKind.gap ?? []).length > 0 && (
            <OptionSelect label="Mattress gap" opts={bfByKind.gap!}
              selectedId={(bfByKind.gap ?? []).find((o) => o.value === shownGap)?.id ?? null}
              onPick={(o) => setBfGap(o.value)} onClear={() => setBfGap(null)} />
          )}
          {(bfByKind.leg_height ?? []).length > 0 && (
            <OptionSelect label="Leg height" opts={bfByKind.leg_height!}
              selectedId={(bfByKind.leg_height ?? []).find((o) => o.value === shownBfLeg)?.id ?? null}
              onPick={(o) => setBfLeg(o.value)} onClear={() => setBfLeg(null)} />
          )}
          {(bfByKind.divan_height ?? []).length > 0 && (
            <OptionSelect label="Divan height" opts={bfByKind.divan_height!}
              selectedId={(bfByKind.divan_height ?? []).find((o) => o.value === shownDivan)?.id ?? null}
              onPick={(o) => setBfDivan(o.value)} onClear={() => setBfDivan(null)} />
          )}
        </>
      )}

      {specialAddons.length > 0 && (
        <SpecialAddonsPicker addons={specialAddons} value={shownSpecials} onChange={setSpecialSel} />
      )}

      {/* Price impact preview — the server recomputes the same delta and is
          authoritative; a negative delta can't be saved (floor rule). */}
      {touched && (
        <div className={`${styles.deltaNote} ${belowFloor ? styles.deltaNoteBad : ''}`}>
          {deltaRM > 0
            ? `Adds ${fmtRM(deltaRM)}${target.qty > 1 ? ` × ${target.qty}` : ''} to the bill`
            : deltaRM === 0
              ? 'No price change'
              : `${fmtRM(Math.abs(deltaRM))} below the current line — the bill can't go below the original total`}
        </div>
      )}
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.actions}>
        {!isSofa && !target.isSofaBuild && (
          <Button variant="ghost" onClick={() => { setSwapOpen((s) => !s); setError(null); }}>
            {swapOpen ? 'Keep this product' : 'Change product'}
          </Button>
        )}
        <span className={styles.actionsSpacer} />
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!touched || belowFloor || save.isPending}
          onClick={() => { setError(null); save.mutate(); }}
        >
          {save.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>

      {swapOpen && (
        <div className={styles.swapBlock}>
          <div className={styles.swapSearch}>
            <Search size={16} strokeWidth={1.75} aria-hidden />
            <input
              type="text"
              value={swapQuery}
              onChange={(e) => setSwapQuery(e.target.value)}
              placeholder="Search products by code or name…"
            />
          </div>
          {(candidates.data ?? []).map((p) => {
            const sellSen = Math.max(0, Math.round(Number(p.sell_price_sen ?? 0)));
            const newTotal = (target.qty * sellSen) - target.discountCenti;
            const below = newTotal < prevLineTotal;
            return (
              <button
                key={p.code}
                type="button"
                className={styles.swapRow}
                disabled={sellSen <= 0 || below || swap.isPending}
                onClick={() => { setError(null); swap.mutate(p.code); }}
              >
                <span className={styles.swapName}>{p.name}</span>
                <span className={styles.swapMeta}>
                  {p.code}
                  {sellSen <= 0 ? ' · unpriced' : ` · ${fmtRM(Math.round(sellSen / 100))}`}
                  {below ? ' · below original total' : ''}
                </span>
              </button>
            );
          })}
          {swapQuery.trim().length >= 2 && (candidates.data ?? []).length === 0 && !candidates.isLoading && (
            <div className={styles.swapEmpty}>No matching products.</div>
          )}
        </div>
      )}
    </div>
  );
};
