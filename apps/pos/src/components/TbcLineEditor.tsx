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
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { fmtRM, fabricTierAddon, resolveFabricTierOverride, type FabricTier } from '@2990s/shared';
import { supabase } from '../lib/supabase';
import { authedFetch } from '../lib/apiClient';
import {
  useFabricLibrary,
  useFabricColours,
  useModelAllowedFabricCodes,
  useModelAllowedSpecials,
  useBedframeCustomizerData,
  useSofaLegHeights,
  useSpecialAddons,
  useFabricTierAddonConfig,
  useModelFabricTierOverrides,
  useCompartmentFabricTierOverrides,
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
  /** PWP (换购) reward line — TBC picks are editable (the server's delta
   *  pricing never touches the granted base) but the product can't be
   *  swapped: the voucher binds to the reward SKU. */
  isPwp: boolean;
  /** Sofa exchange (Loo 2026-06-12) — the WHOLE build's combined total (the
   *  floor-rule baseline the configurator pre-checks against) and the build's
   *  current cells (seed the canvas on "Change to Same Model"). */
  buildTotalCenti: number;
  buildCells?: Array<{ moduleId: string; x: number; y: number; rot: number }>;
}

/* Resolve the SO line's mfg product row by CODE — the SO stores item_code,
   while every configurator data hook keys on mfg_products.id ('mfg-…'). */
const useMfgProductByCode = (code: string) =>
  useQuery({
    enabled: !!code,
    queryKey: ['mfg-product-by-code', code],
    staleTime: 60_000,
    queryFn: async (): Promise<{ id: string; model_id: string | null; category: string; base_model: string | null } | null> => {
      // Houzs GET /mfg-products?search= narrows the list; match the exact code.
      const { products } = await authedFetch<{
        products: Array<{ id: string; code: string; model_id: string | null; category: string; base_model: string | null }>;
      }>(`/mfg-products?search=${encodeURIComponent(code)}`);
      const row = (products ?? []).find((p) => p.code === code);
      return row
        ? { id: row.id, model_id: row.model_id, category: row.category, base_model: row.base_model }
        : null;
    },
  });

/* ── PWP swap ranges (Loo 2026-06-12) ───────────────────────────────────
   A line tied to a PWP (换购) promotion may only be exchanged WITHIN the
   promotion's own range. The server enforces the same rule (tbc-swap); this
   context just pre-filters the candidate search so sales never see an
   out-of-range item.
     reward  — the line IS a PWP reward → the code's snapshotted reward set.
     locked  — the reward range can't be determined (code missing) →
               coordinator only.
     free    — everything else. Trigger lines swap FREELY (Loo 2026-06-12):
               the server re-evaluates the promotion after the swap
               (reward reverts / voucher deletes / fresh vouchers mint)
               instead of restricting the candidates. */
type SwapCtx =
  | { kind: 'free' }
  | { kind: 'reward'; category: string; modelIds: string[]; promoType: string }
  | { kind: 'locked'; reason: string };

const useSwapContext = (docNo: string, target: TbcEditTarget) =>
  useQuery({
    queryKey: ['tbc-swap-ctx', docNo, target.itemId, target.itemCode],
    staleTime: 30_000,
    queryFn: async (): Promise<SwapCtx> => {
      if (target.isPwp) {
        const code = String(target.variants.pwpCode ?? '').trim();
        if (!code) return { kind: 'locked', reason: 'This PWP reward carries no voucher code — the coordinator handles the exchange.' };
        // TODO(P4.3): NOT ported to Houzs. This resolves the voucher's reward
        // RANGE (reward_category + eligible_reward_model_ids) to pre-filter swap
        // candidates. The map's GET /pwp-codes/:code is validatePwpCode, whose
        // response (PwpCodeValidation) carries rewardCategory but NOT
        // eligible_reward_model_ids, so SwapCtx.modelIds can't be reconstructed.
        // Left on direct Supabase pending a raw pwp-code endpoint. The server
        // re-enforces the range on tbc-swap regardless.
        const { data } = await supabase.from('pwp_codes')
          .select('reward_category, eligible_reward_model_ids, type')
          .eq('code', code).maybeSingle();
        const d = data as { reward_category: string; eligible_reward_model_ids: string[] | null; type: string } | null;
        if (!d) return { kind: 'locked', reason: 'This PWP voucher could not be found — the coordinator handles the exchange.' };
        return { kind: 'reward', category: d.reward_category, modelIds: d.eligible_reward_model_ids ?? [], promoType: d.type };
      }
      // Non-reward lines (including PWP triggers) swap freely — the server
      // re-evaluates the promotion after the swap (Loo 2026-06-12).
      return { kind: 'free' };
    },
  });

/* Swap-candidate search — active, POS-visible, non-sofa SKUs by code / name,
   narrowed to the PWP range when the context demands one. */
const useSwapCandidates = (q: string, ctx: SwapCtx | undefined) =>
  useQuery({
    enabled: q.trim().length >= 2 && ctx != null && ctx.kind !== 'locked',
    queryKey: ['tbc-swap-candidates', q, ctx],
    staleTime: 30_000,
    queryFn: async (): Promise<Array<{ code: string; name: string; category: string; sell_price_sen: number | null; pwp_price_sen: number | null }>> => {
      // Houzs GET /mfg-products?search= returns status=ACTIVE matches; the rest
      // of the original filters (pos_active, non-sofa, reward range) run
      // client-side to preserve the exact candidate set.
      const { products } = await authedFetch<{
        products: Array<{
          code: string; name: string; category: string;
          sell_price_sen: number | null; pwp_price_sen: number | null;
          model_id: string | null; pos_active: boolean | null; status: string;
        }>;
      }>(`/mfg-products?search=${encodeURIComponent(q.trim())}`);
      let rows = (products ?? []).filter(
        (p) => p.status === 'ACTIVE' && p.pos_active === true && p.category !== 'SOFA',
      );
      if (ctx?.kind === 'reward') {
        rows = rows.filter((p) => p.category === ctx.category);
        if (ctx.modelIds.length > 0) rows = rows.filter((p) => p.model_id != null && ctx.modelIds.includes(p.model_id));
        if (ctx.promoType !== 'promo') rows = rows.filter((p) => (p.pwp_price_sen ?? 0) > 0);
      }
      return rows
        .sort((a, b) => a.code.localeCompare(b.code))
        .slice(0, 8)
        .map((p) => ({
          code: p.code, name: p.name, category: p.category,
          sell_price_sen: p.sell_price_sen, pwp_price_sen: p.pwp_price_sen,
        }));
    },
  });

/* Sofa exchange (Loo 2026-06-12) — the Model chooser behind "Change product"
   on a sofa build. One entry per base_model (active, POS-visible), with a
   representative SKU id as the /configure/:id link target (any SKU of the
   Model resolves to the same configurator page). */
const useSofaSwapModels = (enabled: boolean) =>
  useQuery({
    enabled,
    queryKey: ['tbc-sofa-swap-models'],
    staleTime: 60_000,
    queryFn: async (): Promise<Array<{ baseModel: string; configureId: string; name: string }>> => {
      // Houzs: GET /mfg-products (status=ACTIVE) → SOFA + pos_active SKUs;
      // GET /product-models → the Model name/active for each SKU's model_id.
      const [{ products }, { models }] = await Promise.all([
        authedFetch<{
          products: Array<{ id: string; code: string; base_model: string | null; category: string; pos_active: boolean | null; status: string; model_id: string | null }>;
        }>('/mfg-products'),
        authedFetch<{ models: Array<{ id: string; name: string; active: boolean }> }>('/product-models'),
      ]);
      const modelById = new Map((models ?? []).map((m) => [m.id, m]));
      const sofa = (products ?? [])
        .filter((p) => p.category === 'SOFA' && p.pos_active === true && p.status === 'ACTIVE')
        .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''));
      const out = new Map<string, { baseModel: string; configureId: string; name: string }>();
      for (const r of sofa) {
        const base = (r.base_model ?? '').trim();
        if (!base || out.has(base)) continue;
        const m = r.model_id ? modelById.get(r.model_id) : undefined;
        if (m && m.active === false) continue;
        out.set(base, { baseModel: base, configureId: r.id, name: m?.name ?? base });
      }
      return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
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
  if (err === 'pwp_line_locked') return 'This PWP line is handled by the coordinator.';
  if (err === 'pwp_swap_out_of_range') return 'A PWP reward can only be exchanged within the promotion\'s reward range.';
  if (err === 'pwp_trigger_cross_order') {
    return String(payload.reason ?? 'This item triggered a voucher already redeemed on another order — the coordinator handles the exchange.');
  }
  if (err === 'pwp_reward_sofa_revert_unsupported') {
    return 'The voucher this item triggered paid for a sofa reward — the coordinator handles the exchange.';
  }
  if (err === 'pwp_reward_unpriced') return 'That item has no PWP price yet — ask an admin to set it in the SKU Master.';
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
  // migration 0172 — per-Model Δ override for this line's Model (same for the
  // prev/next fabric in the difference; the Model doesn't change on a fill-in).
  const modelOverridesQ = useModelFabricTierOverrides();
  const baseModelOverride = useMemo(() => {
    const id = product.data?.model_id ?? null;
    if (!id) return null;
    const row = (modelOverridesQ.data ?? []).find((r) => r.modelId === id);
    return row ? { tier2Delta: row.tier2Delta, tier3Delta: row.tier3Delta } : null;
  }, [modelOverridesQ.data, product.data]);
  // migration 0184 — per-compartment Δ overrides. For a SOFA build the effective
  // Δ is the MAX over the SET special values (the Model override + every override
  // whose compartment code is in the build's cells), resolved by the shared
  // resolveFabricTierOverride so the fill-in difference matches the server.
  // Non-sofa lines carry no cells → resolve returns the Model override unchanged.
  const compartmentOverridesQ = useCompartmentFabricTierOverrides();
  const compartmentOverrideMap = useMemo(
    () => new Map((compartmentOverridesQ.data ?? []).map((r) => [r.compartmentId, { tier2Delta: r.tier2Delta, tier3Delta: r.tier3Delta }])),
    [compartmentOverridesQ.data],
  );
  const modelFabricOverride = useMemo(
    () => resolveFabricTierOverride((target.buildCells ?? []).map((c) => c.moduleId).filter(Boolean), baseModelOverride, compartmentOverrideMap),
    [target.buildCells, baseModelOverride, compartmentOverrideMap],
  );
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
    ? fabricTierAddon(category, tierOf(fabricSel?.fabricId ?? null), addonCfgQ.data, modelFabricOverride)
      - fabricTierAddon(category, tierOf((v.fabricId as string | undefined) ?? null), addonCfgQ.data, modelFabricOverride)
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
  const swapCtx = useSwapContext(docNo, target);
  const candidates = useSwapCandidates(swapQuery, swapCtx.data);
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

  /* ── Sofa exchange (Loo 2026-06-12) ─────────────────────────────────
     A sofa build is exchanged in the CONFIGURATOR, not by a one-line swap:
     "Change product" offers Same Model (canvas seeded with the current
     build) or Other Model (pick the target sofa Model), the configurator's
     primary button becomes "Confirm Change", and tbc-swap-sofa replaces the
     whole build server-side with the same floor rule. */
  const navigate = useNavigate();
  const isSofaLine = isSofa || target.isSofaBuild;
  const [sofaSwapOpen, setSofaSwapOpen] = useState(false);
  const sofaModels = useSofaSwapModels(isSofaLine && sofaSwapOpen);
  const currentBaseModel = (product.data?.base_model ?? '').trim();
  const sameModelEntry =
    (sofaModels.data ?? []).find((m) => m.baseModel === currentBaseModel)
    ?? (product.data ? { baseModel: currentBaseModel, configureId: product.data.id, name: currentBaseModel || target.itemCode } : null);
  const goConfigure = (configureId: string, sameModel: boolean) => {
    const qs = `swapDoc=${encodeURIComponent(docNo)}&swapItem=${encodeURIComponent(target.itemId)}&swapTotal=${target.buildTotalCenti}`;
    navigate(
      `/configure/${configureId}?${qs}`,
      sameModel && target.buildCells && target.buildCells.length > 0
        ? { state: { swapCells: target.buildCells } }
        : undefined,
    );
  };

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
          modelOverride={modelFabricOverride}
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
        {isSofaLine && (
          <Button variant="ghost" onClick={() => { setSofaSwapOpen((v) => !v); setError(null); }}>
            {sofaSwapOpen ? 'Keep this sofa' : 'Change product'}
          </Button>
        )}
        {/* PWP lines swap too (Loo 2026-06-12) — within the promotion's own
            range; useSwapContext narrows the search, the server re-enforces. */}
        {!isSofa && !target.isSofaBuild && swapCtx.data?.kind !== 'locked' && (
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

      {isSofaLine && sofaSwapOpen && (
        <div className={styles.swapBlock}>
          <div className={styles.swapEmpty}>
            Exchange this sofa in the configurator — rebuild it, then tap Confirm Change.
            The bill keeps the original total as its floor.
          </div>
          {target.isPwp && (
            <div className={styles.swapEmpty}>
              PWP reward — a build matching the voucher's reward combos keeps its
              PWP price; anything else prices normally and the voucher returns
              to the customer for a later redemption.
            </div>
          )}
          <button
            type="button"
            className={styles.swapRow}
            disabled={!sameModelEntry}
            onClick={() => sameModelEntry && goConfigure(sameModelEntry.configureId, true)}
          >
            <span className={styles.swapName}>Change to Same Model</span>
            <span className={styles.swapMeta}>
              {sameModelEntry ? `${sameModelEntry.name} — starts from the current build` : 'Loading…'}
            </span>
          </button>
          <div className={styles.swapEmpty}>Change to Other Model</div>
          {(sofaModels.data ?? []).filter((m) => m.baseModel !== currentBaseModel).map((m) => (
            <button
              key={m.baseModel}
              type="button"
              className={styles.swapRow}
              onClick={() => goConfigure(m.configureId, false)}
            >
              <span className={styles.swapName}>{m.name}</span>
              <span className={styles.swapMeta}>{m.baseModel}</span>
            </button>
          ))}
          {sofaSwapOpen && !sofaModels.isLoading && (sofaModels.data ?? []).filter((m) => m.baseModel !== currentBaseModel).length === 0 && (
            <div className={styles.swapEmpty}>No other sofa Models available.</div>
          )}
        </div>
      )}

      {swapOpen && (
        <div className={styles.swapBlock}>
          {swapCtx.data?.kind === 'reward' && (
            <div className={styles.swapEmpty}>
              PWP reward — showing items inside this promotion's reward range, at their PWP price.
            </div>
          )}
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
            // A reward swap charges the new SKU's PWP price; everything else
            // the catalog selling price — mirrors the server's tbc-swap.
            const isReward = swapCtx.data?.kind === 'reward';
            const priceSen = isReward
              ? Math.max(0, Math.round(Number(p.pwp_price_sen ?? 0)))
              : Math.max(0, Math.round(Number(p.sell_price_sen ?? 0)));
            const unpriced = isReward
              ? (swapCtx.data?.kind === 'reward' && swapCtx.data.promoType !== 'promo' && priceSen <= 0)
              : priceSen <= 0;
            const newTotal = (target.qty * priceSen) - target.discountCenti;
            const below = newTotal < prevLineTotal;
            return (
              <button
                key={p.code}
                type="button"
                className={styles.swapRow}
                disabled={unpriced || below || swap.isPending}
                onClick={() => { setError(null); swap.mutate(p.code); }}
              >
                <span className={styles.swapName}>{p.name}</span>
                <span className={styles.swapMeta}>
                  {p.code}
                  {unpriced
                    ? ' · unpriced'
                    : ` · ${fmtRM(Math.round(priceSen / 100))}${isReward ? ' PWP' : ''}`}
                  {below ? ' · below original total' : ''}
                </span>
              </button>
            );
          })}
          {swapQuery.trim().length >= 2 && (candidates.data ?? []).length === 0 && !candidates.isLoading && (
            <div className={styles.swapEmpty}>No matching products in this range.</div>
          )}
        </div>
      )}
    </div>
  );
};
